import 'server-only';

import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';

import { dbPostgres } from '@/core/db';
import {
  coachAssessment,
  coachCodeRun,
  coachLearningArtifact,
  coachLearningProfile,
  coachPracticeSession,
  coachProblem,
  coachProductEvent,
  coachReviewItem,
  coachSyncMutation as coachSyncMutationTable,
  coachSyncState,
  coachTestCase,
} from '@/config/db/schema.postgres';

import { createInitialReviewProgress } from './learning-progress';
import { createInitialCoachState } from './storage';
import { applyCoachSyncMutations, filterUnappliedCoachMutations } from './sync';
import {
  CoachState,
  CoachSyncMutation,
  CoachSyncResult,
  CodeRunResult,
  ImportedDraftRecord,
  LearningArtifact,
  LearningProfile,
  Problem,
  ProductEvent,
  ReviewItem,
  ReviewProgressState,
} from './types';

export interface PersistedCoachData {
  state: CoachState;
  importedProblem: Problem | null;
  importedDrafts: ImportedDraftRecord[];
  reviewProgress: ReviewProgressState;
  hasData: boolean;
  revision: number;
}

export class CoachPersistenceConflict extends Error {
  constructor(
    public readonly currentRevision: number,
    public readonly replayedMutationIds: string[] = []
  ) {
    super('Learning data changed in another request.');
    this.name = 'CoachPersistenceConflict';
  }
}

type CoachTransaction = Parameters<
  Parameters<ReturnType<typeof dbPostgres>['transaction']>[0]
>[0];

function stableId(prefix: string, parts: Array<string | number>): string {
  const digest = createHash('sha256')
    .update(parts.join('\u001f'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function userNamespace(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 16);
}

function namespacedId(
  prefix: string,
  userId: string,
  clientId: string
): string {
  const encoded = Buffer.from(clientId, 'utf8').toString('base64url');
  return `${prefix}_${userNamespace(userId)}_${encoded}`;
}

function clientIdFromNamespaced(
  prefix: string,
  userId: string,
  persistedId: string
): string {
  const marker = `${prefix}_${userNamespace(userId)}_`;
  if (!persistedId.startsWith(marker)) return persistedId;
  try {
    return Buffer.from(persistedId.slice(marker.length), 'base64url').toString(
      'utf8'
    );
  } catch {
    return persistedId;
  }
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? new Date(0).toISOString()
    : parsed.toISOString();
}

function sessionId(userId: string, problemSlug: string): string {
  return stableId('practice', [userId, problemSlug]);
}

function runClientId(userId: string, run: CodeRunResult): string {
  return (
    run.id ??
    stableId('run', [
      userId,
      run.problemSlug,
      run.language,
      run.executedAt,
      run.status,
      run.passedTests,
      run.totalTests,
      run.durationMs,
    ])
  );
}

async function lockSyncState(
  tx: CoachTransaction,
  userId: string
): Promise<number> {
  await tx
    .insert(coachSyncState)
    .values({ userId, revision: 0, updatedAt: new Date() })
    .onConflictDoNothing({ target: coachSyncState.userId });
  const [row] = await tx
    .select({ revision: coachSyncState.revision })
    .from(coachSyncState)
    .where(eq(coachSyncState.userId, userId))
    .for('update')
    .limit(1);
  if (!row) throw new Error('Could not lock the learning data revision.');
  return row.revision;
}

interface ImportedDraftSync {
  mode: 'replace' | 'delta';
  records: ImportedDraftRecord[];
  deletedSlugs: string[];
  activeSlug: string | null;
  activeChanged: boolean;
}

function persistedImportedProblemId(userId: string, problem: Problem): string {
  return namespacedId('imported_problem', userId, problem.id);
}

function persistedImportedTestId(
  userId: string,
  problemSlug: string,
  testId: string
): string {
  return namespacedId('test', userId, `${problemSlug}:${testId}`);
}

function importedTestClientId(
  userId: string,
  problemSlug: string,
  persistedId: string
): string {
  const decoded = clientIdFromNamespaced('test', userId, persistedId);
  const marker = `${problemSlug}:`;
  return decoded.startsWith(marker) ? decoded.slice(marker.length) : decoded;
}

async function syncImportedDrafts(
  tx: CoachTransaction,
  userId: string,
  sync: ImportedDraftSync
): Promise<void> {
  if (
    sync.mode === 'delta' &&
    !sync.records.length &&
    !sync.deletedSlugs.length &&
    !sync.activeChanged
  ) {
    return;
  }
  const existingRows = await tx
    .select({ id: coachProblem.id, slug: coachProblem.slug })
    .from(coachProblem)
    .where(eq(coachProblem.ownerUserId, userId));
  const existingIdBySlug = new Map(
    existingRows.map((row) => [row.slug, row.id])
  );
  const persistedAt = new Date();

  if (sync.activeChanged) {
    await tx
      .update(coachProblem)
      .set({ isActive: false })
      .where(eq(coachProblem.ownerUserId, userId));
  }

  const desiredSlugs = new Set(
    sync.records.map((record) => record.problem.slug)
  );
  const deletedSlugs = new Set(sync.deletedSlugs);
  if (sync.mode === 'replace') {
    for (const row of existingRows) {
      if (!desiredSlugs.has(row.slug)) deletedSlugs.add(row.slug);
    }
  }
  const deletedIds = existingRows
    .filter((row) => deletedSlugs.has(row.slug))
    .map((row) => row.id);
  if (deletedIds.length) {
    await tx.delete(coachProblem).where(inArray(coachProblem.id, deletedIds));
    for (const slug of deletedSlugs) existingIdBySlug.delete(slug);
  }

  for (const record of sync.records) {
    const { problem } = record;
    const id =
      existingIdBySlug.get(problem.slug) ??
      persistedImportedProblemId(userId, problem);
    const active = sync.activeSlug === problem.slug;
    const requestedCreatedAt = asDate(record.createdAt);
    const createdAt =
      requestedCreatedAt.getTime() > persistedAt.getTime()
        ? persistedAt
        : requestedCreatedAt;
    await tx
      .insert(coachProblem)
      .values({
        id,
        slug: problem.slug,
        ownerUserId: userId,
        source: 'imported',
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        topics: problem.topics,
        entryPoint: problem.entryPoint,
        templates: problem.templates,
        examples: problem.examples,
        constraints: problem.constraints,
        hints: problem.hints,
        reviewPoints: problem.reviewPoints,
        estimatedMinutes: problem.estimatedMinutes,
        status: 'draft',
        isActive: active,
        sourceStatement: problem.sourceStatement,
        sourceUrl: problem.sourceUrl,
        contentVersion: 1,
        createdAt,
        updatedAt: persistedAt,
      })
      .onConflictDoUpdate({
        target: coachProblem.id,
        set: {
          slug: problem.slug,
          title: problem.title,
          description: problem.description,
          difficulty: problem.difficulty,
          topics: problem.topics,
          entryPoint: problem.entryPoint,
          templates: problem.templates,
          examples: problem.examples,
          constraints: problem.constraints,
          hints: problem.hints,
          reviewPoints: problem.reviewPoints,
          estimatedMinutes: problem.estimatedMinutes,
          status: 'draft',
          ...(sync.activeChanged ? { isActive: active } : {}),
          sourceStatement: problem.sourceStatement,
          sourceUrl: problem.sourceUrl,
          updatedAt: persistedAt,
        },
      });

    await tx.delete(coachTestCase).where(eq(coachTestCase.problemId, id));
    if (problem.tests.length > 0) {
      await tx.insert(coachTestCase).values(
        problem.tests.map((test, ordinal) => ({
          id: persistedImportedTestId(userId, problem.slug, test.id),
          problemId: id,
          ordinal,
          args: test.args,
          expected: test.expected,
          isSample: test.isSample,
          label: test.label,
          timeoutMs: 3000,
          createdAt,
          updatedAt: persistedAt,
        }))
      );
    }
  }

  if (sync.activeChanged && sync.activeSlug) {
    await tx
      .update(coachProblem)
      .set({ isActive: true })
      .where(
        and(
          eq(coachProblem.ownerUserId, userId),
          eq(coachProblem.slug, sync.activeSlug)
        )
      );
  }

  const retainedRows = await tx
    .select({ id: coachProblem.id })
    .from(coachProblem)
    .where(eq(coachProblem.ownerUserId, userId))
    .orderBy(desc(coachProblem.isActive), desc(coachProblem.updatedAt));
  const overflowIds = retainedRows.slice(20).map((row) => row.id);
  if (overflowIds.length) {
    await tx.delete(coachProblem).where(inArray(coachProblem.id, overflowIds));
  }
}

async function persistCoachDataInTransaction(
  tx: CoachTransaction,
  userId: string,
  state: CoachState,
  importedDraftSync: ImportedDraftSync,
  reviewProgress: ReviewProgressState,
  expectedRevision: number,
  requestedMutationIds: string[] = []
): Promise<CoachSyncResult> {
  const timestamp = new Date();
  const currentRevision = await lockSyncState(tx, userId);
  const mutationIds = Array.from(new Set(requestedMutationIds));
  const existingMutations = mutationIds.length
    ? await tx
        .select({ mutationId: coachSyncMutationTable.mutationId })
        .from(coachSyncMutationTable)
        .where(
          and(
            eq(coachSyncMutationTable.userId, userId),
            inArray(coachSyncMutationTable.mutationId, mutationIds)
          )
        )
    : [];
  const replayedMutationIds = existingMutations.map(
    (mutation) => mutation.mutationId
  );
  const replayed = new Set(replayedMutationIds);
  const appliedMutationIds = mutationIds.filter((id) => !replayed.has(id));

  if (mutationIds.length > 0 && appliedMutationIds.length === 0) {
    return {
      revision: currentRevision,
      appliedMutationIds: [],
      replayedMutationIds,
    };
  }
  if (currentRevision !== expectedRevision) {
    throw new CoachPersistenceConflict(currentRevision, replayedMutationIds);
  }
  await syncImportedDrafts(tx, userId, importedDraftSync);

  if (state.profile) {
    await tx
      .insert(coachLearningProfile)
      .values({
        userId,
        goal: state.profile.goal,
        preferredLanguage: state.profile.preferredLanguage,
        weeklyTarget: state.profile.weeklyTarget,
        dailyMinutes: state.profile.dailyMinutes ?? 30,
        onboardingCompleted:
          state.profile.onboardingCompleted ??
          Boolean(state.profile.onboardedAt),
        onboardedAt: asDate(state.profile.onboardedAt),
        createdAt: state.profile.createdAt
          ? asDate(state.profile.createdAt)
          : timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: coachLearningProfile.userId,
        set: {
          goal: state.profile.goal,
          preferredLanguage: state.profile.preferredLanguage,
          weeklyTarget: state.profile.weeklyTarget,
          dailyMinutes: state.profile.dailyMinutes ?? 30,
          onboardingCompleted:
            state.profile.onboardingCompleted ??
            Boolean(state.profile.onboardedAt),
          onboardedAt: asDate(state.profile.onboardedAt),
          updatedAt: timestamp,
        },
      });
  }

  const problemRows = await tx
    .select({
      id: coachProblem.id,
      slug: coachProblem.slug,
      ownerUserId: coachProblem.ownerUserId,
    })
    .from(coachProblem)
    .where(
      or(isNull(coachProblem.ownerUserId), eq(coachProblem.ownerUserId, userId))
    );
  const problemIdBySlug = new Map<string, string>();
  for (const row of problemRows) {
    if (!problemIdBySlug.has(row.slug) || row.ownerUserId === userId) {
      problemIdBySlug.set(row.slug, row.id);
    }
  }

  for (const item of Object.values(reviewProgress.items)) {
    await tx
      .insert(coachReviewItem)
      .values({
        userId,
        problemSlug: item.problemSlug,
        status: item.status,
        source: item.source,
        dueAt: asDate(item.dueAt),
        intervalDays: item.intervalDays,
        repetitions: item.repetitions,
        easeFactor: item.easeFactor,
        lastObservedRunAt: item.lastObservedRunAt
          ? asDate(item.lastObservedRunAt)
          : null,
        lastFailureAt: item.lastFailureAt ? asDate(item.lastFailureAt) : null,
        lastReviewedAt: item.lastReviewedAt
          ? asDate(item.lastReviewedAt)
          : null,
        lastRating: item.lastRating,
        updatedAt: asDate(item.updatedAt),
      })
      .onConflictDoUpdate({
        target: [coachReviewItem.userId, coachReviewItem.problemSlug],
        set: {
          status: item.status,
          source: item.source,
          dueAt: asDate(item.dueAt),
          intervalDays: item.intervalDays,
          repetitions: item.repetitions,
          easeFactor: item.easeFactor,
          lastObservedRunAt: item.lastObservedRunAt
            ? asDate(item.lastObservedRunAt)
            : null,
          lastFailureAt: item.lastFailureAt ? asDate(item.lastFailureAt) : null,
          lastReviewedAt: item.lastReviewedAt
            ? asDate(item.lastReviewedAt)
            : null,
          lastRating: item.lastRating,
          updatedAt: asDate(item.updatedAt),
        },
      });
  }

  const persistedSessionIdBySlug = new Map<string, string>();
  const persistedRunIdBySlug = new Map<string, string>();
  const persistedRunIdByClientId = new Map<string, string>();
  const seenRunIds = new Set<string>();

  for (const [slug, session] of Object.entries(state.sessions)) {
    const persistedSessionId = sessionId(userId, slug);
    persistedSessionIdBySlug.set(slug, persistedSessionId);
    const sessionStatus = session.completedAt ? 'completed' : 'active';
    await tx
      .insert(coachPracticeSession)
      .values({
        id: persistedSessionId,
        userId,
        problemId: problemIdBySlug.get(slug),
        problemSlugSnapshot: slug,
        code: session.code,
        hintLevel: session.hintLevel,
        diagnosisCount: session.diagnosisCount,
        correctedAfterDiagnosis: session.correctedAfterDiagnosis,
        status: sessionStatus,
        startedAt: asDate(session.startedAt),
        updatedAt: asDate(session.updatedAt),
        completedAt: session.completedAt ? asDate(session.completedAt) : null,
      })
      .onConflictDoUpdate({
        target: coachPracticeSession.id,
        set: {
          problemId: problemIdBySlug.get(slug),
          code: session.code,
          hintLevel: session.hintLevel,
          diagnosisCount: session.diagnosisCount,
          correctedAfterDiagnosis: session.correctedAfterDiagnosis,
          status: sessionStatus,
          updatedAt: asDate(session.updatedAt),
          completedAt: session.completedAt ? asDate(session.completedAt) : null,
        },
      });

    for (const run of session.runs) {
      const clientRunId = runClientId(userId, run);
      const persistedRunId = namespacedId('run', userId, clientRunId);
      if (seenRunIds.has(persistedRunId)) continue;
      seenRunIds.add(persistedRunId);
      persistedRunIdBySlug.set(slug, persistedRunId);
      persistedRunIdByClientId.set(clientRunId, persistedRunId);
      await tx
        .insert(coachCodeRun)
        .values({
          id: persistedRunId,
          sessionId: persistedSessionId,
          problemId: problemIdBySlug.get(slug),
          problemSlugSnapshot: slug,
          language: run.language,
          codeSnapshot: run.codeSnapshot ?? session.code[run.language] ?? '',
          status: run.status,
          passedTests: run.passedTests,
          totalTests: run.totalTests,
          testResults: run.testResults,
          console: run.console,
          error: run.error,
          durationMs: Math.round(run.durationMs),
          testScope: run.testScope ?? (run.submitted ? 'full' : 'unknown'),
          submitted: run.submitted ?? false,
          executedAt: asDate(run.executedAt),
        })
        .onConflictDoUpdate({
          target: coachCodeRun.id,
          set: {
            codeSnapshot: run.codeSnapshot ?? session.code[run.language] ?? '',
            status: run.status,
            passedTests: run.passedTests,
            totalTests: run.totalTests,
            testResults: run.testResults,
            console: run.console,
            error: run.error,
            durationMs: Math.round(run.durationMs),
            testScope: run.testScope ?? (run.submitted ? 'full' : 'unknown'),
            submitted: run.submitted ?? false,
          },
        });
    }
  }

  for (const artifact of state.artifacts) {
    const slug = artifact.problemSlug;
    const artifactId = namespacedId('artifact', userId, artifact.id);
    const artifactRunId = artifact.runId
      ? persistedRunIdByClientId.get(artifact.runId)
      : undefined;
    await tx
      .insert(coachLearningArtifact)
      .values({
        id: artifactId,
        userId,
        sessionId: slug ? persistedSessionIdBySlug.get(slug) : undefined,
        problemId: slug ? problemIdBySlug.get(slug) : undefined,
        runId:
          artifactRunId ??
          (artifact.type === 'diagnose' && slug
            ? persistedRunIdBySlug.get(slug)
            : undefined),
        problemSlugSnapshot: slug,
        type: artifact.type,
        locale: artifact.locale,
        title: artifact.title,
        summary: artifact.summary,
        details: artifact.details,
        evidence: artifact.evidence,
        nextAction: artifact.nextAction,
        diagnosisCategory: artifact.diagnosisCategory,
        hint: artifact.hint,
        counterexample: artifact.counterexample,
        reviewCard: artifact.reviewCard,
        draft: artifact.draft,
        generationMode: artifact.generationMode ?? 'live',
        model: artifact.model,
        promptVersion: artifact.promptVersion,
        traceId: artifact.traceId
          ? namespacedId('trace', userId, artifact.traceId)
          : undefined,
        latencyMs: artifact.latencyMs,
        createdAt: asDate(artifact.createdAt),
      })
      .onConflictDoUpdate({
        target: coachLearningArtifact.id,
        set: {
          sessionId: slug ? persistedSessionIdBySlug.get(slug) : undefined,
          problemId: slug ? problemIdBySlug.get(slug) : undefined,
          runId:
            artifactRunId ??
            (artifact.type === 'diagnose' && slug
              ? persistedRunIdBySlug.get(slug)
              : undefined),
          title: artifact.title,
          summary: artifact.summary,
          details: artifact.details,
          evidence: artifact.evidence,
          nextAction: artifact.nextAction,
          diagnosisCategory: artifact.diagnosisCategory,
          hint: artifact.hint,
          counterexample: artifact.counterexample,
          reviewCard: artifact.reviewCard,
          draft: artifact.draft,
          generationMode: artifact.generationMode ?? 'live',
          model: artifact.model,
          promptVersion: artifact.promptVersion,
          traceId: artifact.traceId
            ? namespacedId('trace', userId, artifact.traceId)
            : undefined,
          latencyMs: artifact.latencyMs,
        },
      });
  }

  await tx
    .delete(coachAssessment)
    .where(
      and(
        eq(coachAssessment.userId, userId),
        eq(coachAssessment.status, 'active')
      )
    );

  if (state.activeAssessment) {
    const assessmentId = namespacedId(
      'assessment',
      userId,
      state.activeAssessment.id
    );
    await tx
      .insert(coachAssessment)
      .values({
        id: assessmentId,
        userId,
        problemSlugs: state.activeAssessment.problemSlugs,
        status: 'active',
        durationMinutes: state.activeAssessment.durationMinutes,
        startedAt: asDate(state.activeAssessment.startedAt),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: coachAssessment.id,
        set: {
          problemSlugs: state.activeAssessment.problemSlugs,
          status: 'active',
          durationMinutes: state.activeAssessment.durationMinutes,
          startedAt: asDate(state.activeAssessment.startedAt),
          updatedAt: timestamp,
        },
      });
  }

  for (const assessment of state.assessments) {
    const assessmentId = namespacedId('assessment', userId, assessment.id);
    await tx
      .insert(coachAssessment)
      .values({
        id: assessmentId,
        userId,
        problemSlugs: assessment.problemSlugs,
        status: 'completed',
        durationMinutes: 20,
        startedAt: asDate(assessment.startedAt),
        completedAt: asDate(assessment.completedAt),
        score: assessment.score,
        correctCount: assessment.correctCount,
        totalCount: assessment.totalCount,
        weakTopics: assessment.weakTopics,
        recommendation: assessment.recommendation,
        assessmentVersion: assessment.version,
        verificationToken: assessment.verificationToken,
        createdAt: asDate(assessment.startedAt),
        updatedAt: asDate(assessment.completedAt),
      })
      .onConflictDoUpdate({
        target: coachAssessment.id,
        set: {
          problemSlugs: assessment.problemSlugs,
          status: 'completed',
          completedAt: asDate(assessment.completedAt),
          score: assessment.score,
          correctCount: assessment.correctCount,
          totalCount: assessment.totalCount,
          weakTopics: assessment.weakTopics,
          recommendation: assessment.recommendation,
          assessmentVersion: assessment.version,
          verificationToken: assessment.verificationToken,
          updatedAt: asDate(assessment.completedAt),
        },
      });
  }

  for (const event of state.events) {
    const slug = event.problemSlug;
    const eventId = namespacedId('event', userId, event.id);
    const rawVariant = event.properties?.experimentVariant;
    const experimentVariant =
      rawVariant === 'A' || rawVariant === 'B' ? rawVariant : undefined;
    await tx
      .insert(coachProductEvent)
      .values({
        id: eventId,
        userId,
        sessionId: event.sessionId,
        name: event.name,
        problemId: slug ? problemIdBySlug.get(slug) : undefined,
        problemSlugSnapshot: slug,
        properties: event.properties ?? {},
        experimentVariant,
        occurredAt: asDate(event.timestamp),
        receivedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: coachProductEvent.id,
        set: {
          properties: event.properties ?? {},
          experimentVariant,
        },
      });
  }

  const nextRevision = currentRevision + 1;
  await tx
    .update(coachSyncState)
    .set({ revision: nextRevision, updatedAt: timestamp })
    .where(eq(coachSyncState.userId, userId));
  if (appliedMutationIds.length) {
    await tx
      .insert(coachSyncMutationTable)
      .values(
        appliedMutationIds.map((mutationId) => ({
          userId,
          mutationId,
          resultRevision: nextRevision,
          createdAt: timestamp,
        }))
      )
      .onConflictDoNothing({
        target: [
          coachSyncMutationTable.userId,
          coachSyncMutationTable.mutationId,
        ],
      });
  }
  return {
    revision: nextRevision,
    appliedMutationIds,
    replayedMutationIds,
  };
}

async function persistCoachData(
  userId: string,
  state: CoachState,
  importedDraftSync: ImportedDraftSync,
  reviewProgress: ReviewProgressState,
  expectedRevision: number,
  requestedMutationIds: string[] = []
): Promise<CoachSyncResult> {
  const database = dbPostgres();
  return database.transaction((tx) =>
    persistCoachDataInTransaction(
      tx,
      userId,
      state,
      importedDraftSync,
      reviewProgress,
      expectedRevision,
      requestedMutationIds
    )
  );
}

export async function saveCoachData(
  userId: string,
  state: CoachState,
  importedProblem: Problem | null,
  importedDrafts: ImportedDraftRecord[] | undefined,
  reviewProgress: ReviewProgressState,
  expectedRevision: number
): Promise<number> {
  const timestamp = new Date().toISOString();
  const records =
    importedDrafts ??
    (importedProblem
      ? [
          {
            problem: importedProblem,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ]
      : []);
  const result = await persistCoachData(
    userId,
    state,
    {
      mode: 'replace',
      records,
      deletedSlugs: [],
      activeSlug: importedProblem?.slug ?? records[0]?.problem.slug ?? null,
      activeChanged: true,
    },
    reviewProgress,
    expectedRevision
  );
  return result.revision;
}

export async function applyCoachDataMutations(
  userId: string,
  expectedRevision: number,
  mutations: CoachSyncMutation[]
): Promise<CoachSyncResult> {
  const database = dbPostgres();
  return database.transaction(async (tx) => {
    const currentRevision = await lockSyncState(tx, userId);
    const requestedIds = Array.from(
      new Set(mutations.map((mutation) => mutation.id))
    );
    const existingMutations = requestedIds.length
      ? await tx
          .select({ mutationId: coachSyncMutationTable.mutationId })
          .from(coachSyncMutationTable)
          .where(
            and(
              eq(coachSyncMutationTable.userId, userId),
              inArray(coachSyncMutationTable.mutationId, requestedIds)
            )
          )
      : [];
    const replayedMutationIds = existingMutations.map(
      (mutation) => mutation.mutationId
    );
    const appliedMutations = filterUnappliedCoachMutations(
      mutations,
      replayedMutationIds
    );
    if (!appliedMutations.length) {
      return {
        revision: currentRevision,
        appliedMutationIds: [],
        replayedMutationIds,
      };
    }
    if (currentRevision !== expectedRevision) {
      throw new CoachPersistenceConflict(currentRevision, replayedMutationIds);
    }

    const current = await loadCoachDataFromTransaction(tx, userId);
    const next = applyCoachSyncMutations(current, appliedMutations);
    const touchedSlugs = new Set<string>();
    let activeChanged =
      current.importedProblem?.slug !== next.importedProblem?.slug;
    for (const mutation of appliedMutations) {
      for (const record of mutation.importedDraftUpserts ?? []) {
        touchedSlugs.add(record.problem.slug);
      }
      for (const slug of mutation.deletedImportedDraftSlugs ?? []) {
        touchedSlugs.add(slug);
      }
      const activeWasDeleted = mutation.deletedImportedDraftSlugs?.includes(
        current.importedProblem?.slug ?? ''
      );
      if (Object.hasOwn(mutation, 'importedProblem') || activeWasDeleted) {
        activeChanged = true;
        if (
          !mutation.importedDraftUpserts?.length &&
          !mutation.deletedImportedDraftSlugs?.length
        ) {
          touchedSlugs.add(
            mutation.importedProblem?.slug ??
              current.importedProblem?.slug ??
              'imported-draft'
          );
        }
      }
    }
    const nextSlugs = new Set(
      next.importedDrafts.map((record) => record.problem.slug)
    );
    for (const record of current.importedDrafts) {
      if (!nextSlugs.has(record.problem.slug)) {
        touchedSlugs.add(record.problem.slug);
      }
    }
    const result = await persistCoachDataInTransaction(
      tx,
      userId,
      next.state,
      {
        mode: 'delta',
        records: next.importedDrafts.filter((record) =>
          touchedSlugs.has(record.problem.slug)
        ),
        deletedSlugs: Array.from(touchedSlugs).filter(
          (slug) => !nextSlugs.has(slug)
        ),
        activeSlug: next.importedProblem?.slug ?? null,
        activeChanged,
      },
      next.reviewProgress,
      expectedRevision,
      appliedMutations.map((mutation) => mutation.id)
    );
    return {
      ...result,
      replayedMutationIds: [
        ...replayedMutationIds,
        ...result.replayedMutationIds,
      ],
    };
  });
}

async function loadCoachDataFromTransaction(
  tx: CoachTransaction,
  userId: string
): Promise<PersistedCoachData> {
  const [
    profiles,
    sessions,
    artifacts,
    assessments,
    events,
    importedRows,
    reviewRows,
    syncRows,
  ] = await Promise.all([
    tx
      .select()
      .from(coachLearningProfile)
      .where(eq(coachLearningProfile.userId, userId))
      .limit(1),
    tx
      .select()
      .from(coachPracticeSession)
      .where(eq(coachPracticeSession.userId, userId))
      .orderBy(asc(coachPracticeSession.startedAt))
      .limit(100),
    tx
      .select()
      .from(coachLearningArtifact)
      .where(eq(coachLearningArtifact.userId, userId))
      .orderBy(desc(coachLearningArtifact.createdAt))
      .limit(100),
    tx
      .select()
      .from(coachAssessment)
      .where(eq(coachAssessment.userId, userId))
      .orderBy(desc(coachAssessment.startedAt))
      .limit(20),
    tx
      .select()
      .from(coachProductEvent)
      .where(eq(coachProductEvent.userId, userId))
      .orderBy(desc(coachProductEvent.occurredAt))
      .limit(300),
    tx
      .select()
      .from(coachProblem)
      .where(eq(coachProblem.ownerUserId, userId))
      .orderBy(desc(coachProblem.isActive), desc(coachProblem.updatedAt))
      .limit(20),
    tx
      .select()
      .from(coachReviewItem)
      .where(eq(coachReviewItem.userId, userId))
      .orderBy(asc(coachReviewItem.problemSlug))
      .limit(500),
    tx
      .select({ revision: coachSyncState.revision })
      .from(coachSyncState)
      .where(eq(coachSyncState.userId, userId))
      .limit(1),
  ]);

  const importedProblemIds = importedRows.map((row) => row.id);
  const importedTests = importedProblemIds.length
    ? await tx
        .select()
        .from(coachTestCase)
        .where(inArray(coachTestCase.problemId, importedProblemIds))
        .orderBy(asc(coachTestCase.ordinal))
    : [];
  const importedTestsByProblem = new Map<string, typeof importedTests>();
  for (const test of importedTests) {
    const current = importedTestsByProblem.get(test.problemId) ?? [];
    current.push(test);
    importedTestsByProblem.set(test.problemId, current);
  }

  const sessionIds = sessions.map((session) => session.id);
  const runs = sessionIds.length
    ? await tx
        .select()
        .from(coachCodeRun)
        .where(inArray(coachCodeRun.sessionId, sessionIds))
        .orderBy(desc(coachCodeRun.executedAt))
        .limit(200)
    : [];
  const orderedRuns = [...runs].reverse();
  const runsBySession = new Map<string, CodeRunResult[]>();
  for (const row of orderedRuns) {
    const run: CodeRunResult = {
      id: clientIdFromNamespaced('run', userId, row.id),
      problemSlug: row.problemSlugSnapshot,
      language: row.language as CodeRunResult['language'],
      status: row.status as CodeRunResult['status'],
      passedTests: row.passedTests,
      totalTests: row.totalTests,
      testResults: row.testResults as CodeRunResult['testResults'],
      console: row.console as string[],
      error: row.error ?? undefined,
      durationMs: row.durationMs,
      executedAt: asIso(row.executedAt),
      codeSnapshot: row.codeSnapshot,
      testScope: row.testScope as CodeRunResult['testScope'],
      submitted: row.submitted,
    };
    const current = runsBySession.get(row.sessionId) ?? [];
    current.push(run);
    runsBySession.set(row.sessionId, current);
  }

  const state = createInitialCoachState();
  const profile = profiles[0];
  if (profile) {
    state.profile = {
      goal: profile.goal as LearningProfile['goal'],
      preferredLanguage:
        profile.preferredLanguage as LearningProfile['preferredLanguage'],
      weeklyTarget: profile.weeklyTarget,
      dailyMinutes: profile.dailyMinutes,
      weeklyGoal: profile.weeklyTarget,
      onboardingCompleted: profile.onboardingCompleted,
      createdAt: asIso(profile.createdAt),
      onboardedAt: asIso(profile.onboardedAt ?? profile.createdAt),
    };
  }

  for (const row of sessions) {
    const sessionRuns = (runsBySession.get(row.id) ?? []).slice(-30);
    state.sessions[row.problemSlugSnapshot] = {
      problemSlug: row.problemSlugSnapshot,
      code: row.code as CoachState['code'][string],
      runs: sessionRuns,
      hintLevel: row.hintLevel as 0 | 1 | 2 | 3,
      diagnosisCount: row.diagnosisCount,
      correctedAfterDiagnosis: row.correctedAfterDiagnosis,
      startedAt: asIso(row.startedAt),
      updatedAt: asIso(row.updatedAt),
      completedAt: row.completedAt ? asIso(row.completedAt) : undefined,
    };
    state.code[row.problemSlugSnapshot] =
      row.code as CoachState['code'][string];
    if (row.completedAt)
      state.completedProblemIds.push(row.problemSlugSnapshot);
  }
  state.runs = orderedRuns
    .map((row) => ({
      id: clientIdFromNamespaced('run', userId, row.id),
      problemSlug: row.problemSlugSnapshot,
      language: row.language as CodeRunResult['language'],
      status: row.status as CodeRunResult['status'],
      passedTests: row.passedTests,
      totalTests: row.totalTests,
      testResults: row.testResults as CodeRunResult['testResults'],
      console: row.console as string[],
      error: row.error ?? undefined,
      durationMs: row.durationMs,
      executedAt: asIso(row.executedAt),
      codeSnapshot: row.codeSnapshot,
      testScope: row.testScope as CodeRunResult['testScope'],
      submitted: row.submitted,
    }))
    .slice(-200);

  state.artifacts = [...artifacts]
    .reverse()
    .map(
      (row): LearningArtifact => ({
        id: clientIdFromNamespaced('artifact', userId, row.id),
        type: row.type as LearningArtifact['type'],
        locale: row.locale as LearningArtifact['locale'],
        problemSlug: row.problemSlugSnapshot ?? undefined,
        runId: row.runId
          ? clientIdFromNamespaced('run', userId, row.runId)
          : undefined,
        title: row.title,
        summary: row.summary,
        details: row.details as string[],
        evidence: row.evidence as string[],
        nextAction: row.nextAction ?? undefined,
        diagnosisCategory:
          (row.diagnosisCategory as LearningArtifact['diagnosisCategory']) ??
          undefined,
        hint: (row.hint as LearningArtifact['hint']) ?? undefined,
        counterexample:
          (row.counterexample as LearningArtifact['counterexample']) ??
          undefined,
        reviewCard:
          (row.reviewCard as LearningArtifact['reviewCard']) ?? undefined,
        draft: (row.draft as LearningArtifact['draft']) ?? undefined,
        generationMode:
          row.generationMode as LearningArtifact['generationMode'],
        model: row.model ?? undefined,
        promptVersion: row.promptVersion ?? undefined,
        traceId: row.traceId
          ? clientIdFromNamespaced('trace', userId, row.traceId)
          : undefined,
        latencyMs: row.latencyMs ?? undefined,
        createdAt: asIso(row.createdAt),
      })
    )
    .slice(-100);

  const activeAssessment = assessments.find((row) => row.status === 'active');
  state.activeAssessment = activeAssessment
    ? {
        id: clientIdFromNamespaced('assessment', userId, activeAssessment.id),
        problemSlugs: activeAssessment.problemSlugs,
        startedAt: asIso(activeAssessment.startedAt),
        durationMinutes: activeAssessment.durationMinutes,
      }
    : null;
  state.assessments = assessments
    .filter((row) => row.status === 'completed' && row.completedAt)
    .map((row) => ({
      id: clientIdFromNamespaced('assessment', userId, row.id),
      problemSlugs: row.problemSlugs,
      startedAt: asIso(row.startedAt),
      completedAt: asIso(row.completedAt),
      score: row.score ?? 0,
      correctCount: row.correctCount ?? 0,
      totalCount: row.totalCount ?? 0,
      weakTopics:
        row.weakTopics as CoachState['assessments'][number]['weakTopics'],
      recommendation: row.recommendation,
      version: row.assessmentVersion ?? undefined,
      verificationToken: row.verificationToken ?? undefined,
    }))
    .slice(0, 20)
    .reverse();

  state.events = [...events]
    .reverse()
    .map(
      (row): ProductEvent => ({
        id: clientIdFromNamespaced('event', userId, row.id),
        name: row.name as ProductEvent['name'],
        timestamp: asIso(row.occurredAt),
        sessionId: row.sessionId,
        problemSlug: row.problemSlugSnapshot ?? undefined,
        properties: row.properties as ProductEvent['properties'],
      })
    )
    .slice(-300);

  const importedDrafts: ImportedDraftRecord[] = importedRows.map(
    (imported) => ({
      problem: {
        id: clientIdFromNamespaced('imported_problem', userId, imported.id),
        slug: imported.slug,
        title: imported.title as Problem['title'],
        description: imported.description as Problem['description'],
        difficulty: imported.difficulty as Problem['difficulty'],
        topics: imported.topics,
        entryPoint: imported.entryPoint,
        templates: imported.templates as Problem['templates'],
        tests: (importedTestsByProblem.get(imported.id) ?? []).map((test) => ({
          id: importedTestClientId(userId, imported.slug, test.id),
          args: test.args as Problem['tests'][number]['args'],
          expected: test.expected as Problem['tests'][number]['expected'],
          isSample: test.isSample,
          label: (test.label as Problem['tests'][number]['label']) ?? undefined,
        })),
        examples: imported.examples as Problem['examples'],
        constraints: imported.constraints as Problem['constraints'],
        hints: imported.hints as Problem['hints'],
        reviewPoints: imported.reviewPoints as Problem['reviewPoints'],
        estimatedMinutes: imported.estimatedMinutes,
        sourceStatement: imported.sourceStatement ?? undefined,
        sourceUrl: imported.sourceUrl ?? undefined,
      },
      createdAt: asIso(imported.createdAt),
      updatedAt: asIso(imported.updatedAt),
    })
  );
  const importedProblem =
    importedRows.find((row) => row.isActive) && importedDrafts.length
      ? (importedDrafts[importedRows.findIndex((row) => row.isActive)]
          ?.problem ?? null)
      : (importedDrafts[0]?.problem ?? null);

  const reviewProgress = createInitialReviewProgress();
  reviewProgress.items = Object.fromEntries(
    reviewRows.map((row) => {
      const item: ReviewItem = {
        problemSlug: row.problemSlug,
        status: row.status as ReviewItem['status'],
        source: row.source as ReviewItem['source'],
        dueAt: asIso(row.dueAt),
        intervalDays: row.intervalDays,
        repetitions: row.repetitions,
        easeFactor: row.easeFactor,
        updatedAt: asIso(row.updatedAt),
        lastObservedRunAt: row.lastObservedRunAt
          ? asIso(row.lastObservedRunAt)
          : undefined,
        lastFailureAt: row.lastFailureAt ? asIso(row.lastFailureAt) : undefined,
        lastReviewedAt: row.lastReviewedAt
          ? asIso(row.lastReviewedAt)
          : undefined,
        lastRating: (row.lastRating as ReviewItem['lastRating']) ?? undefined,
      };
      return [row.problemSlug, item];
    })
  );

  const hasData = Boolean(
    profile ||
      sessions.length ||
      artifacts.length ||
      assessments.length ||
      events.length ||
      reviewRows.length ||
      importedDrafts.length
  );
  return {
    state,
    importedProblem,
    importedDrafts,
    reviewProgress,
    hasData,
    revision: syncRows[0]?.revision ?? 0,
  };
}

export async function loadCoachData(
  userId: string
): Promise<PersistedCoachData> {
  const database = dbPostgres();
  return database.transaction((tx) => loadCoachDataFromTransaction(tx, userId));
}

export async function deleteCoachData(userId: string): Promise<number> {
  const database = dbPostgres();
  return database.transaction(async (tx) => {
    const currentRevision = await lockSyncState(tx, userId);
    await tx
      .delete(coachProductEvent)
      .where(eq(coachProductEvent.userId, userId));
    await tx
      .delete(coachLearningArtifact)
      .where(eq(coachLearningArtifact.userId, userId));
    await tx.delete(coachReviewItem).where(eq(coachReviewItem.userId, userId));
    await tx.delete(coachAssessment).where(eq(coachAssessment.userId, userId));
    await tx
      .delete(coachPracticeSession)
      .where(eq(coachPracticeSession.userId, userId));
    await tx.delete(coachProblem).where(eq(coachProblem.ownerUserId, userId));
    await tx
      .delete(coachLearningProfile)
      .where(eq(coachLearningProfile.userId, userId));
    const nextRevision = currentRevision + 1;
    await tx
      .update(coachSyncState)
      .set({ revision: nextRevision, updatedAt: new Date() })
      .where(eq(coachSyncState.userId, userId));
    return nextRevision;
  });
}
