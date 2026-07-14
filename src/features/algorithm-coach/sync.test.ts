import { describe, expect, it } from 'vitest';

import { createInitialReviewProgress } from './learning-progress';
import {
  coachSyncMutationSchema,
  coachSyncRequestSchema,
} from './persistence-schema';
import {
  COACH_SYNC_QUEUE_KEY,
  createCoachStorageScope,
  createInitialCoachState,
  getScopedStorageKey,
  loadCoachSyncQueue,
  saveCoachSyncQueue,
} from './storage';
import {
  applyCoachSyncMutation,
  applyCoachSyncMutations,
  coachSyncRetryDelay,
  compactCoachSyncQueue,
  createCoachSyncMutation,
  filterUnappliedCoachMutations,
} from './sync';
import {
  CoachSyncMutation,
  CodeRunResult,
  ImportedDraftRecord,
  LearningArtifact,
  PracticeSession,
} from './types';

function memoryStorage(maxValueLength = Number.POSITIVE_INFINITY): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      const serialized = String(value);
      if (serialized.length > maxValueLength) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      values.set(key, serialized);
    },
  };
}

const artifact = (id: string, summary = id): LearningArtifact => ({
  id,
  type: 'hint',
  locale: 'en',
  problemSlug: 'dependency-cycle',
  title: 'Hint',
  summary,
  details: [],
  evidence: [],
  createdAt: '2026-07-13T00:00:00.000Z',
});

const importedDraft = (
  id: string,
  slug: string,
  updatedAt = '2026-07-13T00:00:00.000Z'
): ImportedDraftRecord => ({
  problem: {
    id,
    slug,
    title: { zh: `草稿 ${id}`, en: `Draft ${id}` },
    description: { zh: '题目描述', en: 'Problem statement' },
    difficulty: 'medium',
    topics: ['custom'],
    entryPoint: 'solve',
    templates: {
      javascript: 'function solve(input) { return input; }',
      python: 'def solve(input):\n    return input',
    },
    tests: [],
    examples: [],
    constraints: [],
    hints: { zh: ['', '', ''], en: ['', '', ''] },
    reviewPoints: [],
    estimatedMinutes: 20,
  },
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt,
});

const syncRun = (
  id: string,
  status: CodeRunResult['status'],
  executedAt: string
): CodeRunResult => ({
  id,
  problemSlug: 'dependency-cycle',
  language: 'javascript',
  status,
  passedTests: status === 'passed' ? 4 : 2,
  totalTests: 4,
  testResults: [],
  console: [],
  durationMs: 4,
  executedAt,
  testScope: 'full',
  submitted: true,
});

const syncSession = (
  updatedAt: string,
  overrides: Partial<PracticeSession> = {}
): PracticeSession => ({
  problemSlug: 'dependency-cycle',
  code: { javascript: 'remote-newer-code' },
  runs: [],
  hintLevel: 0,
  diagnosisCount: 0,
  correctedAfterDiagnosis: false,
  startedAt: updatedAt,
  updatedAt,
  ...overrides,
});

describe('coach incremental sync', () => {
  it('accepts legacy full-state requests without review progress', () => {
    const parsed = coachSyncRequestSchema.parse({
      revision: 0,
      state: createInitialCoachState(),
      importedProblem: null,
    });

    expect(parsed.reviewProgress).toEqual(createInitialReviewProgress());
  });

  it('accepts the expanded public-beta funnel events and rejects unknown names', () => {
    const names = [
      'visitor_started',
      'onboarding_started',
      'first_code_run',
      'first_problem_passed',
      'review_completed',
      'guest_data_claimed',
      'sync_succeeded',
      'sync_failed',
      'experiment_exposed',
      'imported_problem_saved',
    ];
    const mutation = {
      id: 'funnel-events',
      baseRevision: 0,
      createdAt: '2026-07-13T00:00:00.000Z',
      changes: {
        events: names.map((name, index) => ({
          id: `event-${index}`,
          name,
          timestamp: '2026-07-13T00:00:00.000Z',
          sessionId: 'session-1',
        })),
      },
    };

    expect(coachSyncMutationSchema.safeParse(mutation).success).toBe(true);
    expect(
      coachSyncMutationSchema.safeParse({
        ...mutation,
        changes: {
          events: [{ ...mutation.changes.events[0], name: 'unknown_event' }],
        },
      }).success
    ).toBe(false);
  });

  it('creates a field-level mutation and applies retries idempotently', () => {
    const previous = {
      state: createInitialCoachState(),
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: createInitialReviewProgress(),
    };
    const next = {
      state: {
        ...previous.state,
        profile: {
          goal: 'interview' as const,
          preferredLanguage: 'javascript' as const,
          weeklyTarget: 4,
          onboardedAt: '2026-07-13T00:00:00.000Z',
        },
        artifacts: [artifact('artifact-1')],
      },
      importedProblem: null,
      importedDrafts: previous.importedDrafts,
      reviewProgress: previous.reviewProgress,
    };

    const mutation = createCoachSyncMutation(previous, next, 7, {
      id: 'mutation-1',
      createdAt: '2026-07-13T00:00:00.000Z',
    });

    expect(mutation).not.toBeNull();
    expect(mutation?.changes).toEqual({
      profile: next.state.profile,
      artifacts: [artifact('artifact-1')],
    });
    expect(coachSyncMutationSchema.safeParse(mutation).success).toBe(true);

    const applied = applyCoachSyncMutation(previous, mutation!);
    const replayed = applyCoachSyncMutation(applied, mutation!);
    expect(applied).toEqual(next);
    expect(replayed).toEqual(applied);
  });

  it('replays only queued local intent over remote conflict data', () => {
    const remote = createInitialCoachState();
    remote.activeAssessment = {
      id: 'remote-active',
      problemSlugs: ['dependency-cycle'],
      startedAt: '2026-07-13T00:00:00.000Z',
      durationMinutes: 20,
    };
    remote.artifacts = [artifact('remote')];

    const previous = {
      state: createInitialCoachState(),
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: createInitialReviewProgress(),
    };
    const local = {
      state: { ...previous.state, artifacts: [artifact('local')] },
      importedProblem: null,
      importedDrafts: previous.importedDrafts,
      reviewProgress: previous.reviewProgress,
    };
    const mutation = createCoachSyncMutation(previous, local, 1)!;
    const merged = applyCoachSyncMutation(
      {
        state: remote,
        importedProblem: null,
        importedDrafts: [],
        reviewProgress: createInitialReviewProgress(),
      },
      mutation
    );

    expect(merged.state.activeAssessment?.id).toBe('remote-active');
    expect(merged.state.artifacts.map((item) => item.id)).toEqual([
      'remote',
      'local',
    ]);
  });

  it('merges concurrent same-problem sessions without rolling back remote progress', () => {
    const baselineState = createInitialCoachState();
    baselineState.sessions['dependency-cycle'] = syncSession(
      '2026-07-13T00:00:00.000Z',
      {
        code: { javascript: 'offline-baseline' },
      }
    );
    baselineState.code['dependency-cycle'] = {
      javascript: 'offline-baseline',
    };

    const localState = structuredClone(baselineState);
    const localRun = syncRun(
      'local-failure',
      'failed',
      '2026-07-14T01:00:00.000Z'
    );
    localState.sessions['dependency-cycle'] = syncSession(
      '2026-07-14T02:00:00.000Z',
      {
        code: {
          javascript: 'offline-older-code',
          python: 'def local_only():\n    pass',
        },
        runs: [localRun],
        hintLevel: 3,
        diagnosisCount: 2,
        startedAt: '2026-07-12T00:00:00.000Z',
      }
    );
    localState.code['dependency-cycle'] = {
      ...localState.sessions['dependency-cycle'].code,
    };
    localState.runs = [localRun];

    const previous = {
      state: baselineState,
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: createInitialReviewProgress(),
    };
    const mutation = createCoachSyncMutation(
      previous,
      { ...previous, state: localState },
      4,
      {
        id: 'offline-same-problem',
        createdAt: '2026-07-14T02:00:00.000Z',
      }
    )!;

    const remoteState = createInitialCoachState();
    const remoteRun = syncRun(
      'remote-pass',
      'passed',
      '2026-07-15T01:00:00.000Z'
    );
    remoteState.sessions['dependency-cycle'] = syncSession(
      '2026-07-15T02:00:00.000Z',
      {
        code: { javascript: 'remote-newer-code' },
        runs: [remoteRun],
        hintLevel: 1,
        diagnosisCount: 1,
        correctedAfterDiagnosis: true,
        startedAt: '2026-07-13T00:00:00.000Z',
        completedAt: '2026-07-15T01:00:00.000Z',
      }
    );
    remoteState.code['dependency-cycle'] = {
      javascript: 'remote-newer-code',
    };
    remoteState.runs = [remoteRun];
    remoteState.completedProblemIds = ['dependency-cycle'];
    const remote = {
      ...previous,
      state: remoteState,
    };

    const merged = applyCoachSyncMutation(remote, mutation);
    const session = merged.state.sessions['dependency-cycle'];
    expect(session.runs.map((run) => run.id)).toEqual([
      'local-failure',
      'remote-pass',
    ]);
    expect(merged.state.runs.map((run) => run.id)).toEqual([
      'local-failure',
      'remote-pass',
    ]);
    expect(session).toMatchObject({
      code: {
        javascript: 'remote-newer-code',
        python: 'def local_only():\n    pass',
      },
      hintLevel: 3,
      diagnosisCount: 2,
      correctedAfterDiagnosis: true,
      startedAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-15T02:00:00.000Z',
      completedAt: '2026-07-15T01:00:00.000Z',
    });
    expect(merged.state.code['dependency-cycle']).toEqual(session.code);
    expect(merged.state.completedProblemIds).toEqual(['dependency-cycle']);
    expect(applyCoachSyncMutation(merged, mutation)).toEqual(merged);
  });

  it('persists queues per account and caps exponential retry delay', () => {
    const storage = memoryStorage();
    const scope = createCoachStorageScope('account-a');
    const base = {
      state: createInitialCoachState(),
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: createInitialReviewProgress(),
    };
    const changed = {
      ...base,
      state: { ...base.state, artifacts: [artifact('queued')] },
    };
    const mutation = createCoachSyncMutation(base, changed, 2, {
      id: 'queued-mutation',
      createdAt: '2026-07-13T00:00:00.000Z',
    })!;

    saveCoachSyncQueue([mutation], storage, scope);

    expect(loadCoachSyncQueue(storage, scope)).toEqual([mutation]);
    expect(
      loadCoachSyncQueue(storage, createCoachStorageScope('account-b'))
    ).toEqual([]);
    expect(
      storage.getItem(getScopedStorageKey(COACH_SYNC_QUEUE_KEY, scope))
    ).toBeTruthy();
    expect([0, 1, 2, 10].map(coachSyncRetryDelay)).toEqual([
      1000, 2000, 4000, 30_000,
    ]);
  });

  it('coalesces a long offline queue without changing its final learning state', () => {
    const base = {
      state: createInitialCoachState(),
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: createInitialReviewProgress(),
    };
    const mutations: CoachSyncMutation[] = Array.from(
      { length: 520 },
      (_, index) => {
        const executedAt = new Date(
          Date.UTC(2026, 6, 1, 0, index)
        ).toISOString();
        const run = syncRun(`offline-run-${index}`, 'failed', executedAt);
        return {
          id: `offline-mutation-${index}`,
          baseRevision: 7,
          createdAt: executedAt,
          changes: {
            sessions: {
              'dependency-cycle': syncSession(executedAt, {
                code: { javascript: `return ${index};` },
                runs: [run],
                hintLevel: Math.min(3, index) as 0 | 1 | 2 | 3,
                diagnosisCount: index,
              }),
            },
            code: {
              'dependency-cycle': { javascript: `return ${index};` },
            },
            runs: [run],
            artifacts: [artifact(`offline-artifact-${index}`)],
            events: [
              {
                id: `offline-event-${index}`,
                name: 'code_run',
                timestamp: executedAt,
                sessionId: 'offline-session',
                problemSlug: 'dependency-cycle',
              },
            ],
            completedProblemIds: [`offline-problem-${index}`],
            reviewItems: {
              'dependency-cycle': {
                problemSlug: 'dependency-cycle',
                status: index === 519 ? 'mastered' : 'due',
                source: 'mistake',
                dueAt: executedAt,
                intervalDays: 1,
                repetitions: index,
                easeFactor: 2.5,
                updatedAt: executedAt,
              },
            },
          },
        };
      }
    );

    const compacted = compactCoachSyncQueue(mutations);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      id: 'offline-mutation-519',
      baseRevision: 7,
    });
    expect(
      compacted[0].changes.sessions?.['dependency-cycle'].runs
    ).toHaveLength(30);
    expect(compacted[0].changes.runs).toHaveLength(200);
    expect(compacted[0].changes.artifacts).toHaveLength(100);
    expect(compacted[0].changes.events).toHaveLength(300);
    expect(compacted[0].changes.completedProblemIds).toHaveLength(500);
    expect(coachSyncMutationSchema.safeParse(compacted[0]).success).toBe(true);
    expect(applyCoachSyncMutations(base, compacted)).toEqual(
      applyCoachSyncMutations(base, mutations)
    );
  });

  it('coalesces draft upserts, tombstones, and scalar fields to final intent', () => {
    const first = importedDraft('first', 'imported-draft');
    const second = importedDraft('second', 'imported-draft-second');
    const third = importedDraft(
      'third',
      'imported-draft-third',
      '2026-07-15T00:00:00.000Z'
    );
    const updatedFirst = {
      ...first,
      updatedAt: '2026-07-14T00:00:00.000Z',
    };
    const mutations: CoachSyncMutation[] = [
      {
        id: 'draft-1',
        baseRevision: 2,
        createdAt: '2026-07-13T00:00:00.000Z',
        changes: {
          profile: {
            goal: 'interview',
            preferredLanguage: 'javascript',
            weeklyTarget: 3,
            onboardedAt: '2026-07-13T00:00:00.000Z',
          },
        },
        importedProblem: first.problem,
        importedDraftUpserts: [first, second],
      },
      {
        id: 'draft-2',
        baseRevision: 2,
        createdAt: '2026-07-14T00:00:00.000Z',
        changes: { profile: null },
        importedDraftUpserts: [updatedFirst],
        deletedImportedDraftSlugs: [second.problem.slug],
      },
      {
        id: 'draft-3',
        baseRevision: 2,
        createdAt: '2026-07-15T00:00:00.000Z',
        changes: {},
        importedProblem: third.problem,
        importedDraftUpserts: [third],
        deletedImportedDraftSlugs: [first.problem.slug],
      },
    ];
    const base = {
      state: createInitialCoachState(),
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: createInitialReviewProgress(),
    };

    const compacted = compactCoachSyncQueue(mutations);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      id: 'draft-3',
      changes: { profile: null },
      importedProblem: third.problem,
      importedDraftUpserts: [third],
      deletedImportedDraftSlugs: [second.problem.slug, first.problem.slug],
    });
    expect(coachSyncMutationSchema.safeParse(compacted[0]).success).toBe(true);
    expect(applyCoachSyncMutations(base, compacted)).toEqual(
      applyCoachSyncMutations(base, mutations)
    );
  });

  it('persists the compacted queue when the raw offline history exceeds quota', () => {
    const storage = memoryStorage(5_000);
    const scope = createCoachStorageScope('quota-account');
    const mutations: CoachSyncMutation[] = Array.from(
      { length: 120 },
      (_, index) => ({
        id: `quota-${index}`,
        baseRevision: 3,
        createdAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
        changes: {
          code: {
            'dependency-cycle': {
              javascript: `${index}:${'x'.repeat(1_000)}`,
            },
          },
        },
      })
    );
    expect(JSON.stringify(mutations).length).toBeGreaterThan(5_000);

    const inMemoryQueue = saveCoachSyncQueue(mutations, storage, scope);
    expect(inMemoryQueue).toHaveLength(1);
    expect(loadCoachSyncQueue(storage, scope)).toEqual(inMemoryQueue);
    expect(inMemoryQueue[0].changes.code?.['dependency-cycle'].javascript).toBe(
      `119:${'x'.repeat(1_000)}`
    );
  });

  it('filters acknowledged mutations before replaying a mixed retry batch', () => {
    const base = {
      state: createInitialCoachState(),
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: createInitialReviewProgress(),
    };
    const first = createCoachSyncMutation(
      base,
      { ...base, state: { ...base.state, artifacts: [artifact('first')] } },
      1,
      { id: 'already-applied', createdAt: '2026-07-13T00:00:00.000Z' }
    )!;
    const second = createCoachSyncMutation(
      base,
      { ...base, state: { ...base.state, artifacts: [artifact('second')] } },
      1,
      { id: 'new-intent', createdAt: '2026-07-13T00:01:00.000Z' }
    )!;

    expect(
      filterUnappliedCoachMutations(
        [first, second],
        new Set(['already-applied'])
      )
    ).toEqual([second]);
  });

  it('syncs review schedule changes and preserves unrelated remote items', () => {
    const timestamp = '2026-07-13T00:00:00.000Z';
    const remote = {
      state: createInitialCoachState(),
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: {
        version: 1,
        items: {
          'remote-problem': {
            problemSlug: 'remote-problem',
            status: 'due' as const,
            source: 'mistake' as const,
            dueAt: timestamp,
            intervalDays: 1,
            repetitions: 0,
            easeFactor: 2.5,
            updatedAt: timestamp,
          },
        },
      },
    };
    const localItem = {
      problemSlug: 'dependency-cycle',
      status: 'resolved' as const,
      source: 'mistake' as const,
      dueAt: '2026-07-16T00:00:00.000Z',
      intervalDays: 3,
      repetitions: 1,
      easeFactor: 2.5,
      updatedAt: '2026-07-14T00:00:00.000Z',
      lastReviewedAt: '2026-07-14T00:00:00.000Z',
      lastRating: 'good' as const,
    };
    const local = {
      ...remote,
      reviewProgress: {
        version: 1,
        items: {
          ...remote.reviewProgress.items,
          [localItem.problemSlug]: localItem,
        },
      },
    };

    const mutation = createCoachSyncMutation(remote, local, 4, {
      id: 'review-mutation',
      createdAt: timestamp,
    });

    expect(mutation?.changes).toEqual({
      reviewItems: { [localItem.problemSlug]: localItem },
    });
    expect(coachSyncMutationSchema.safeParse(mutation).success).toBe(true);
    expect(
      applyCoachSyncMutation(remote, mutation!).reviewProgress.items
    ).toEqual(local.reviewProgress.items);
  });

  it('does not let an older offline review overwrite a newer remote rating', () => {
    const remoteItem = {
      problemSlug: 'dependency-cycle',
      status: 'mastered' as const,
      source: 'mistake' as const,
      dueAt: '2026-07-30T00:00:00.000Z',
      intervalDays: 14,
      repetitions: 3,
      easeFactor: 2.65,
      updatedAt: '2026-07-15T00:00:00.000Z',
      lastRating: 'easy' as const,
    };
    const remote = {
      state: createInitialCoachState(),
      importedProblem: null,
      importedDrafts: [],
      reviewProgress: {
        version: 1,
        items: { [remoteItem.problemSlug]: remoteItem },
      },
    };
    const mutation = {
      id: 'stale-review',
      baseRevision: 2,
      createdAt: '2026-07-14T00:00:00.000Z',
      changes: {
        reviewItems: {
          [remoteItem.problemSlug]: {
            ...remoteItem,
            status: 'resolved' as const,
            updatedAt: '2026-07-14T00:00:00.000Z',
            lastRating: 'good' as const,
          },
        },
      },
    };

    expect(
      applyCoachSyncMutation(remote, mutation).reviewProgress.items[
        remoteItem.problemSlug
      ]
    ).toEqual(remoteItem);
  });

  it('syncs draft upserts and deletions without replacing unrelated drafts', () => {
    const first = importedDraft('first', 'imported-draft');
    const second = importedDraft('second', 'imported-draft-second');
    const updatedFirst = {
      ...first,
      problem: { ...first.problem, difficulty: 'hard' as const },
      updatedAt: '2026-07-14T00:00:00.000Z',
    };
    const previous = {
      state: createInitialCoachState(),
      importedProblem: first.problem,
      importedDrafts: [first, second],
      reviewProgress: createInitialReviewProgress(),
    };
    const next = {
      ...previous,
      importedProblem: updatedFirst.problem,
      importedDrafts: [updatedFirst],
    };

    const mutation = createCoachSyncMutation(previous, next, 3, {
      id: 'draft-delta',
      createdAt: '2026-07-14T00:00:00.000Z',
    });

    expect(mutation).toMatchObject({
      importedProblem: updatedFirst.problem,
      importedDraftUpserts: [updatedFirst],
      deletedImportedDraftSlugs: ['imported-draft-second'],
    });
    expect(coachSyncMutationSchema.safeParse(mutation).success).toBe(true);
    const applied = applyCoachSyncMutation(previous, mutation!);
    expect(applied).toEqual(next);
    expect(applyCoachSyncMutation(applied, mutation!)).toEqual(applied);
  });

  it('deleting the last draft clears the active cloud-compatible draft', () => {
    const only = importedDraft('only', 'imported-draft');
    const previous = {
      state: createInitialCoachState(),
      importedProblem: only.problem,
      importedDrafts: [only],
      reviewProgress: createInitialReviewProgress(),
    };
    const next = {
      ...previous,
      importedProblem: null,
      importedDrafts: [],
    };

    const mutation = createCoachSyncMutation(previous, next, 4, {
      id: 'delete-final-draft',
      createdAt: '2026-07-14T00:00:00.000Z',
    });

    expect(mutation).toMatchObject({
      importedProblem: null,
      deletedImportedDraftSlugs: ['imported-draft'],
    });
    expect(applyCoachSyncMutation(previous, mutation!)).toEqual(next);
  });

  it('selects a replacement when a deletion-only mutation removes the active draft', () => {
    const active = importedDraft('active', 'imported-draft');
    const replacement = importedDraft(
      'replacement',
      'imported-draft-replacement'
    );
    const document = {
      state: createInitialCoachState(),
      importedProblem: active.problem,
      importedDrafts: [active, replacement],
      reviewProgress: createInitialReviewProgress(),
    };
    const mutation = {
      id: 'delete-active-only',
      baseRevision: 1,
      createdAt: '2026-07-14T00:00:00.000Z',
      changes: {},
      deletedImportedDraftSlugs: [active.problem.slug],
    };

    expect(coachSyncMutationSchema.safeParse(mutation).success).toBe(true);
    expect(applyCoachSyncMutation(document, mutation)).toMatchObject({
      importedProblem: replacement.problem,
      importedDrafts: [replacement],
    });
  });

  it('selects a replacement when capacity eviction removes the active draft', () => {
    const drafts = Array.from({ length: 20 }, (_, index) =>
      importedDraft(
        `draft-${index}`,
        index === 0 ? 'imported-draft' : `imported-draft-${index}`,
        `2026-07-13T00:${String(index).padStart(2, '0')}:00.000Z`
      )
    );
    const incoming = importedDraft(
      'incoming',
      'imported-draft-incoming',
      '2026-07-14T00:00:00.000Z'
    );
    const document = {
      state: createInitialCoachState(),
      importedProblem: drafts[0]!.problem,
      importedDrafts: drafts,
      reviewProgress: createInitialReviewProgress(),
    };

    const applied = applyCoachSyncMutation(document, {
      id: 'capacity-eviction',
      baseRevision: 1,
      createdAt: incoming.updatedAt,
      changes: {},
      importedDraftUpserts: [incoming],
    });

    expect(applied.importedDrafts).toHaveLength(20);
    expect(
      applied.importedDrafts.some(
        (record) => record.problem.slug === 'imported-draft'
      )
    ).toBe(false);
    expect(applied.importedProblem).toEqual(incoming.problem);
  });

  it('does not overwrite a newer remote draft with an older queued edit', () => {
    const remote = importedDraft(
      'first',
      'imported-draft',
      '2026-07-15T00:00:00.000Z'
    );
    const stale = {
      ...remote,
      problem: { ...remote.problem, difficulty: 'hard' as const },
      updatedAt: '2026-07-14T00:00:00.000Z',
    };
    const document = {
      state: createInitialCoachState(),
      importedProblem: remote.problem,
      importedDrafts: [remote],
      reviewProgress: createInitialReviewProgress(),
    };

    const applied = applyCoachSyncMutation(document, {
      id: 'stale-draft',
      baseRevision: 2,
      createdAt: stale.updatedAt,
      changes: {},
      importedProblem: stale.problem,
      importedDraftUpserts: [stale],
    });

    expect(applied.importedDrafts).toEqual([remote]);
    expect(applied.importedProblem).toEqual(remote.problem);
  });

  it('rejects ambiguous draft mutations', () => {
    const record = importedDraft('first', 'imported-draft');
    const parsed = coachSyncMutationSchema.safeParse({
      id: 'ambiguous-draft',
      baseRevision: 0,
      createdAt: '2026-07-14T00:00:00.000Z',
      changes: {},
      importedDraftUpserts: [record],
      deletedImportedDraftSlugs: [record.problem.slug],
    });

    expect(parsed.success).toBe(false);

    const duplicateTestIds = {
      ...record,
      problem: {
        ...record.problem,
        tests: [
          {
            id: 'duplicate-test',
            args: [1],
            expected: 1,
            isSample: true,
          },
          {
            id: 'duplicate-test',
            args: [2],
            expected: 2,
            isSample: true,
          },
        ],
      },
    };
    expect(
      coachSyncMutationSchema.safeParse({
        id: 'duplicate-tests',
        baseRevision: 0,
        createdAt: '2026-07-14T00:00:00.000Z',
        changes: {},
        importedDraftUpserts: [duplicateTestIds],
      }).success
    ).toBe(false);
    expect(
      coachSyncMutationSchema.safeParse({
        id: 'future-draft',
        baseRevision: 0,
        createdAt: '2026-07-14T00:00:00.000Z',
        changes: {},
        importedDraftUpserts: [
          {
            ...importedDraft('future', 'future-draft'),
            updatedAt: '2100-01-01T00:00:00.000Z',
          },
        ],
      }).success
    ).toBe(false);
  });
});
