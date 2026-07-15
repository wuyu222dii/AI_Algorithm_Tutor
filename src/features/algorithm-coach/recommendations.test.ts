import { describe, expect, it } from 'vitest';

import { problems } from './data/problems';
import { getProblemRecommendations } from './recommendations';
import { createInitialCoachState } from './storage';
import { getPracticeSessionKey } from './sync';
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
      catalog: problems,
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
      catalog: problems,
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
      catalog: problems,
    });

    expect(recommendations[0].problem.slug).not.toBe('first-unique-position');
  });

  it('fits the daily plan to the learner time budget', () => {
    const recommendations = getProblemRecommendations(
      createInitialCoachState(),
      { limit: 3, maxMinutes: 45, catalog: problems }
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

    const [first] = getProblemRecommendations(state, {
      limit: 1,
      catalog: problems,
    });
    expect(first.problem.topics).toContain('dynamic-programming');
    expect(first.reason).toBe('weak-topic');
  });

  it('bases retry recommendations on the current problem version', () => {
    const slug = 'first-unique-position';
    const currentCatalog = problems.map((problem) =>
      problem.slug === slug
        ? { ...problem, version: { contentVersion: 2 } }
        : problem
    );
    const state = createInitialCoachState();
    state.sessions[slug] = session(slug, 'passed', {
      problemContentVersion: 1,
      completedAt: '2026-07-01T00:00:00.000Z',
    });
    const currentRun = {
      ...run(slug, 'failed'),
      problemContentVersion: 2,
      executedAt: '2026-07-02T00:00:00.000Z',
    };
    state.sessions[getPracticeSessionKey(slug, 2)] = session(slug, 'failed', {
      problemContentVersion: 2,
      runs: [currentRun],
      updatedAt: currentRun.executedAt,
    });

    const recommendation = getProblemRecommendations(state, {
      limit: currentCatalog.length,
      now: new Date('2026-07-03T00:00:00.000Z'),
      catalog: currentCatalog,
    }).find((item) => item.problem.slug === slug);

    expect(recommendation?.reason).toBe('retry');
  });

  it('uses only enabled languages and revisions that support the fallback', () => {
    const javascriptOnly = {
      ...problems[0],
      slug: 'javascript-only',
      id: 'javascript-only',
      languageConfigs: {
        javascript: {
          entryPoint: 'solve',
          template: 'function solve(value) { return value; }',
        },
      },
      templates: undefined,
    };
    const typescriptOnly = {
      ...problems[1],
      slug: 'typescript-only',
      id: 'typescript-only',
      languageConfigs: {
        typescript: {
          entryPoint: 'solve',
          template: 'function solve(value: number): number { return value; }',
        },
      },
      templates: undefined,
    };
    const state = createInitialCoachState();
    state.profile = {
      goal: 'foundation',
      preferredLanguage: 'typescript',
      weeklyTarget: 5,
      onboardingCompleted: true,
      onboardedAt: '2026-07-01T00:00:00.000Z',
    };

    const recommendations = getProblemRecommendations(state, {
      catalog: [javascriptOnly, typescriptOnly],
      enabledLanguages: ['javascript'],
    });

    expect(recommendations.map(({ problem }) => problem.slug)).toEqual([
      javascriptOnly.slug,
    ]);
  });

  it('falls back when the preferred language has no compatible revision', () => {
    const javascriptOnly = {
      ...problems[0],
      languageConfigs: {
        javascript: {
          entryPoint: 'solve',
          template: 'function solve(value) { return value; }',
        },
      },
      templates: undefined,
    };
    const state = createInitialCoachState();
    state.profile = {
      goal: 'foundation',
      preferredLanguage: 'typescript',
      weeklyTarget: 5,
      onboardingCompleted: true,
      onboardedAt: '2026-07-01T00:00:00.000Z',
    };

    const recommendations = getProblemRecommendations(state, {
      catalog: [javascriptOnly],
      enabledLanguages: ['typescript', 'javascript'],
    });

    expect(recommendations[0].problem.slug).toBe(javascriptOnly.slug);
  });
});
