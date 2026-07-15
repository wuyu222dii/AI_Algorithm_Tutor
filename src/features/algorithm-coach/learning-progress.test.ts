import { describe, expect, it } from 'vitest';

import { getCompletedProblemIds } from './components/domain-adapter';
import { problems } from './data/problems';
import {
  calculateLearningStreak,
  calculateTopicMasterySnapshots,
  claimGuestReviewProgress,
  countNaturalWeekCompletions,
  createInitialReviewProgress,
  getReviewItemKey,
  loadReviewProgress,
  markReviewItemMastered,
  rateReviewItem,
  reconcileReviewProgress,
  REVIEW_PROGRESS_STORAGE_KEY,
  REVIEW_PROGRESS_VERSION,
  saveReviewProgress,
  scheduleReview,
} from './learning-progress';
import { calculateProductMetrics, calculateTopicMastery } from './metrics';
import { getProblemRecommendations } from './recommendations';
import { createInitialCoachState } from './storage';
import { getPracticeSessionKey } from './sync';
import type { CodeRunResult, PracticeSession } from './types';

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

function run(
  problemSlug: string,
  status: CodeRunResult['status'],
  executedAt: string
): CodeRunResult {
  return {
    id: `${problemSlug}:${executedAt}:${status}`,
    problemSlug,
    language: 'javascript',
    status,
    passedTests: status === 'passed' ? 4 : 2,
    totalTests: 4,
    testResults: [],
    console: [],
    durationMs: 3,
    executedAt,
    submitted: true,
    testScope: 'full',
  };
}

function session(
  problemSlug: string,
  runs: CodeRunResult[],
  overrides: Partial<PracticeSession> = {}
): PracticeSession {
  return {
    problemSlug,
    code: {},
    runs,
    hintLevel: 0,
    diagnosisCount: 0,
    correctedAfterDiagnosis: false,
    startedAt: runs[0]?.executedAt ?? '2026-07-01T00:00:00.000Z',
    updatedAt: runs.at(-1)?.executedAt ?? '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('learning progress', () => {
  it('calculates streaks from one timezone-aware algorithm across pages', () => {
    const state = createInitialCoachState();
    state.runs = [
      run('first-unique-position', 'failed', '2026-07-13T13:00:00.000Z'),
      run('maximum-bracket-depth', 'passed', '2026-07-12T11:00:00.000Z'),
    ];
    const now = new Date('2026-07-13T14:00:00.000Z');

    expect(
      calculateLearningStreak(state, {
        now,
        timeZone: 'Pacific/Auckland',
      })
    ).toBe(1);
    expect(calculateLearningStreak(state, { now, timeZone: 'UTC' })).toBe(2);
  });

  it('counts first full passes in the current Monday-based user-timezone week', () => {
    const state = createInitialCoachState();
    state.sessions['first-unique-position'] = session(
      'first-unique-position',
      [run('first-unique-position', 'passed', '2026-07-12T11:30:00.000Z')],
      { completedAt: '2026-07-12T11:30:00.000Z' }
    );
    state.sessions['maximum-bracket-depth'] = session(
      'maximum-bracket-depth',
      [run('maximum-bracket-depth', 'passed', '2026-07-12T12:30:00.000Z')],
      { completedAt: '2026-07-12T12:30:00.000Z' }
    );

    expect(
      countNaturalWeekCompletions(state, {
        now: new Date('2026-07-13T00:30:00.000Z'),
        timeZone: 'Pacific/Auckland',
        catalog: problems,
      })
    ).toBe(1);
  });

  it('does not count a later pass when the first full pass was in an earlier week', () => {
    const state = createInitialCoachState();
    state.sessions['first-unique-position'] = session(
      'first-unique-position',
      [
        run('first-unique-position', 'passed', '2026-07-05T10:00:00.000Z'),
        run('first-unique-position', 'passed', '2026-07-14T10:00:00.000Z'),
      ],
      { completedAt: '2026-07-14T10:00:00.000Z' }
    );

    expect(
      countNaturalWeekCompletions(state, {
        now: new Date('2026-07-14T12:00:00.000Z'),
        timeZone: 'UTC',
        catalog: problems,
      })
    ).toBe(0);
  });

  it('does not treat a sample-only pass as a completed problem', () => {
    const state = createInitialCoachState();
    const samplePass = run(
      'first-unique-position',
      'passed',
      '2026-07-14T10:00:00.000Z'
    );
    samplePass.submitted = false;
    samplePass.testScope = 'sample';
    state.sessions['first-unique-position'] = session(
      'first-unique-position',
      [samplePass],
      { completedAt: '2026-07-14T10:00:00.000Z' }
    );

    expect(
      countNaturalWeekCompletions(state, {
        now: new Date('2026-07-14T12:00:00.000Z'),
        timeZone: 'UTC',
        catalog: problems,
      })
    ).toBe(0);
    expect(calculateProductMetrics(state).completedProblems).toBe(0);
    expect(getCompletedProblemIds(state).has('first-unique-position')).toBe(
      false
    );
    expect(
      getProblemRecommendations(state, { limit: 38, catalog: problems }).find(
        (item) => item.problem.slug === 'first-unique-position'
      )?.score
    ).toBeGreaterThan(0);
  });

  it('uses the same topic mastery values in snapshots and product metrics', () => {
    const state = createInitialCoachState();
    state.sessions['first-unique-position'] = session(
      'first-unique-position',
      [run('first-unique-position', 'passed', '2026-07-14T10:00:00.000Z')],
      { completedAt: '2026-07-14T10:00:00.000Z' }
    );
    const progress = reconcileReviewProgress(
      state,
      createInitialReviewProgress(),
      { now: new Date('2026-07-14T12:00:00.000Z'), catalog: problems }
    );
    const snapshots = calculateTopicMasterySnapshots(
      state,
      progress.items,
      problems
    );
    const metrics = calculateTopicMastery(state, progress.items, problems);

    expect(snapshots['array-hash'].evidenceCount).toBeGreaterThan(0);
    expect(metrics['array-hash']).toBe(snapshots['array-hash'].value);
  });

  it('uses only the current catalog version across metrics and review evidence', () => {
    const slug = 'first-unique-position';
    const currentCatalog = problems.map((problem) =>
      problem.slug === slug
        ? { ...problem, version: { contentVersion: 2 } }
        : problem
    );
    const oldPass = {
      ...run(slug, 'passed', '2026-07-13T10:00:00.000Z'),
      problemContentVersion: 1,
    };
    const currentFailure = {
      ...run(slug, 'failed', '2026-07-14T10:00:00.000Z'),
      problemContentVersion: 2,
    };
    const state = createInitialCoachState();
    state.sessions[slug] = session(slug, [oldPass], {
      problemContentVersion: 1,
      hintLevel: 3,
      completedAt: oldPass.executedAt,
    });
    const currentKey = getPracticeSessionKey(slug, 2);
    state.sessions[currentKey] = session(slug, [currentFailure], {
      problemContentVersion: 2,
    });
    state.runs = [oldPass, currentFailure];

    const metrics = calculateProductMetrics(
      state,
      {},
      {
        now: new Date('2026-07-14T12:00:00.000Z'),
        timeZone: 'UTC',
        catalog: currentCatalog,
      }
    );
    expect(metrics).toMatchObject({
      attemptedProblems: 1,
      completedProblems: 0,
      hintedProblems: 0,
      currentStreak: 1,
    });
    expect(calculateProductMetrics(state)).toMatchObject({
      attemptedProblems: 1,
      completedProblems: 0,
    });
    expect(
      countNaturalWeekCompletions(state, {
        now: new Date('2026-07-14T12:00:00.000Z'),
        timeZone: 'UTC',
        catalog: currentCatalog,
      })
    ).toBe(0);

    const progress = reconcileReviewProgress(
      state,
      createInitialReviewProgress(),
      {
        now: new Date('2026-07-14T12:00:00.000Z'),
        catalog: currentCatalog,
      }
    );
    expect(progress.items[getReviewItemKey(slug, 2)]).toMatchObject({
      problemContentVersion: 2,
      status: 'due',
      lastObservedRunAt: currentFailure.executedAt,
      lastFailureAt: currentFailure.executedAt,
    });
    expect(progress.items[slug]).toBeUndefined();
    expect(
      calculateTopicMasterySnapshots(state, progress.items, currentCatalog)[
        'array-hash'
      ].evidenceCount
    ).toBe(1);
  });

  it('closes a failed item after a later full pass and schedules review', () => {
    const state = createInitialCoachState();
    state.sessions['dependency-cycle'] = session('dependency-cycle', [
      run('dependency-cycle', 'failed', '2026-07-13T10:00:00.000Z'),
      run('dependency-cycle', 'passed', '2026-07-14T10:00:00.000Z'),
    ]);

    const progress = reconcileReviewProgress(
      state,
      createInitialReviewProgress(),
      { now: new Date('2026-07-14T11:00:00.000Z'), catalog: problems }
    );

    expect(progress.items['dependency-cycle']).toMatchObject({
      status: 'resolved',
      source: 'mistake',
      lastFailureAt: '2026-07-13T10:00:00.000Z',
      lastObservedRunAt: '2026-07-14T10:00:00.000Z',
    });
    expect(
      Date.parse(progress.items['dependency-cycle'].dueAt)
    ).toBeGreaterThan(Date.parse('2026-07-14T10:00:00.000Z'));
  });

  it('reopens a mastered item when a newer run fails', () => {
    const firstState = createInitialCoachState();
    firstState.sessions['dependency-cycle'] = session('dependency-cycle', [
      run('dependency-cycle', 'passed', '2026-07-13T10:00:00.000Z'),
    ]);
    const resolved = reconcileReviewProgress(
      firstState,
      createInitialReviewProgress(),
      { now: new Date('2026-07-13T11:00:00.000Z'), catalog: problems }
    );
    const mastered = markReviewItemMastered(
      resolved,
      'dependency-cycle',
      new Date('2026-07-13T12:00:00.000Z')
    );

    const failedState = structuredClone(firstState);
    failedState.sessions['dependency-cycle'].runs.push(
      run('dependency-cycle', 'failed', '2026-07-14T10:00:00.000Z')
    );
    failedState.sessions['dependency-cycle'].updatedAt =
      '2026-07-14T10:00:00.000Z';
    const reopened = reconcileReviewProgress(failedState, mastered, {
      now: new Date('2026-07-14T11:00:00.000Z'),
      catalog: problems,
    });

    expect(reopened.items['dependency-cycle'].status).toBe('due');
    expect(reopened.items['dependency-cycle'].lastFailureAt).toBe(
      '2026-07-14T10:00:00.000Z'
    );
  });

  it('applies deterministic spaced-repetition intervals for all ratings', () => {
    const item = {
      problemSlug: 'dependency-cycle',
      status: 'due' as const,
      source: 'mistake' as const,
      dueAt: '2026-07-14T10:00:00.000Z',
      intervalDays: 3,
      repetitions: 0,
      easeFactor: 2.5,
      updatedAt: '2026-07-14T10:00:00.000Z',
    };
    const reviewedAt = new Date('2026-07-14T12:00:00.000Z');

    expect(scheduleReview(item, 'again', reviewedAt).intervalDays).toBe(1);
    expect(scheduleReview(item, 'hard', reviewedAt).intervalDays).toBe(4);
    expect(scheduleReview(item, 'good', reviewedAt).intervalDays).toBe(3);
    expect(scheduleReview(item, 'easy', reviewedAt).intervalDays).toBe(7);
  });

  it('persists ratings and transfers guest review progress to the first account', () => {
    const storage = createMemoryStorage();
    const state = createInitialCoachState();
    state.sessions['dependency-cycle'] = session('dependency-cycle', [
      run('dependency-cycle', 'failed', '2026-07-14T10:00:00.000Z'),
    ]);
    const due = reconcileReviewProgress(state, createInitialReviewProgress(), {
      now: new Date('2026-07-14T11:00:00.000Z'),
      catalog: problems,
    });
    const rated = rateReviewItem(
      due,
      'dependency-cycle',
      'good',
      new Date('2026-07-14T12:00:00.000Z')
    );
    saveReviewProgress(rated, storage, 'guest');

    expect(claimGuestReviewProgress('user:test-account', storage)).toBe(true);
    expect(loadReviewProgress(storage, 'guest').items).toEqual({});
    expect(
      loadReviewProgress(storage, 'user:test-account').items['dependency-cycle']
    ).toMatchObject({ lastRating: 'good', repetitions: 1 });
  });

  it('migrates v1 review storage and keeps revisions independent', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      'algocoach:review-progress:v1',
      JSON.stringify({
        version: 1,
        items: {
          'dependency-cycle': {
            problemSlug: 'dependency-cycle',
            status: 'due',
            source: 'mistake',
            dueAt: '2026-07-14T10:00:00.000Z',
            intervalDays: 1,
            repetitions: 0,
            easeFactor: 2.5,
            updatedAt: '2026-07-14T10:00:00.000Z',
          },
        },
      })
    );

    const migrated = loadReviewProgress(storage);
    expect(migrated.version).toBe(REVIEW_PROGRESS_VERSION);
    expect(migrated.items['dependency-cycle']).toMatchObject({
      problemSlug: 'dependency-cycle',
      problemContentVersion: 1,
    });
    expect(storage.getItem('algocoach:review-progress:v1')).toBeNull();
    expect(storage.getItem(REVIEW_PROGRESS_STORAGE_KEY)).not.toBeNull();

    const versionTwoKey = getReviewItemKey('dependency-cycle', 2);
    const withVersionTwo = {
      ...migrated,
      items: {
        ...migrated.items,
        [versionTwoKey]: {
          ...migrated.items['dependency-cycle'],
          problemContentVersion: 2,
          updatedAt: '2026-07-15T10:00:00.000Z',
        },
      },
    };
    const rated = rateReviewItem(
      withVersionTwo,
      'dependency-cycle',
      'good',
      new Date('2026-07-15T12:00:00.000Z'),
      2
    );

    expect(rated.items[versionTwoKey].lastRating).toBe('good');
    expect(rated.items['dependency-cycle'].lastRating).toBeUndefined();
  });
});
