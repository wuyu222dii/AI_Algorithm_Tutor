import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { problems } from './data/problems';
import { loadImportedDrafts } from './imported-drafts';
import {
  claimGuestCoachData,
  COACH_ANALYTICS_KEY,
  COACH_EXPERIMENT_KEY,
  COACH_GUEST_CLAIM_KEY,
  COACH_STORAGE_KEY,
  COACH_SYNC_QUEUE_KEY,
  createCoachStorageScope,
  createInitialCoachState,
  getScopedStorageKey,
  loadCoachState,
  loadImportedProblem,
  saveCoachState,
  saveImportedProblem,
} from './storage';
import { CoachProvider, useCoachStore } from './store';
import { getPracticeSessionKey } from './sync';
import {
  CodeRunResult,
  LearningArtifact,
  Problem,
  ProductEvent,
  ReviewProgressState,
} from './types';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

const reviewCard: LearningArtifact = {
  id: 'review_card_test',
  type: 'review_card',
  locale: 'zh',
  problemSlug: 'dependency-cycle',
  title: '复习卡片',
  summary: '依赖图成环复习要点',
  details: ['使用三色状态记录 DFS 路径。'],
  evidence: ['最近运行：4/4 通过。'],
  reviewCard: {
    front: '如何判断有向依赖图成环？',
    back: '访问到当前路径中的节点时存在环。',
    tags: ['dfs'],
  },
  createdAt: '2026-07-12T00:00:00.000Z',
};

const importedProblem: Problem = {
  id: 'imported-test',
  slug: 'imported-draft',
  title: { zh: '导入题', en: 'Imported problem' },
  description: { zh: '测试题目', en: 'Test problem' },
  difficulty: 'easy',
  topics: ['custom'],
  entryPoint: 'solve',
  templates: { javascript: 'function solve() {}', python: 'def solve(): pass' },
  tests: [],
  examples: [],
  constraints: [],
  hints: { zh: ['', '', ''], en: ['', '', ''] },
  reviewPoints: [],
  estimatedMinutes: 10,
};

const activationEvent: ProductEvent = {
  id: 'event_guest_activation',
  name: 'activated',
  timestamp: '2026-07-12T00:00:00.000Z',
  sessionId: 'session_guest',
};

const remoteReviewProgress: ReviewProgressState = {
  version: 1,
  items: {
    'dependency-cycle': {
      problemSlug: 'dependency-cycle',
      status: 'due',
      source: 'mistake',
      dueAt: '2026-07-12T00:00:00.000Z',
      intervalDays: 1,
      repetitions: 0,
      easeFactor: 2.5,
      updatedAt: '2026-07-12T00:00:00.000Z',
      lastFailureAt: '2026-07-12T00:00:00.000Z',
    },
  },
};

describe('CoachProvider persistence', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists an added review card artifact to versioned localStorage', async () => {
    const { result } = renderHook(() => useCoachStore(), {
      wrapper: ({ children }) => (
        <CoachProvider problems={problems}>{children}</CoachProvider>
      ),
    });

    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.addArtifact(reviewCard));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(COACH_STORAGE_KEY) ?? '{}'
      ) as { artifacts?: LearningArtifact[] };
      expect(stored.artifacts).toContainEqual(
        expect.objectContaining({
          ...reviewCard,
          problemContentVersion: 1,
        })
      );
    });
  });

  it('clears the active draft when the final private draft is deleted', async () => {
    const { result } = renderHook(() => useCoachStore(), {
      wrapper: ({ children }) => (
        <CoachProvider problems={problems}>{children}</CoachProvider>
      ),
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.saveImportedProblem(importedProblem));
    await waitFor(() => expect(result.current.importedDrafts).toHaveLength(1));

    act(() => result.current.deleteImportedProblem(importedProblem.slug));

    expect(result.current.importedProblem).toBeNull();
    expect(result.current.importedDrafts).toEqual([]);
    await waitFor(() => expect(loadImportedDrafts()).toEqual([]));
  });

  it('clears persisted review mastery when learning data is reset', async () => {
    const { result } = renderHook(() => useCoachStore(), {
      wrapper: ({ children }) => (
        <CoachProvider problems={problems}>{children}</CoachProvider>
      ),
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    const failedRun: CodeRunResult = {
      problemSlug: 'dependency-cycle',
      language: 'javascript',
      status: 'failed',
      passedTests: 2,
      totalTests: 4,
      testResults: [],
      console: [],
      durationMs: 3,
      executedAt: '2026-07-14T10:00:00.000Z',
      testScope: 'full',
      submitted: true,
    };
    act(() => result.current.recordRun('dependency-cycle', failedRun));
    await waitFor(() =>
      expect(result.current.reviewItems['dependency-cycle']?.status).toBe('due')
    );
    act(() => result.current.markReviewMastered('dependency-cycle'));
    await waitFor(() =>
      expect(result.current.reviewItems['dependency-cycle']?.status).toBe(
        'mastered'
      )
    );

    let reset = false;
    await act(async () => {
      reset = await result.current.resetData();
    });

    expect(reset).toBe(true);
    expect(result.current.reviewItems).toEqual({});
  });

  it('keeps the original storage key for guest compatibility', () => {
    const storage = createMemoryStorage();
    const guest = createInitialCoachState();
    guest.artifacts.push(reviewCard);

    saveCoachState(guest, storage);

    expect(storage.getItem(COACH_STORAGE_KEY)).toBeTruthy();
    expect(
      storage.getItem(
        getScopedStorageKey(COACH_STORAGE_KEY, createCoachStorageScope('a'))
      )
    ).toBeNull();
  });

  it('keeps code, runs, hints, and diagnosis state isolated by problem version', async () => {
    const slug = 'dependency-cycle';
    const existing = createInitialCoachState();
    existing.sessions[slug] = {
      problemSlug: slug,
      problemContentVersion: 1,
      code: { javascript: 'version-one-code' },
      runs: [],
      hintLevel: 2,
      diagnosisCount: 0,
      correctedAfterDiagnosis: false,
      startedAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    };
    existing.code[slug] = { javascript: 'version-one-code' };
    saveCoachState(existing);
    const versionTwoProblems = problems.map((problem) =>
      problem.slug === slug
        ? { ...problem, version: { contentVersion: 2 } }
        : problem
    );

    const { result } = renderHook(() => useCoachStore(), {
      wrapper: ({ children }) => (
        <CoachProvider problems={versionTwoProblems}>{children}</CoachProvider>
      ),
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    const run: CodeRunResult = {
      id: 'version-two-run',
      problemSlug: slug,
      language: 'javascript',
      status: 'failed',
      passedTests: 1,
      totalTests: 4,
      testResults: [],
      console: [],
      durationMs: 3,
      executedAt: '2026-07-14T10:00:00.000Z',
      testScope: 'full',
      submitted: true,
    };
    act(() => {
      result.current.saveCode(slug, 'javascript', 'version-two-code');
      result.current.revealHint(slug);
      result.current.recordRun(slug, run);
      result.current.addArtifact({
        ...reviewCard,
        id: 'version-two-diagnosis',
        type: 'diagnose',
        problemSlug: slug,
      });
    });

    const v2Key = getPracticeSessionKey(slug, 2);
    await waitFor(() => {
      expect(result.current.state.sessions[v2Key]).toMatchObject({
        problemSlug: slug,
        problemContentVersion: 2,
        code: { javascript: 'version-two-code' },
        hintLevel: 1,
        diagnosisCount: 1,
      });
    });
    expect(result.current.state.sessions[v2Key].runs).toEqual([
      expect.objectContaining({
        id: 'version-two-run',
        problemContentVersion: 2,
      }),
    ]);
    expect(result.current.state.code[v2Key]?.javascript).toBe(
      'version-two-code'
    );
    expect(result.current.state.sessions[slug]).toMatchObject({
      problemContentVersion: 1,
      code: { javascript: 'version-one-code' },
      hintLevel: 2,
      diagnosisCount: 0,
      runs: [],
    });
    expect(result.current.state.artifacts).toContainEqual(
      expect.objectContaining({
        id: 'version-two-diagnosis',
        problemContentVersion: 2,
      })
    );
  });

  it('lets only the first account claim guest data and isolates later accounts', () => {
    const storage = createMemoryStorage();
    const guest = createInitialCoachState();
    guest.profile = {
      goal: 'interview',
      preferredLanguage: 'javascript',
      weeklyTarget: 5,
      onboardedAt: '2026-07-12T00:00:00.000Z',
    };
    guest.artifacts.push(reviewCard);
    saveCoachState(guest, storage);
    saveImportedProblem(importedProblem, storage);
    storage.setItem(COACH_ANALYTICS_KEY, JSON.stringify([activationEvent]));
    storage.setItem(COACH_EXPERIMENT_KEY, 'B');

    const accountA = createCoachStorageScope('account-a');
    const accountB = createCoachStorageScope('account-b');

    expect(claimGuestCoachData(accountA, storage)).toBe(true);
    expect(storage.getItem(COACH_GUEST_CLAIM_KEY)).toBe(accountA);
    expect(loadCoachState(storage, accountA).profile?.goal).toBe('interview');
    expect(loadCoachState(storage, accountA).artifacts).toContainEqual(
      expect.objectContaining(reviewCard)
    );
    expect(loadImportedProblem(storage, accountA)).toEqual(importedProblem);
    expect(
      JSON.parse(
        storage.getItem(getScopedStorageKey(COACH_ANALYTICS_KEY, accountA)) ??
          '[]'
      )
    ).toContainEqual(activationEvent);
    expect(
      storage.getItem(getScopedStorageKey(COACH_EXPERIMENT_KEY, accountA))
    ).toBe('B');

    expect(loadCoachState(storage).profile).toBeNull();
    expect(loadImportedProblem(storage)).toBeNull();

    const signedOutGuest = createInitialCoachState();
    signedOutGuest.profile = {
      goal: 'contest',
      preferredLanguage: 'python',
      weeklyTarget: 3,
      onboardedAt: '2026-07-13T00:00:00.000Z',
    };
    saveCoachState(signedOutGuest, storage);

    expect(claimGuestCoachData(accountB, storage)).toBe(false);
    expect(loadCoachState(storage, accountB).profile).toBeNull();
    expect(loadCoachState(storage, accountA).profile?.goal).toBe('interview');
    expect(loadCoachState(storage).profile?.goal).toBe('contest');
  });

  it('recovers a revision conflict and replays the persisted mutation queue', async () => {
    const scope = createCoachStorageScope('conflict-account');
    const firstRemote = createInitialCoachState();
    firstRemote.artifacts = [{ ...reviewCard, id: 'remote-before' }];
    const latestRemote = createInitialCoachState();
    latestRemote.artifacts = [{ ...reviewCard, id: 'remote-concurrent' }];
    let getCount = 0;
    let patchCount = 0;
    const patchBodies: Array<{
      mutations: Array<{ changes: { reviewItems?: unknown } }>;
    }> = [];

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          patchCount += 1;
          patchBodies.push(JSON.parse(String(init.body)));
          if (patchCount === 1) {
            return Response.json(
              {
                error: {
                  code: 'revision_conflict',
                  details: { currentRevision: 2 },
                },
              },
              { status: 409 }
            );
          }
          const body = JSON.parse(String(init.body)) as {
            mutations: Array<{ id: string }>;
          };
          return Response.json({
            data: {
              revision: 3,
              appliedMutationIds: body.mutations.map((item) => item.id),
              replayedMutationIds: [],
            },
          });
        }

        getCount += 1;
        return Response.json({
          data: {
            state: getCount === 1 ? firstRemote : latestRemote,
            importedProblem: null,
            reviewProgress:
              getCount === 1
                ? remoteReviewProgress
                : {
                    ...remoteReviewProgress,
                    items: {
                      ...remoteReviewProgress.items,
                      'minimum-processing-rate': {
                        problemSlug: 'minimum-processing-rate',
                        status: 'due',
                        source: 'completion',
                        dueAt: '2026-07-15T00:00:00.000Z',
                        intervalDays: 1,
                        repetitions: 0,
                        easeFactor: 2.5,
                        updatedAt: '2026-07-13T00:00:00.000Z',
                      },
                    },
                  },
            hasData: true,
            revision: getCount === 1 ? 1 : 2,
          },
        });
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useCoachStore(), {
      wrapper: ({ children }) => (
        <CoachProvider problems={problems} storageScope={scope}>
          {children}
        </CoachProvider>
      ),
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.rateReview('dependency-cycle', 'good');
      result.current.addArtifact({ ...reviewCard, id: 'local-offline' });
    });

    await waitFor(
      () => {
        expect(patchCount).toBeGreaterThanOrEqual(2);
        expect(result.current.syncStatus).toBe('synced');
      },
      { timeout: 4_000 }
    );

    expect(result.current.state.artifacts.map((item) => item.id)).toEqual(
      expect.arrayContaining(['remote-concurrent', 'local-offline'])
    );
    expect(result.current.reviewItems['dependency-cycle']).toMatchObject({
      status: 'resolved',
      lastRating: 'good',
    });
    expect(result.current.reviewItems['minimum-processing-rate']).toBeTruthy();
    expect(
      patchBodies.some((body) =>
        body.mutations.some((mutation) => mutation.changes.reviewItems)
      )
    ).toBe(true);
    expect(
      window.localStorage.getItem(
        getScopedStorageKey(COACH_SYNC_QUEUE_KEY, scope)
      )
    ).toBeNull();
    unmount();
  });

  it('tracks sync failures without recursively enqueueing the failure event', async () => {
    const scope = createCoachStorageScope('offline-account');
    let patchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          patchCount += 1;
          return Response.json(
            { error: { code: 'temporarily_unavailable' } },
            { status: 503 }
          );
        }
        return Response.json({
          data: {
            state: createInitialCoachState(),
            importedProblem: null,
            importedDrafts: [],
            reviewProgress: { version: 1, items: {} },
            hasData: false,
            revision: 0,
          },
        });
      })
    );

    const { result, unmount } = renderHook(() => useCoachStore(), {
      wrapper: ({ children }) => (
        <CoachProvider problems={problems} storageScope={scope}>
          {children}
        </CoachProvider>
      ),
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.addArtifact({ ...reviewCard, id: 'offline-artifact' });
    });
    await waitFor(
      () => {
        expect(patchCount).toBeGreaterThanOrEqual(1);
        expect(result.current.syncStatus).toBe('error');
      },
      { timeout: 3_000 }
    );

    const queued = JSON.parse(
      window.localStorage.getItem(
        getScopedStorageKey(COACH_SYNC_QUEUE_KEY, scope)
      ) ?? '[]'
    ) as Array<{ changes?: { events?: ProductEvent[] } }>;
    expect(queued).toHaveLength(1);
    expect(
      queued.flatMap((mutation) => mutation.changes?.events ?? [])
    ).not.toContainEqual(expect.objectContaining({ name: 'sync_failed' }));
    const analytics = JSON.parse(
      window.localStorage.getItem(
        getScopedStorageKey(COACH_ANALYTICS_KEY, scope)
      ) ?? '[]'
    ) as ProductEvent[];
    expect(analytics).toContainEqual(
      expect.objectContaining({
        name: 'sync_failed',
        properties: expect.objectContaining({ reason: 'server' }),
      })
    );
    expect(result.current.state.events).not.toContainEqual(
      expect.objectContaining({ name: 'sync_failed' })
    );
    unmount();
  });
});
