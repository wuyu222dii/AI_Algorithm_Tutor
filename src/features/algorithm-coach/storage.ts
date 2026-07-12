import {
  AssessmentResult,
  CoachState,
  LearningArtifact,
  LearningProfile,
  PracticeSession,
  ProductEvent,
} from './types';

export const COACH_STORAGE_VERSION = 2;
export const COACH_STORAGE_KEY = `algocoach:state:v${COACH_STORAGE_VERSION}`;
const LEGACY_STORAGE_KEYS = ['algocoach:state:v1', 'algocoach:state'];

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

export function deserializeCoachState(serialized: string): CoachState {
  try {
    return migrateState(JSON.parse(serialized));
  } catch {
    return createInitialCoachState();
  }
}

export function loadCoachState(storage?: Storage): CoachState {
  const target =
    storage ??
    (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) return createInitialCoachState();

  try {
    const current = target.getItem(COACH_STORAGE_KEY);
    if (current) return deserializeCoachState(current);

    for (const key of LEGACY_STORAGE_KEYS) {
      const legacy = target.getItem(key);
      if (!legacy) continue;
      const migrated = deserializeCoachState(legacy);
      saveCoachState(migrated, target);
      return migrated;
    }
  } catch {
    return createInitialCoachState();
  }
  return createInitialCoachState();
}

export function saveCoachState(state: CoachState, storage?: Storage): void {
  const target =
    storage ??
    (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) return;
  try {
    target.setItem(
      COACH_STORAGE_KEY,
      JSON.stringify({ ...state, version: COACH_STORAGE_VERSION })
    );
  } catch {
    // Persistence is best-effort when storage is unavailable or full.
  }
}

export function clearCoachState(storage?: Storage): void {
  const target =
    storage ??
    (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) return;
  try {
    target.removeItem(COACH_STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) target.removeItem(key);
  } catch {
    // Reset still clears in-memory state when browser storage is restricted.
  }
}
