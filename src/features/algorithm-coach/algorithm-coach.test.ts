import { describe, expect, it } from 'vitest';

import { getProblemBySlug, problems } from './data/problems';
import { runOfflineCoachEval } from './eval';
import { createDemoArtifact } from './fixtures';
import { calculateProductMetrics } from './metrics';
import { DEFAULT_COACH_MODEL, resolveCoachModel } from './model';
import { parseProblemDraft } from './parser';
import { coachRequestSchema, normalizeCoachRequest } from './schemas';
import {
  COACH_STORAGE_VERSION,
  createInitialCoachState,
  deserializeCoachState,
} from './storage';
import { CodeRunResult } from './types';

const failedRun: CodeRunResult = {
  problemSlug: 'dependency-cycle',
  language: 'javascript',
  status: 'failed',
  passedTests: 1,
  totalTests: 2,
  testResults: [
    {
      testId: 'dfs-2',
      passed: false,
      expected: true,
      actual: false,
      durationMs: 1,
    },
  ],
  console: [],
  durationMs: 2,
  executedAt: '2026-01-15T00:00:00.000Z',
};

describe('algorithm coach domain', () => {
  it('falls back to the default model when model configuration is blank', () => {
    const previous = process.env.ALGO_COACH_MODEL;
    process.env.ALGO_COACH_MODEL = '   ';
    try {
      expect(resolveCoachModel()).toBe(DEFAULT_COACH_MODEL);
      expect(resolveCoachModel('')).toBe(DEFAULT_COACH_MODEL);
    } finally {
      if (previous === undefined) delete process.env.ALGO_COACH_MODEL;
      else process.env.ALGO_COACH_MODEL = previous;
    }
  });

  it('ships thirty bilingual problems with verified tests and three hint levels', () => {
    expect(problems).toHaveLength(30);
    for (const problem of problems) {
      expect(problem.title.zh).toBeTruthy();
      expect(problem.title.en).toBeTruthy();
      expect(problem.tests.some((test) => test.isSample)).toBe(true);
      expect(problem.tests.some((test) => !test.isSample)).toBe(true);
      expect(problem.hints.zh).toHaveLength(3);
      expect(problem.hints.en).toHaveLength(3);
    }
  });

  it('parses an imported statement without inventing tests', () => {
    const draft = parseProblemDraft(
      '题目：区间统计\n给定数组并返回区间数量。\n约束：1 <= n <= 1000\n函数名：countRanges',
      'zh'
    );
    expect(draft.entryPoint).toBe('countRanges');
    expect(draft.tests).toEqual([]);
    expect(draft.testCoverage).toBe('none');
    expect(draft.warnings.join(' ')).toContain('不会生成隐藏测试');
  });

  it('grounds demo diagnosis in an observed failed test', () => {
    const artifact = createDemoArtifact({
      action: 'diagnose',
      locale: 'zh',
      problemSlug: 'dependency-cycle',
      runResult: failedRun,
    });
    expect(artifact.diagnosisCategory).toBe('wrong-answer');
    expect(artifact.evidence.join(' ')).toContain('dfs-2');
    expect(artifact.evidence.join(' ')).toContain('期望 true');
  });

  it('returns curated counterexamples that map to a real test', () => {
    const artifact = createDemoArtifact({
      action: 'counterexample',
      locale: 'en',
      problemSlug: 'minimum-processing-rate',
    });
    const counterexample = artifact.counterexample;
    expect(counterexample?.input.length).toBeGreaterThan(0);
    expect(counterexample?.expected).toBeDefined();
    const problem = getProblemBySlug('minimum-processing-rate');
    expect(
      problem?.tests.some(
        (test) =>
          JSON.stringify(test.args) === JSON.stringify(counterexample?.input) &&
          test.expected === counterexample?.expected
      )
    ).toBe(true);
  });

  it('migrates legacy local state and restores compatibility views', () => {
    const migrated = deserializeCoachState(
      JSON.stringify({
        version: 1,
        learningProfile: {
          goal: 'interview',
          preferredLanguage: 'python',
          weeklyTarget: 4,
          onboardedAt: '2026-01-01T00:00:00.000Z',
        },
        practiceSessions: [
          {
            problemSlug: 'dependency-cycle',
            code: { python: 'def has_dependency_cycle(): pass' },
            runs: [failedRun],
            hintLevel: 1,
            diagnosisCount: 0,
            correctedAfterDiagnosis: false,
            startedAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    );
    expect(migrated.version).toBe(COACH_STORAGE_VERSION);
    expect(migrated.profile?.preferredLanguage).toBe('python');
    expect(migrated.code['dependency-cycle']?.python).toContain('def');
    expect(migrated.runs).toHaveLength(1);
  });

  it('calculates completion, hint, correction, and topic metrics', () => {
    const state = createInitialCoachState();
    state.profile = {
      goal: 'interview',
      preferredLanguage: 'javascript',
      weeklyTarget: 5,
      onboardedAt: '2026-01-01T00:00:00.000Z',
    };
    state.sessions['dependency-cycle'] = {
      problemSlug: 'dependency-cycle',
      code: {},
      runs: [{ ...failedRun, status: 'passed', passedTests: 2 }],
      hintLevel: 1,
      diagnosisCount: 1,
      correctedAfterDiagnosis: true,
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    const metrics = calculateProductMetrics(state);
    expect(metrics.activated).toBe(true);
    expect(metrics.practiceCompletionRate).toBe(1);
    expect(metrics.hintUsageRate).toBe(1);
    expect(metrics.correctionEffectiveness).toBe(1);
    expect(metrics.topicMastery.dfs).toBeGreaterThan(0);
  });

  it('accepts and normalizes the full problem object sent by the UI', () => {
    const problem = getProblemBySlug('dependency-cycle');
    const parsed = coachRequestSchema.safeParse({
      action: 'hint',
      locale: 'zh',
      problem,
      problemId: problem?.id,
      language: 'javascript',
      code: 'function hasDependencyCycle() {}',
      hintLevel: 1,
      experimentVariant: 'A',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const normalized = normalizeCoachRequest(parsed.data);
    expect(normalized.problemSlug).toBe('dependency-cycle');
    expect(normalized.problem?.title).toBe('依赖关系是否成环');
  });

  it('passes bilingual deterministic safety and quality evaluations', () => {
    const summary = runOfflineCoachEval();
    expect(summary.sampleCount).toBe(26);
    expect(summary.failures).toEqual([]);
    expect(summary.structuredOutputRate).toBe(1);
    expect(summary.diagnosisAccuracy).toBe(1);
    expect(summary.hintLeakageRate).toBe(0);
    expect(summary.counterexampleExecutableRate).toBe(1);
    expect(summary.parseNoHiddenTestsRate).toBe(1);
    expect(summary.promptInjectionPassRate).toBe(1);
    expect(summary.answerLeakageRate).toBe(0);
  });
});
