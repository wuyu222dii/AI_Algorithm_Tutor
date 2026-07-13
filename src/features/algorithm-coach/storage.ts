import {
  AssessmentResult,
  CoachState,
  CoachSyncMutation,
  LearningArtifact,
  LearningProfile,
  PracticeSession,
  Problem,
  ProductEvent,
} from './types';

export const COACH_STORAGE_VERSION = 2;
export const COACH_STORAGE_KEY = `algocoach:state:v${COACH_STORAGE_VERSION}`;
export const COACH_ANALYTICS_KEY = 'algocoach:events:v1';
export const COACH_SESSION_KEY = 'algocoach:session-id';
export const COACH_EXPERIMENT_KEY = 'algocoach:hint-copy-variant';
export const COACH_IMPORTED_PROBLEM_KEY = 'algocoach.imported-problem.v1';
export const COACH_REVISION_KEY = 'algocoach:revision:v1';
export const COACH_SYNC_QUEUE_KEY = 'algocoach:sync-queue:v1';
export const COACH_GUEST_CLAIM_KEY = 'algocoach:guest-claimed-by:v1';
export const GUEST_COACH_STORAGE_SCOPE = 'guest';
export type CoachStorageScope = 'guest' | `user:${string}`;

const LEGACY_STORAGE_KEYS = ['algocoach:state:v1', 'algocoach:state'];

export function createCoachStorageScope(
  userId?: string | null
): CoachStorageScope {
  const normalized = String(userId || '').trim();
  return normalized ? `user:${normalized}` : GUEST_COACH_STORAGE_SCOPE;
}

export function getScopedStorageKey(
  baseKey: string,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): string {
  return scope === GUEST_COACH_STORAGE_SCOPE ? baseKey : `${baseKey}:${scope}`;
}

export function createInitialCoachState(): CoachState {
  return {
    version: COACH_STORAGE_VERSION,
    profile: null,
    sessions: {},
    artifacts: [],
    events: [],
    activeAssessment: null,
    assessments: [],
    code: {},
    runs: [],
    completedProblemIds: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function migrateState(value: unknown): CoachState {
  const initial = createInitialCoachState();
  if (!isRecord(value)) return initial;

  const rawSessions = value.sessions ?? value.practiceSessions;
  let sessions: Record<string, PracticeSession> = {};
  if (Array.isArray(rawSessions)) {
    sessions = Object.fromEntries(
      rawSessions
        .filter(isRecord)
        .filter((session) => typeof session.problemSlug === 'string')
        .map((session) => [
          session.problemSlug,
          session as unknown as PracticeSession,
        ])
    );
  } else if (isRecord(rawSessions)) {
    sessions = rawSessions as Record<string, PracticeSession>;
  }

  const derivedCode = Object.fromEntries(
    Object.entries(sessions).map(([problemSlug, session]) => [
      problemSlug,
      session.code,
    ])
  );
  const derivedRuns = Object.values(sessions).flatMap(
    (session) => session.runs
  );
  const derivedCompleted = Object.values(sessions)
    .filter((session) => Boolean(session.completedAt))
    .map((session) => session.problemSlug);

  return {
    version: COACH_STORAGE_VERSION,
    profile: (value.profile ??
      value.learningProfile ??
      null) as LearningProfile | null,
    sessions,
    artifacts: Array.isArray(value.artifacts)
      ? (value.artifacts as LearningArtifact[]).slice(-100)
      : [],
    events: Array.isArray(value.events)
      ? (value.events as ProductEvent[]).slice(-300)
      : [],
    activeAssessment: isRecord(value.activeAssessment)
      ? (value.activeAssessment as unknown as CoachState['activeAssessment'])
      : null,
    assessments: Array.isArray(value.assessments)
      ? (value.assessments as AssessmentResult[]).slice(-20)
      : [],
    code: isRecord(value.code)
      ? (value.code as CoachState['code'])
      : derivedCode,
    runs: Array.isArray(value.runs)
      ? (value.runs as CoachState['runs']).slice(-200)
      : derivedRuns.slice(-200),
    completedProblemIds: Array.isArray(value.completedProblemIds)
      ? value.completedProblemIds.map(String)
      : derivedCompleted,
  };
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeCoachStates(
  current: CoachState,
  inherited: CoachState
): CoachState {
  const code = { ...inherited.code };
  for (const [problemSlug, languageCode] of Object.entries(current.code)) {
    code[problemSlug] = {
      ...inherited.code[problemSlug],
      ...languageCode,
    };
  }

  return {
    version: COACH_STORAGE_VERSION,
    profile: current.profile ?? inherited.profile,
    sessions: { ...inherited.sessions, ...current.sessions },
    artifacts: uniqueBy(
      [...inherited.artifacts, ...current.artifacts],
      (artifact) => artifact.id
    ).slice(-100),
    events: uniqueBy(
      [...inherited.events, ...current.events],
      (event) => event.id
    ).slice(-300),
    activeAssessment:
      current.activeAssessment ?? inherited.activeAssessment ?? null,
    assessments: uniqueBy(
      [...inherited.assessments, ...current.assessments],
      (assessment) => assessment.id
    ).slice(-20),
    code,
    runs: uniqueBy([...inherited.runs, ...current.runs], (run) =>
      [
        run.problemSlug,
        run.language,
        run.executedAt,
        run.status,
        run.passedTests,
        run.totalTests,
      ].join('|')
    ).slice(-200),
    completedProblemIds: Array.from(
      new Set([
        ...inherited.completedProblemIds,
        ...current.completedProblemIds,
      ])
    ),
  };
}

function hasMeaningfulCoachState(state: CoachState): boolean {
  return Boolean(
    state.profile ||
      Object.keys(state.sessions).length ||
      state.artifacts.length ||
      state.events.length ||
      state.activeAssessment ||
      state.assessments.length ||
      Object.keys(state.code).length ||
      state.runs.length ||
      state.completedProblemIds.length
  );
}

function getStorage(storage?: Storage): Storage | undefined {
  return (
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  );
}

export function deserializeCoachState(serialized: string): CoachState {
  try {
    return migrateState(JSON.parse(serialized));
  } catch {
    return createInitialCoachState();
  }
}

export function loadCoachState(
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): CoachState {
  const target = getStorage(storage);
  if (!target) return createInitialCoachState();

  try {
    const current = target.getItem(
      getScopedStorageKey(COACH_STORAGE_KEY, scope)
    );
    if (current) return deserializeCoachState(current);

    if (scope === GUEST_COACH_STORAGE_SCOPE) {
      for (const key of LEGACY_STORAGE_KEYS) {
        const legacy = target.getItem(key);
        if (!legacy) continue;
        const migrated = deserializeCoachState(legacy);
        saveCoachState(migrated, target, scope);
        return migrated;
      }
    }
  } catch {
    return createInitialCoachState();
  }
  return createInitialCoachState();
}

export function saveCoachState(
  state: CoachState,
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.setItem(
      getScopedStorageKey(COACH_STORAGE_KEY, scope),
      JSON.stringify({ ...state, version: COACH_STORAGE_VERSION })
    );
  } catch {
    // Persistence is best-effort when storage is unavailable or full.
  }
}

export function clearCoachState(
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.removeItem(getScopedStorageKey(COACH_STORAGE_KEY, scope));
    if (scope === GUEST_COACH_STORAGE_SCOPE) {
      for (const key of LEGACY_STORAGE_KEYS) target.removeItem(key);
    }
  } catch {
    // Reset still clears in-memory state when browser storage is restricted.
  }
}

export function loadImportedProblem(
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): Problem | null {
  const target = getStorage(storage);
  if (!target) return null;

  try {
    const raw = target.getItem(
      getScopedStorageKey(COACH_IMPORTED_PROBLEM_KEY, scope)
    );
    return raw ? (JSON.parse(raw) as Problem) : null;
  } catch {
    return null;
  }
}

export function saveImportedProblem(
  problem: Problem,
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  const target = getStorage(storage);
  if (!target) return;

  try {
    target.setItem(
      getScopedStorageKey(COACH_IMPORTED_PROBLEM_KEY, scope),
      JSON.stringify(problem)
    );
  } catch {
    // Imported drafts remain best-effort in restricted browser storage.
  }
}

export function clearImportedProblem(
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  const target = getStorage(storage);
  if (!target) return;

  try {
    target.removeItem(getScopedStorageKey(COACH_IMPORTED_PROBLEM_KEY, scope));
  } catch {
    // Reset remains best-effort in restricted browser storage.
  }
}

export function loadCoachRevision(
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): number {
  const target = getStorage(storage);
  if (!target) return 0;
  try {
    const value = Number(
      target.getItem(getScopedStorageKey(COACH_REVISION_KEY, scope)) ?? 0
    );
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveCoachRevision(
  revision: number,
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  const target = getStorage(storage);
  if (!target || !Number.isInteger(revision) || revision < 0) return;
  try {
    target.setItem(
      getScopedStorageKey(COACH_REVISION_KEY, scope),
      String(revision)
    );
  } catch {
    // Revision metadata is best-effort when browser storage is unavailable.
  }
}

function isStoredMutation(value: unknown): value is CoachSyncMutation {
  if (!isRecord(value) || !isRecord(value.changes)) return false;
  return Boolean(
    typeof value.id === 'string' &&
      value.id &&
      Number.isInteger(value.baseRevision) &&
      Number(value.baseRevision) >= 0 &&
      typeof value.createdAt === 'string'
  );
}

export function loadCoachSyncQueue(
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): CoachSyncMutation[] {
  const target = getStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(
      getScopedStorageKey(COACH_SYNC_QUEUE_KEY, scope)
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredMutation) : [];
  } catch {
    return [];
  }
}

export function saveCoachSyncQueue(
  queue: CoachSyncMutation[],
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    const key = getScopedStorageKey(COACH_SYNC_QUEUE_KEY, scope);
    if (!queue.length) target.removeItem(key);
    else target.setItem(key, JSON.stringify(queue));
  } catch {
    // The in-memory queue still retries while this page remains open.
  }
}

export function clearCoachSyncQueue(
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.removeItem(getScopedStorageKey(COACH_SYNC_QUEUE_KEY, scope));
  } catch {
    // Reset remains best-effort when browser storage is restricted.
  }
}

function parseStoredEvents(raw: string | null): ProductEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProductEvent[]) : [];
  } catch {
    return [];
  }
}

/**
 * Transfer the original guest namespace to the first authenticated account.
 * The marker is permanent so a later account can never claim the same guest
 * history. Existing account data wins when both namespaces contain a value.
 */
export function claimGuestCoachData(
  scope: CoachStorageScope,
  storage?: Storage
): boolean {
  if (scope === GUEST_COACH_STORAGE_SCOPE) return false;
  const target = getStorage(storage);
  if (!target) return false;

  try {
    if (target.getItem(COACH_GUEST_CLAIM_KEY)) return false;

    const guestState = loadCoachState(target, GUEST_COACH_STORAGE_SCOPE);
    const guestAnalyticsRaw = target.getItem(COACH_ANALYTICS_KEY);
    const guestAnalytics = parseStoredEvents(guestAnalyticsRaw);
    const guestExperiment = target.getItem(COACH_EXPERIMENT_KEY);
    const guestImportedProblem = target.getItem(COACH_IMPORTED_PROBLEM_KEY);
    const hasGuestData =
      hasMeaningfulCoachState(guestState) ||
      guestAnalytics.length > 0 ||
      guestExperiment === 'A' ||
      guestExperiment === 'B' ||
      Boolean(guestImportedProblem);

    if (!hasGuestData) return false;

    if (hasMeaningfulCoachState(guestState)) {
      const currentState = loadCoachState(target, scope);
      saveCoachState(mergeCoachStates(currentState, guestState), target, scope);
    }

    if (guestAnalytics.length > 0) {
      const scopedAnalyticsKey = getScopedStorageKey(
        COACH_ANALYTICS_KEY,
        scope
      );
      const currentAnalytics = parseStoredEvents(
        target.getItem(scopedAnalyticsKey)
      );
      const mergedAnalytics = uniqueBy(
        [...guestAnalytics, ...currentAnalytics],
        (event) => event.id
      ).slice(-300);
      target.setItem(scopedAnalyticsKey, JSON.stringify(mergedAnalytics));
    }

    if (guestExperiment === 'A' || guestExperiment === 'B') {
      const scopedExperimentKey = getScopedStorageKey(
        COACH_EXPERIMENT_KEY,
        scope
      );
      if (!target.getItem(scopedExperimentKey)) {
        target.setItem(scopedExperimentKey, guestExperiment);
      }
    }

    if (guestImportedProblem) {
      const scopedImportedKey = getScopedStorageKey(
        COACH_IMPORTED_PROBLEM_KEY,
        scope
      );
      if (!target.getItem(scopedImportedKey)) {
        target.setItem(scopedImportedKey, guestImportedProblem);
      }
    }

    clearCoachState(target, GUEST_COACH_STORAGE_SCOPE);
    target.removeItem(COACH_ANALYTICS_KEY);
    target.removeItem(COACH_EXPERIMENT_KEY);
    target.removeItem(COACH_IMPORTED_PROBLEM_KEY);
    target.setItem(COACH_GUEST_CLAIM_KEY, scope);
    return true;
  } catch {
    return false;
  }
}
