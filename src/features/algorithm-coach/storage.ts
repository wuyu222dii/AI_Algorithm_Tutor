import {
  claimGuestImportedDrafts,
  clearImportedDrafts,
  hasImportedDrafts,
} from './imported-drafts';
import { isLanguage, LANGUAGE_REGISTRY } from './languages';
import {
  claimGuestReviewProgress,
  hasReviewProgress,
} from './learning-progress';
import {
  compactCoachSyncQueue,
  getPracticeSessionKey,
  normalizeProblemContentVersion,
} from './sync';
import {
  AssessmentResult,
  CoachState,
  CoachSyncMutation,
  CodeRunResult,
  LearningArtifact,
  LearningProfile,
  PracticeSession,
  Problem,
  ProductEvent,
} from './types';

export const COACH_STORAGE_VERSION = 3;
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

const LEGACY_STORAGE_KEYS = [
  'algocoach:state:v2',
  'algocoach:state:v1',
  'algocoach:state',
];

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

function migrateRun(
  run: CodeRunResult,
  fallbackContentVersion = 1,
  fallbackProblemSlug?: string
): CodeRunResult {
  const language = isLanguage(run.language) ? run.language : 'javascript';
  const definition = LANGUAGE_REGISTRY[language];
  return {
    ...run,
    problemSlug: run.problemSlug || fallbackProblemSlug || 'unknown',
    language,
    problemContentVersion: normalizeProblemContentVersion(
      run.problemContentVersion ?? fallbackContentVersion
    ),
    runtimeVersion: run.runtimeVersion ?? definition.runtimeVersion,
    runnerMode:
      run.runnerMode ??
      (definition.runner === 'remote' ? 'remote-judge' : 'browser-worker'),
  };
}

function migrateSession(session: PracticeSession): PracticeSession {
  const problemContentVersion = normalizeProblemContentVersion(
    session.problemContentVersion
  );
  return {
    ...session,
    problemContentVersion,
    runs: Array.isArray(session.runs)
      ? session.runs
          .map((run) =>
            migrateRun(run, problemContentVersion, session.problemSlug)
          )
          .filter((run) => run.problemContentVersion === problemContentVersion)
      : [],
  };
}

export function normalizeCoachState(value: unknown): CoachState {
  const initial = createInitialCoachState();
  if (!isRecord(value)) return initial;

  const rawSessions = value.sessions ?? value.practiceSessions;
  const sessions: Record<string, PracticeSession> = {};
  const canonicalKeyByRawKey = new Map<string, string>();
  if (Array.isArray(rawSessions)) {
    for (const rawSession of rawSessions.filter(isRecord)) {
      if (typeof rawSession.problemSlug !== 'string') continue;
      const session = migrateSession(rawSession as unknown as PracticeSession);
      const key = getPracticeSessionKey(
        session.problemSlug,
        session.problemContentVersion
      );
      sessions[key] = session;
      canonicalKeyByRawKey.set(session.problemSlug, key);
    }
  } else if (isRecord(rawSessions)) {
    for (const [rawKey, rawSession] of Object.entries(rawSessions)) {
      if (!isRecord(rawSession)) continue;
      const problemSlug =
        typeof rawSession.problemSlug === 'string'
          ? rawSession.problemSlug
          : rawKey;
      const session = migrateSession({
        ...(rawSession as unknown as PracticeSession),
        problemSlug,
      });
      const key = getPracticeSessionKey(
        session.problemSlug,
        session.problemContentVersion
      );
      sessions[key] = session;
      canonicalKeyByRawKey.set(rawKey, key);
    }
  }

  const code: CoachState['code'] = Object.fromEntries(
    Object.entries(sessions).map(([problemSlug, session]) => [
      problemSlug,
      session.code,
    ])
  );
  if (isRecord(value.code)) {
    for (const [rawKey, rawCode] of Object.entries(value.code)) {
      if (!isRecord(rawCode)) continue;
      const key = canonicalKeyByRawKey.get(rawKey) ?? rawKey;
      code[key] = {
        ...code[key],
        ...(rawCode as CoachState['code'][string]),
      };
      if (sessions[key]) sessions[key] = { ...sessions[key], code: code[key] };
    }
  }
  const derivedRuns = Object.values(sessions).flatMap(
    (session) => session.runs
  );
  const derivedCompleted = Object.values(sessions)
    .filter((session) => Boolean(session.completedAt))
    .map((session) => session.problemSlug);

  const rawProfile = value.profile ?? value.learningProfile;
  const profile = isRecord(rawProfile)
    ? ({
        ...rawProfile,
        preferredLanguage: isLanguage(rawProfile.preferredLanguage)
          ? rawProfile.preferredLanguage
          : 'javascript',
      } as unknown as LearningProfile)
    : null;

  return {
    version: COACH_STORAGE_VERSION,
    profile,
    sessions,
    artifacts: Array.isArray(value.artifacts)
      ? (value.artifacts as LearningArtifact[])
          .map((artifact) => ({
            ...artifact,
            problemContentVersion: artifact.problemContentVersion ?? 1,
          }))
          .slice(-100)
      : [],
    events: Array.isArray(value.events)
      ? (value.events as ProductEvent[]).slice(-300)
      : [],
    activeAssessment: isRecord(value.activeAssessment)
      ? ({
          ...value.activeAssessment,
          problemVersions: Array.isArray(value.activeAssessment.problemVersions)
            ? value.activeAssessment.problemVersions
            : Array.isArray(value.activeAssessment.problemSlugs)
              ? value.activeAssessment.problemSlugs.map((slug) => ({
                  slug: String(slug),
                  contentVersion: 1,
                }))
              : [],
        } as unknown as CoachState['activeAssessment'])
      : null,
    assessments: Array.isArray(value.assessments)
      ? (value.assessments as AssessmentResult[])
          .map((assessment) => ({
            ...assessment,
            problemVersions:
              assessment.problemVersions ??
              assessment.problemSlugs.map((slug) => ({
                slug,
                contentVersion: 1,
              })),
          }))
          .slice(-20)
      : [],
    code,
    runs: Array.isArray(value.runs)
      ? (value.runs as CoachState['runs'])
          .map((run) => migrateRun(run))
          .slice(-200)
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
  const normalizedCurrent = normalizeCoachState(current);
  const normalizedInherited = normalizeCoachState(inherited);
  const code = { ...normalizedInherited.code };
  for (const [problemSlug, languageCode] of Object.entries(
    normalizedCurrent.code
  )) {
    code[problemSlug] = {
      ...normalizedInherited.code[problemSlug],
      ...languageCode,
    };
  }

  return {
    version: COACH_STORAGE_VERSION,
    profile: normalizedCurrent.profile ?? normalizedInherited.profile,
    sessions: {
      ...normalizedInherited.sessions,
      ...normalizedCurrent.sessions,
    },
    artifacts: uniqueBy(
      [...normalizedInherited.artifacts, ...normalizedCurrent.artifacts],
      (artifact) => artifact.id
    ).slice(-100),
    events: uniqueBy(
      [...normalizedInherited.events, ...normalizedCurrent.events],
      (event) => event.id
    ).slice(-300),
    activeAssessment:
      normalizedCurrent.activeAssessment ??
      normalizedInherited.activeAssessment ??
      null,
    assessments: uniqueBy(
      [...normalizedInherited.assessments, ...normalizedCurrent.assessments],
      (assessment) => assessment.id
    ).slice(-20),
    code,
    runs: uniqueBy(
      [...normalizedInherited.runs, ...normalizedCurrent.runs],
      (run) =>
        [
          run.problemSlug,
          normalizeProblemContentVersion(run.problemContentVersion),
          run.language,
          run.executedAt,
          run.status,
          run.passedTests,
          run.totalTests,
        ].join('|')
    ).slice(-200),
    completedProblemIds: Array.from(
      new Set([
        ...normalizedInherited.completedProblemIds,
        ...normalizedCurrent.completedProblemIds,
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
    return normalizeCoachState(JSON.parse(serialized));
  } catch {
    return createInitialCoachState();
  }
}

function getLegacyStorageKeys(scope: CoachStorageScope): string[] {
  return LEGACY_STORAGE_KEYS.map((key) => getScopedStorageKey(key, scope));
}

function clearLegacyStorageKeys(
  storage: Storage,
  scope: CoachStorageScope
): void {
  for (const key of getLegacyStorageKeys(scope)) storage.removeItem(key);
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
    if (current) {
      const migrated = deserializeCoachState(current);
      clearLegacyStorageKeys(target, scope);
      return migrated;
    }

    for (const key of getLegacyStorageKeys(scope)) {
      const legacy = target.getItem(key);
      if (!legacy) continue;
      const migrated = deserializeCoachState(legacy);
      target.setItem(
        getScopedStorageKey(COACH_STORAGE_KEY, scope),
        JSON.stringify(migrated)
      );
      clearLegacyStorageKeys(target, scope);
      return migrated;
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
    clearImportedDrafts(target, scope);
    clearLegacyStorageKeys(target, scope);
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
    return Array.isArray(parsed)
      ? compactCoachSyncQueue(parsed.filter(isStoredMutation))
      : [];
  } catch {
    return [];
  }
}

export function saveCoachSyncQueue(
  queue: CoachSyncMutation[],
  storage?: Storage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): CoachSyncMutation[] {
  const compacted = compactCoachSyncQueue(queue);
  const target = getStorage(storage);
  if (!target) return compacted;
  try {
    const key = getScopedStorageKey(COACH_SYNC_QUEUE_KEY, scope);
    if (!compacted.length) target.removeItem(key);
    else target.setItem(key, JSON.stringify(compacted));
  } catch {
    // The in-memory queue still retries while this page remains open.
  }
  return compacted;
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
      Boolean(guestImportedProblem) ||
      hasImportedDrafts(target, GUEST_COACH_STORAGE_SCOPE) ||
      hasReviewProgress(target, GUEST_COACH_STORAGE_SCOPE);

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

    claimGuestImportedDrafts(scope, target);
    claimGuestReviewProgress(scope, target);

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
