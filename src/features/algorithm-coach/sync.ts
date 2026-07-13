import {
  AssessmentResult,
  CoachState,
  CoachSyncMutation,
  CodeRunResult,
  LearningArtifact,
  Problem,
  ProductEvent,
} from './types';

export interface CoachSyncDocument {
  state: CoachState;
  importedProblem: Problem | null;
}

export function coachSyncRetryDelay(attempt: number): number {
  const safeAttempt = Number.isInteger(attempt) ? Math.max(0, attempt) : 0;
  return Math.min(30_000, 1000 * 2 ** safeAttempt);
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
  return (
    run.id ??
    [
      run.problemSlug,
      run.language,
      run.executedAt,
      run.status,
      run.passedTests,
      run.totalTests,
    ].join('|')
  );
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

  for (const key of Object.keys(changes) as Array<keyof typeof changes>) {
    if (changes[key] === undefined) delete changes[key];
  }

  const importedProblemChanged = !sameValue(
    previous.importedProblem,
    next.importedProblem
  );
  if (!Object.keys(changes).length && !importedProblemChanged) return null;

  return {
    id: metadata.id ?? createMutationId(),
    baseRevision,
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    changes,
    ...(importedProblemChanged
      ? { importedProblem: next.importedProblem }
      : {}),
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

export function applyCoachSyncMutation(
  document: CoachSyncDocument,
  mutation: CoachSyncMutation
): CoachSyncDocument {
  const { changes } = mutation;
  const state: CoachState = {
    ...document.state,
    profile: Object.hasOwn(changes, 'profile')
      ? (changes.profile ?? null)
      : document.state.profile,
    sessions: changes.sessions
      ? { ...document.state.sessions, ...changes.sessions }
      : document.state.sessions,
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
    code: changes.code
      ? Object.fromEntries(
          Object.entries({ ...document.state.code, ...changes.code }).map(
            ([problemSlug, code]) => [
              problemSlug,
              {
                ...document.state.code[problemSlug],
                ...code,
              },
            ]
          )
        )
      : document.state.code,
    runs: upsertArray<CodeRunResult>(
      document.state.runs,
      changes.runs,
      runKey,
      200
    ),
    completedProblemIds: upsertArray<string>(
      document.state.completedProblemIds,
      changes.completedProblemIds,
      (problemSlug) => problemSlug,
      500
    ),
  };

  return {
    state,
    importedProblem: Object.hasOwn(mutation, 'importedProblem')
      ? (mutation.importedProblem ?? null)
      : document.importedProblem,
  };
}

export function applyCoachSyncMutations(
  document: CoachSyncDocument,
  mutations: CoachSyncMutation[]
): CoachSyncDocument {
  return mutations.reduce(applyCoachSyncMutation, document);
}
