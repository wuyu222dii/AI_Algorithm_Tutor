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
  coachSyncState,
  coachTestCase,
} from '@/config/db/schema.postgres';

import { createInitialCoachState } from './storage';
import {
  CoachState,
  CodeRunResult,
  LearningArtifact,
  LearningProfile,
  Problem,
  ProductEvent,
} from './types';

export interface PersistedCoachData {
  state: CoachState;
  importedProblem: Problem | null;
  hasData: boolean;
  revision: number;
}

export class CoachPersistenceConflict extends Error {
  constructor(public readonly currentRevision: number) {
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

async function syncImportedProblem(
  tx: CoachTransaction,
  userId: string,
  problem: Problem | null
): Promise<void> {
  const [existing] = await tx
    .select({ id: coachProblem.id })
    .from(coachProblem)
    .where(
      and(
        eq(coachProblem.ownerUserId, userId),
        eq(coachProblem.slug, 'imported-draft')
      )
    )
    .limit(1);

  if (!problem) {
    if (existing) {
      await tx.delete(coachProblem).where(eq(coachProblem.id, existing.id));
    }
    return;
  }

  const id = existing?.id ?? stableId('imported_problem', [userId]);
  const timestamp = new Date();
  await tx
    .insert(coachProblem)
    .values({
      id,
      slug: 'imported-draft',
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
      contentVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: coachProblem.id,
      set: {
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
        updatedAt: timestamp,
      },
    });

  await tx.delete(coachTestCase).where(eq(coachTestCase.problemId, id));
  if (problem.tests.length > 0) {
    await tx.insert(coachTestCase).values(
      problem.tests.map((test, ordinal) => ({
        id: namespacedId('test', userId, test.id),
        problemId: id,
        ordinal,
        args: test.args,
        expected: test.expected,
        isSample: test.isSample,
        label: test.label,
        timeoutMs: 3000,
        createdAt: timestamp,
        updatedAt: timestamp,
      }))
    );
  }
}

export async function saveCoachData(
  userId: string,
  state: CoachState,
  importedProblem: Problem | null,
  expectedRevision: number
): Promise<number> {
  const database = dbPostgres();
  return database.transaction(async (tx) => {
    const timestamp = new Date();
    const currentRevision = await lockSyncState(tx, userId);
    if (currentRevision !== expectedRevision) {
      throw new CoachPersistenceConflict(currentRevision);
    }
    await syncImportedProblem(tx, userId, importedProblem);

    if (state.profile) {
      await tx
        .insert(coachLearningProfile)
        .values({
          userId,
          goal: state.profile.goal,
          preferredLanguage: state.profile.preferredLanguage,
          weeklyTarget: state.profile.weeklyTarget,
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
        or(
          isNull(coachProblem.ownerUserId),
          eq(coachProblem.ownerUserId, userId)
        )
      );
    const problemIdBySlug = new Map<string, string>();
    for (const row of problemRows) {
      if (!problemIdBySlug.has(row.slug) || row.ownerUserId === userId) {
        problemIdBySlug.set(row.slug, row.id);
      }
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
            completedAt: session.completedAt
              ? asDate(session.completedAt)
              : null,
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
              codeSnapshot:
                run.codeSnapshot ?? session.code[run.language] ?? '',
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
    return nextRevision;
  });
}

export async function loadCoachData(
  userId: string
): Promise<PersistedCoachData> {
  const database = dbPostgres();
  return database.transaction(async (tx) => {
    const [
      profiles,
      sessions,
      artifacts,
      assessments,
      events,
      importedRows,
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
        .orderBy(desc(coachProblem.updatedAt))
        .limit(1),
      tx
        .select({ revision: coachSyncState.revision })
        .from(coachSyncState)
        .where(eq(coachSyncState.userId, userId))
        .limit(1),
    ]);

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

    let importedProblem: Problem | null = null;
    const imported = importedRows[0];
    if (imported) {
      const tests = await tx
        .select()
        .from(coachTestCase)
        .where(eq(coachTestCase.problemId, imported.id))
        .orderBy(asc(coachTestCase.ordinal));
      importedProblem = {
        id: imported.id,
        slug: imported.slug,
        title: imported.title as Problem['title'],
        description: imported.description as Problem['description'],
        difficulty: imported.difficulty as Problem['difficulty'],
        topics: imported.topics,
        entryPoint: imported.entryPoint,
        templates: imported.templates as Problem['templates'],
        tests: tests.map((test) => ({
          id: clientIdFromNamespaced('test', userId, test.id),
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
      };
    }

    const hasData = Boolean(
      profile ||
        sessions.length ||
        artifacts.length ||
        assessments.length ||
        events.length ||
        importedProblem
    );
    return {
      state,
      importedProblem,
      hasData,
      revision: syncRows[0]?.revision ?? 0,
    };
  });
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
