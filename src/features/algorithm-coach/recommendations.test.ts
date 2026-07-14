import { describe, expect, it } from 'vitest';

import { getProblemRecommendations } from './recommendations';
import { createInitialCoachState } from './storage';
import type { CodeRunResult, PracticeSession } from './types';

function run(
  problemSlug: string,
  status: CodeRunResult['status']
): CodeRunResult {
  return {
    problemSlug,
    language: 'javascript',
    status,
    passedTests: status === 'passed' ? 4 : 1,
    totalTests: 4,
    testResults: [],
    console: [],
    durationMs: 3,
    executedAt: '2026-07-01T00:00:00.000Z',
  };
}

function session(
  problemSlug: string,
  status: CodeRunResult['status'],
  overrides: Partial<PracticeSession> = {}
): PracticeSession {
  return {
    problemSlug,
    code: {},
    runs: [run(problemSlug, status)],
    hintLevel: 0,
    diagnosisCount: 0,
    correctedAfterDiagnosis: false,
    startedAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('adaptive problem recommendations', () => {
  it('prioritizes a recent failed problem', () => {
    const state = createInitialCoachState();
    state.sessions['dependency-cycle'] = session('dependency-cycle', 'failed');

    const [first] = getProblemRecommendations(state, {
      now: new Date('2026-07-02T00:00:00.000Z'),
    });

    expect(first.problem.slug).toBe('dependency-cycle');
    expect(first.reason).toBe('retry');
  });

  it('brings a completed hinted problem back when review is due', () => {
    const state = createInitialCoachState();
    state.sessions['maximum-bracket-depth'] = session(
      'maximum-bracket-depth',
      'passed',
      {
        hintLevel: 2,
        completedAt: '2026-07-01T00:00:00.000Z',
      }
    );

    const recommendations = getProblemRecommendations(state, {
      now: new Date('2026-07-05T00:00:00.000Z'),
    });
    const review = recommendations.find(
      (item) => item.problem.slug === 'maximum-bracket-depth'
    );

    expect(review?.reason).toBe('review-due');
  });

  it('does not immediately repeat a completed independent problem', () => {
    const state = createInitialCoachState();
    state.sessions['first-unique-position'] = session(
      'first-unique-position',
      'passed',
      {
        completedAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      }
    );

    const recommendations = getProblemRecommendations(state, {
      now: new Date('2026-07-13T00:00:00.000Z'),
    });

    expect(recommendations[0].problem.slug).not.toBe('first-unique-position');
  });

  it('fits the daily plan to the learner time budget', () => {
    const recommendations = getProblemRecommendations(
      createInitialCoachState(),
      { limit: 3, maxMinutes: 45 }
    );

    expect(recommendations.length).toBeGreaterThan(0);
    expect(
      recommendations.reduce(
        (total, item) => total + item.problem.estimatedMinutes,
        0
      )
    ).toBeLessThanOrEqual(45);
  });

  it('prioritizes topics identified by the latest assessment', () => {
    const state = createInitialCoachState();
    state.assessments = [
      {
        id: 'assessment-1',
        problemSlugs: ['minimum-processing-rate'],
        startedAt: '2026-07-13T00:00:00.000Z',
        completedAt: '2026-07-13T00:20:00.000Z',
        score: 50,
        correctCount: 1,
        totalCount: 2,
        weakTopics: ['dynamic-programming'],
        recommendation: 'Review dynamic programming.',
      },
    ];

    const [first] = getProblemRecommendations(state, { limit: 1 });
    expect(first.problem.topics).toContain('dynamic-programming');
    expect(first.reason).toBe('weak-topic');
  });
});
