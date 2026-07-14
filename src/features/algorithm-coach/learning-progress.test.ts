import { describe, expect, it } from 'vitest';

import { getCompletedProblemIds } from './components/domain-adapter';
import {
  calculateLearningStreak,
  calculateTopicMasterySnapshots,
  claimGuestReviewProgress,
  countNaturalWeekCompletions,
  createInitialReviewProgress,
  loadReviewProgress,
  markReviewItemMastered,
  rateReviewItem,
  reconcileReviewProgress,
  saveReviewProgress,
  scheduleReview,
} from './learning-progress';
import { calculateProductMetrics, calculateTopicMastery } from './metrics';
import { getProblemRecommendations } from './recommendations';
import { createInitialCoachState } from './storage';
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
      })
    ).toBe(0);
    expect(calculateProductMetrics(state).completedProblems).toBe(0);
    expect(getCompletedProblemIds(state).has('first-unique-position')).toBe(
      false
    );
    expect(
      getProblemRecommendations(state, { limit: 38 }).find(
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
      { now: new Date('2026-07-14T12:00:00.000Z') }
    );
    const snapshots = calculateTopicMasterySnapshots(state, progress.items);
    const metrics = calculateTopicMastery(state, progress.items);

    expect(snapshots['array-hash'].evidenceCount).toBeGreaterThan(0);
    expect(metrics['array-hash']).toBe(snapshots['array-hash'].value);
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
      { now: new Date('2026-07-14T11:00:00.000Z') }
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
      { now: new Date('2026-07-13T11:00:00.000Z') }
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
});
