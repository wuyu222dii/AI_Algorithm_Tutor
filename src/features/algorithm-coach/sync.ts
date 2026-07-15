import {
  removeImportedDraftRecords,
  upsertImportedDraftRecords,
} from './imported-drafts';
import {
  AssessmentResult,
  CoachState,
  CoachSyncMutation,
  CodeRunResult,
  CorrectionEpisode,
  DailyLearningPlan,
  ImportedDraftRecord,
  LearningArtifact,
  PracticeSession,
  Problem,
  ProductEvent,
  ReviewAttempt,
  ReviewItem,
  ReviewProgressState,
} from './types';

export interface CoachSyncDocument {
  state: CoachState;
  importedProblem: Problem | null;
  importedDrafts: ImportedDraftRecord[];
  reviewProgress: ReviewProgressState;
}

const SESSION_VERSION_SEPARATOR = '::v';

export function normalizeProblemContentVersion(
  contentVersion: number | undefined
): number {
  return Number.isInteger(contentVersion) && Number(contentVersion) > 0
    ? Number(contentVersion)
    : 1;
}

/** Version 1 keeps the original slug key for existing local and cloud data. */
export function getPracticeSessionKey(
  problemSlug: string,
  contentVersion: number | undefined = 1
): string {
  const version = normalizeProblemContentVersion(contentVersion);
  return version === 1
    ? problemSlug
    : `${problemSlug}${SESSION_VERSION_SEPARATOR}${version}`;
}

function slugFromSessionKey(key: string): string {
  const separatorIndex = key.lastIndexOf(SESSION_VERSION_SEPARATOR);
  if (separatorIndex < 1) return key;
  const version = Number(
    key.slice(separatorIndex + SESSION_VERSION_SEPARATOR.length)
  );
  return Number.isInteger(version) && version > 1
    ? key.slice(0, separatorIndex)
    : key;
}

export function coachSyncRetryDelay(attempt: number): number {
  const safeAttempt = Number.isInteger(attempt) ? Math.max(0, attempt) : 0;
  return Math.min(30_000, 1000 * 2 ** safeAttempt);
}

export function filterUnappliedCoachMutations(
  mutations: CoachSyncMutation[],
  replayedMutationIds: Iterable<string>
): CoachSyncMutation[] {
  const replayed = new Set(replayedMutationIds);
  return mutations.filter((mutation) => !replayed.has(mutation.id));
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedRecordValues<T>(
  previous: Record<string, T>,
  next: Record<string, T>
): Record<string, T> | undefined {
  const changed = Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => !sameValue(previous[key], value)
    )
  );
  return Object.keys(changed).length ? changed : undefined;
}

function changedArrayValues<T>(
  previous: T[],
  next: T[],
  key: (value: T) => string
): T[] | undefined {
  const previousByKey = new Map(previous.map((value) => [key(value), value]));
  const changed = next.filter(
    (value) => !sameValue(previousByKey.get(key(value)), value)
  );
  return changed.length ? changed : undefined;
}

function runKey(run: CodeRunResult): string {
  return [
    run.problemSlug,
    normalizeProblemContentVersion(run.problemContentVersion),
    run.id ??
      [
        run.language,
        run.executedAt,
        run.status,
        run.passedTests,
        run.totalTests,
      ].join('|'),
  ].join('|');
}

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function earlierTimestamp(left: string, right: string): string {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (!leftTime) return right;
  if (!rightTime) return left;
  return leftTime <= rightTime ? left : right;
}

function laterTimestamp(left: string, right: string): string {
  return timestamp(left) >= timestamp(right) ? left : right;
}

function earliestCompletion(
  left: string | undefined,
  right: string | undefined
): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return earlierTimestamp(left, right);
}

function mergeRuns(
  current: CodeRunResult[],
  incoming: CodeRunResult[],
  limit: number
): CodeRunResult[] {
  const byKey = new Map(current.map((run) => [runKey(run), run]));
  for (const run of incoming) byKey.set(runKey(run), run);
  return Array.from(byKey.values())
    .sort((left, right) => {
      const timeDifference =
        timestamp(left.executedAt) - timestamp(right.executedAt);
      return timeDifference || runKey(left).localeCompare(runKey(right));
    })
    .slice(-limit);
}

function mergePracticeSession(
  current: PracticeSession,
  incoming: PracticeSession,
  problemSlug: string
): PracticeSession {
  const incomingIsNewer =
    timestamp(incoming.updatedAt) >= timestamp(current.updatedAt);
  const older = incomingIsNewer ? current : incoming;
  const newer = incomingIsNewer ? incoming : current;
  const completedAt = earliestCompletion(
    current.completedAt,
    incoming.completedAt
  );
  const merged: PracticeSession = {
    ...older,
    ...newer,
    problemSlug,
    code: { ...older.code, ...newer.code },
    runs: mergeRuns(current.runs, incoming.runs, 30),
    hintLevel: Math.max(current.hintLevel, incoming.hintLevel) as 0 | 1 | 2 | 3,
    diagnosisCount: Math.max(current.diagnosisCount, incoming.diagnosisCount),
    correctedAfterDiagnosis:
      current.correctedAfterDiagnosis || incoming.correctedAfterDiagnosis,
    startedAt: earlierTimestamp(current.startedAt, incoming.startedAt),
    updatedAt: laterTimestamp(current.updatedAt, incoming.updatedAt),
  };
  if (completedAt) merged.completedAt = completedAt;
  else delete merged.completedAt;
  return merged;
}

function normalizePracticeSession(
  session: PracticeSession,
  fallbackKey: string
): PracticeSession {
  const problemSlug = session.problemSlug || slugFromSessionKey(fallbackKey);
  const problemContentVersion = normalizeProblemContentVersion(
    session.problemContentVersion
  );
  return {
    ...session,
    problemSlug,
    problemContentVersion,
    runs: (session.runs ?? [])
      .filter(
        (run) =>
          normalizeProblemContentVersion(
            run.problemContentVersion ?? problemContentVersion
          ) === problemContentVersion
      )
      .map((run) => ({
        ...run,
        problemSlug,
        problemContentVersion,
      })),
  };
}

function upsertSession(
  sessions: Record<string, PracticeSession>,
  rawKey: string,
  session: PracticeSession
): void {
  const normalized = normalizePracticeSession(session, rawKey);
  const key = getPracticeSessionKey(
    normalized.problemSlug,
    normalized.problemContentVersion
  );
  const existing = sessions[key];
  sessions[key] = existing
    ? mergePracticeSession(existing, normalized, normalized.problemSlug)
    : normalized;
}

function normalizeSessions(
  sessions: Record<string, PracticeSession>
): Record<string, PracticeSession> {
  const normalized: Record<string, PracticeSession> = {};
  for (const [key, session] of Object.entries(sessions)) {
    upsertSession(normalized, key, session);
  }
  return normalized;
}

function mergeSessions(
  current: Record<string, PracticeSession>,
  incoming: Record<string, PracticeSession> | undefined
): Record<string, PracticeSession> {
  const merged = normalizeSessions(current);
  for (const [key, session] of Object.entries(incoming ?? {})) {
    upsertSession(merged, key, session);
  }
  return merged;
}

function resolveSessionCodeKey(
  rawKey: string,
  sessions: Record<string, PracticeSession>
): string {
  if (sessions[rawKey]) return rawKey;
  const candidates = Object.entries(sessions).filter(
    ([, session]) => session.problemSlug === rawKey
  );
  return candidates.length === 1 ? candidates[0][0] : rawKey;
}

function mergeSessionCode(
  current: Pick<CoachState, 'code'>,
  sessions: Record<string, PracticeSession>,
  changes: CoachSyncMutation['changes'],
  mutationCreatedAt: string
): {
  sessions: Record<string, PracticeSession>;
  code: CoachState['code'];
} {
  const synchronizedSessions = { ...sessions };
  const code: CoachState['code'] = {};

  for (const [rawKey, storedCode] of Object.entries(current.code)) {
    const key = resolveSessionCodeKey(rawKey, synchronizedSessions);
    code[key] = { ...code[key], ...storedCode };
  }

  const changedSessionKeyByRawKey = new Map(
    Object.entries(changes.sessions ?? {}).map(([rawKey, session]) => {
      const normalized = normalizePracticeSession(session, rawKey);
      return [
        rawKey,
        getPracticeSessionKey(
          normalized.problemSlug,
          normalized.problemContentVersion
        ),
      ] as const;
    })
  );
  const changedSessionKeys = new Set(changedSessionKeyByRawKey.values());

  for (const [rawKey, incomingCode] of Object.entries(changes.code ?? {})) {
    const sessionKey =
      changedSessionKeyByRawKey.get(rawKey) ??
      resolveSessionCodeKey(rawKey, synchronizedSessions);
    const session = synchronizedSessions[sessionKey];
    if (!session) {
      code[sessionKey] = { ...code[sessionKey], ...incomingCode };
      continue;
    }
    if (
      !changedSessionKeys.has(sessionKey) &&
      timestamp(mutationCreatedAt) >= timestamp(session.updatedAt)
    ) {
      synchronizedSessions[sessionKey] = {
        ...session,
        code: { ...session.code, ...incomingCode },
        updatedAt: laterTimestamp(session.updatedAt, mutationCreatedAt),
      };
    }
  }

  for (const [sessionKey, session] of Object.entries(synchronizedSessions)) {
    code[sessionKey] = { ...session.code };
  }
  return { sessions: synchronizedSessions, code };
}

function mergeReviewItems(
  current: Record<string, ReviewItem>,
  incoming: Record<string, ReviewItem>
): Record<string, ReviewItem> {
  const merged = { ...current };
  for (const [slug, item] of Object.entries(incoming)) {
    const existing = merged[slug];
    const incomingUpdatedAt = Date.parse(item.updatedAt);
    const existingUpdatedAt = Date.parse(existing?.updatedAt ?? '');
    if (
      !existing ||
      !Number.isFinite(existingUpdatedAt) ||
      (Number.isFinite(incomingUpdatedAt) &&
        incomingUpdatedAt >= existingUpdatedAt)
    ) {
      merged[slug] = item;
    }
  }
  return merged;
}

function createMutationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `mutation_${crypto.randomUUID()}`;
  }
  return `mutation_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

export function createCoachSyncMutation(
  previous: CoachSyncDocument,
  next: CoachSyncDocument,
  baseRevision: number,
  metadata: { id?: string; createdAt?: string } = {}
): CoachSyncMutation | null {
  const changes: CoachSyncMutation['changes'] = {};

  if (!sameValue(previous.state.profile, next.state.profile)) {
    changes.profile = next.state.profile;
  }
  changes.sessions = changedRecordValues(
    previous.state.sessions,
    next.state.sessions
  );
  changes.artifacts = changedArrayValues(
    previous.state.artifacts,
    next.state.artifacts,
    (artifact) => artifact.id
  );
  changes.events = changedArrayValues(
    previous.state.events,
    next.state.events,
    (event) => event.id
  );
  if (
    !sameValue(previous.state.activeAssessment, next.state.activeAssessment)
  ) {
    changes.activeAssessment = next.state.activeAssessment;
  }
  changes.assessments = changedArrayValues(
    previous.state.assessments,
    next.state.assessments,
    (assessment) => assessment.id
  );
  changes.dailyPlans = changedRecordValues(
    previous.state.dailyPlans,
    next.state.dailyPlans
  );
  changes.reviewAttempts = changedArrayValues(
    previous.state.reviewAttempts,
    next.state.reviewAttempts,
    (attempt) => attempt.id
  );
  changes.correctionEpisodes = changedArrayValues(
    previous.state.correctionEpisodes,
    next.state.correctionEpisodes,
    (episode) => episode.id
  );
  changes.code = changedRecordValues(previous.state.code, next.state.code);
  changes.runs = changedArrayValues(
    previous.state.runs,
    next.state.runs,
    runKey
  );
  changes.completedProblemIds = changedArrayValues(
    previous.state.completedProblemIds,
    next.state.completedProblemIds,
    (problemSlug) => problemSlug
  );
  changes.reviewItems = changedRecordValues(
    previous.reviewProgress.items,
    next.reviewProgress.items
  );

  const previousDraftBySlug = new Map(
    previous.importedDrafts.map((record) => [record.problem.slug, record])
  );
  const nextDraftSlugs = new Set(
    next.importedDrafts.map((record) => record.problem.slug)
  );
  const importedDraftUpserts = next.importedDrafts.filter(
    (record) => !sameValue(previousDraftBySlug.get(record.problem.slug), record)
  );
  const deletedImportedDraftSlugs = previous.importedDrafts
    .map((record) => record.problem.slug)
    .filter((slug) => !nextDraftSlugs.has(slug));

  for (const key of Object.keys(changes) as Array<keyof typeof changes>) {
    if (changes[key] === undefined) delete changes[key];
  }

  const importedProblemChanged = !sameValue(
    previous.importedProblem,
    next.importedProblem
  );
  if (
    !Object.keys(changes).length &&
    !importedProblemChanged &&
    !importedDraftUpserts.length &&
    !deletedImportedDraftSlugs.length
  ) {
    return null;
  }

  return {
    id: metadata.id ?? createMutationId(),
    baseRevision,
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    changes,
    ...(importedProblemChanged
      ? { importedProblem: next.importedProblem }
      : {}),
    ...(importedDraftUpserts.length ? { importedDraftUpserts } : {}),
    ...(deletedImportedDraftSlugs.length ? { deletedImportedDraftSlugs } : {}),
  };
}

function upsertArray<T>(
  current: T[],
  incoming: T[] | undefined,
  key: (value: T) => string,
  limit: number
): T[] {
  if (!incoming?.length) return current;
  const byKey = new Map(current.map((value) => [key(value), value]));
  for (const value of incoming) byKey.set(key(value), value);
  return Array.from(byKey.values()).slice(-limit);
}

function limitReviewItems(
  items: Record<string, ReviewItem>,
  limit: number
): Record<string, ReviewItem> {
  return Object.fromEntries(
    Object.entries(items)
      .sort(([, left], [, right]) => {
        const timeDifference =
          timestamp(right.updatedAt) - timestamp(left.updatedAt);
        return (
          timeDifference || left.problemSlug.localeCompare(right.problemSlug)
        );
      })
      .slice(0, limit)
  );
}

/**
 * Collapse a potentially long offline queue into its final field-level intent.
 * The newest mutation id is retained so appending while an older request is in
 * flight cannot make that older acknowledgement remove newer local changes.
 */
export function compactCoachSyncQueue(
  queue: CoachSyncMutation[]
): CoachSyncMutation[] {
  if (queue.length <= 1) return queue;

  const lastMutation = queue.at(-1)!;
  const changes: CoachSyncMutation['changes'] = {};
  let profileWasSet = false;
  let profile: CoachSyncMutation['changes']['profile'];
  let activeAssessmentWasSet = false;
  let activeAssessment: CoachSyncMutation['changes']['activeAssessment'];
  let sessions: Record<string, PracticeSession> = {};
  let code: CoachState['code'] = {};
  let sessionsWereSet = false;
  let codeWasSet = false;
  let artifacts: LearningArtifact[] = [];
  let events: ProductEvent[] = [];
  let assessments: AssessmentResult[] = [];
  let dailyPlans: Record<string, DailyLearningPlan> = {};
  let reviewAttempts: ReviewAttempt[] = [];
  let correctionEpisodes: CorrectionEpisode[] = [];
  let runs: CodeRunResult[] = [];
  let completedProblemIds: string[] = [];
  let reviewItems: Record<string, ReviewItem> = {};
  let importedProblemWasSet = false;
  let importedProblem: Problem | null | undefined;
  let importedDraftUpserts: ImportedDraftRecord[] = [];
  const deletedImportedDraftSlugs = new Map<string, true>();

  for (const mutation of queue) {
    const incoming = mutation.changes;
    if (Object.hasOwn(incoming, 'profile')) {
      profileWasSet = true;
      profile = incoming.profile ?? null;
    }
    if (Object.hasOwn(incoming, 'activeAssessment')) {
      activeAssessmentWasSet = true;
      activeAssessment = incoming.activeAssessment ?? null;
    }

    if (incoming.sessions) sessionsWereSet = true;
    if (incoming.code) codeWasSet = true;
    sessions = mergeSessions(sessions, incoming.sessions);
    const synchronizedSessionData = mergeSessionCode(
      { code },
      sessions,
      incoming,
      mutation.createdAt
    );
    sessions = synchronizedSessionData.sessions;
    code = synchronizedSessionData.code;

    artifacts = upsertArray(
      artifacts,
      incoming.artifacts,
      (artifact) => artifact.id,
      100
    );
    events = upsertArray(events, incoming.events, (event) => event.id, 300);
    assessments = upsertArray(
      assessments,
      incoming.assessments,
      (assessment) => assessment.id,
      20
    );
    dailyPlans = {
      ...dailyPlans,
      ...(incoming.dailyPlans ?? {}),
    };
    reviewAttempts = upsertArray(
      reviewAttempts,
      incoming.reviewAttempts,
      (attempt) => attempt.id,
      200
    );
    correctionEpisodes = upsertArray(
      correctionEpisodes,
      incoming.correctionEpisodes,
      (episode) => episode.id,
      100
    );
    runs = mergeRuns(runs, incoming.runs ?? [], 200);
    completedProblemIds = upsertArray(
      completedProblemIds,
      incoming.completedProblemIds,
      (problemSlug) => problemSlug,
      500
    );
    if (incoming.reviewItems) {
      reviewItems = limitReviewItems(
        mergeReviewItems(reviewItems, incoming.reviewItems),
        500
      );
    }

    if (Object.hasOwn(mutation, 'importedProblem')) {
      importedProblemWasSet = true;
      importedProblem = mutation.importedProblem ?? null;
    }
    if (mutation.importedDraftUpserts?.length) {
      for (const record of mutation.importedDraftUpserts) {
        deletedImportedDraftSlugs.delete(record.problem.slug);
      }
      importedDraftUpserts = upsertImportedDraftRecords(
        importedDraftUpserts,
        mutation.importedDraftUpserts
      );
    }
    if (mutation.deletedImportedDraftSlugs?.length) {
      importedDraftUpserts = removeImportedDraftRecords(
        importedDraftUpserts,
        mutation.deletedImportedDraftSlugs
      );
      for (const slug of mutation.deletedImportedDraftSlugs) {
        deletedImportedDraftSlugs.delete(slug);
        deletedImportedDraftSlugs.set(slug, true);
      }
    }
  }

  if (profileWasSet) changes.profile = profile ?? null;
  if (sessionsWereSet) changes.sessions = sessions;
  if (artifacts.length) changes.artifacts = artifacts;
  if (events.length) changes.events = events;
  if (activeAssessmentWasSet) {
    changes.activeAssessment = activeAssessment ?? null;
  }
  if (assessments.length) changes.assessments = assessments;
  if (Object.keys(dailyPlans).length) changes.dailyPlans = dailyPlans;
  if (reviewAttempts.length) changes.reviewAttempts = reviewAttempts;
  if (correctionEpisodes.length) {
    changes.correctionEpisodes = correctionEpisodes;
  }
  if (codeWasSet || sessionsWereSet) changes.code = code;
  if (runs.length) changes.runs = runs;
  if (completedProblemIds.length) {
    changes.completedProblemIds = completedProblemIds;
  }
  if (Object.keys(reviewItems).length) changes.reviewItems = reviewItems;

  const compacted: CoachSyncMutation = {
    id: lastMutation.id,
    baseRevision: Math.min(...queue.map((mutation) => mutation.baseRevision)),
    createdAt: lastMutation.createdAt,
    changes,
    ...(importedProblemWasSet
      ? { importedProblem: importedProblem ?? null }
      : {}),
    ...(importedDraftUpserts.length ? { importedDraftUpserts } : {}),
    ...(deletedImportedDraftSlugs.size
      ? {
          deletedImportedDraftSlugs: Array.from(
            deletedImportedDraftSlugs.keys()
          ).slice(-20),
        }
      : {}),
  };

  return [compacted];
}

export function applyCoachSyncMutation(
  document: CoachSyncDocument,
  mutation: CoachSyncMutation
): CoachSyncDocument {
  const { changes } = mutation;
  const hasDraftDelta = Boolean(
    mutation.importedDraftUpserts?.length ||
      mutation.deletedImportedDraftSlugs?.length
  );
  let importedDrafts = upsertImportedDraftRecords(
    removeImportedDraftRecords(
      document.importedDrafts,
      mutation.deletedImportedDraftSlugs ?? []
    ),
    mutation.importedDraftUpserts ?? []
  );
  if (!hasDraftDelta && Object.hasOwn(mutation, 'importedProblem')) {
    const legacySlug = document.importedProblem?.slug ?? 'imported-draft';
    importedDrafts = mutation.importedProblem
      ? upsertImportedDraftRecords(importedDrafts, [
          {
            problem: mutation.importedProblem,
            createdAt: mutation.createdAt,
            updatedAt: mutation.createdAt,
          },
        ])
      : removeImportedDraftRecords(importedDrafts, [legacySlug]);
  }
  const mergedSessions = mergeSessions(
    document.state.sessions,
    changes.sessions
  );
  const synchronizedSessionData = mergeSessionCode(
    document.state,
    mergedSessions,
    changes,
    mutation.createdAt
  );
  const state: CoachState = {
    ...document.state,
    profile: Object.hasOwn(changes, 'profile')
      ? (changes.profile ?? null)
      : document.state.profile,
    sessions: synchronizedSessionData.sessions,
    artifacts: upsertArray<LearningArtifact>(
      document.state.artifacts,
      changes.artifacts,
      (artifact) => artifact.id,
      100
    ),
    events: upsertArray<ProductEvent>(
      document.state.events,
      changes.events,
      (event) => event.id,
      300
    ),
    activeAssessment: Object.hasOwn(changes, 'activeAssessment')
      ? (changes.activeAssessment ?? null)
      : document.state.activeAssessment,
    assessments: upsertArray<AssessmentResult>(
      document.state.assessments,
      changes.assessments,
      (assessment) => assessment.id,
      20
    ),
    dailyPlans: {
      ...document.state.dailyPlans,
      ...(changes.dailyPlans ?? {}),
    },
    reviewAttempts: upsertArray<ReviewAttempt>(
      document.state.reviewAttempts,
      changes.reviewAttempts,
      (attempt) => attempt.id,
      200
    ),
    correctionEpisodes: upsertArray<CorrectionEpisode>(
      document.state.correctionEpisodes,
      changes.correctionEpisodes,
      (episode) => episode.id,
      100
    ),
    code: synchronizedSessionData.code,
    runs: mergeRuns(document.state.runs, changes.runs ?? [], 200),
    completedProblemIds: upsertArray<string>(
      document.state.completedProblemIds,
      changes.completedProblemIds,
      (problemSlug) => problemSlug,
      500
    ),
  };

  let importedProblem = Object.hasOwn(mutation, 'importedProblem')
    ? mutation.importedProblem
      ? (importedDrafts.find(
          (record) => record.problem.slug === mutation.importedProblem?.slug
        )?.problem ??
        importedDrafts[0]?.problem ??
        null)
      : (importedDrafts[0]?.problem ?? null)
    : mutation.deletedImportedDraftSlugs?.includes(
          document.importedProblem?.slug ?? ''
        )
      ? (importedDrafts[0]?.problem ?? null)
      : document.importedProblem;
  if (
    importedProblem &&
    !importedDrafts.some(
      (record) => record.problem.slug === importedProblem?.slug
    )
  ) {
    importedProblem = importedDrafts[0]?.problem ?? null;
  }
  if (!importedProblem && importedDrafts.length) {
    importedProblem = importedDrafts[0]?.problem ?? null;
  }

  return {
    state,
    importedProblem,
    importedDrafts,
    reviewProgress: changes.reviewItems
      ? {
          ...document.reviewProgress,
          items: mergeReviewItems(
            document.reviewProgress.items,
            changes.reviewItems
          ),
        }
      : document.reviewProgress,
  };
}

export function applyCoachSyncMutations(
  document: CoachSyncDocument,
  mutations: CoachSyncMutation[]
): CoachSyncDocument {
  return mutations.reduce(applyCoachSyncMutation, document);
}
