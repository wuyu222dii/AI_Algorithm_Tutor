import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProblemBySlug, problems } from './data/problems';
import { runOfflineCoachEval } from './eval';
import { createDemoArtifact } from './fixtures';
import { calculateProductMetrics } from './metrics';
import {
  classifyCoachProviderError,
  COACH_MODEL_WHITELIST,
  DEFAULT_COACH_MODEL,
  estimateCoachCostUsd,
  isCoachModelCircuitOpen,
  isCoachProviderAccessFailure,
  recordCoachModelFailure,
  recordCoachModelSuccess,
  resetCoachModelCircuits,
  resolveCoachModel,
  resolveCoachModelRoute,
} from './model';
import { parseProblemDraft } from './parser';
import { coachRequestSchema, normalizeCoachRequest } from './schemas';
import {
  clearCoachState,
  COACH_STORAGE_KEY,
  COACH_STORAGE_VERSION,
  createCoachStorageScope,
  createInitialCoachState,
  getScopedStorageKey,
  loadCoachState,
} from './storage';
import { getPracticeSessionKey } from './sync';
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

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

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

  it('accepts only explicit model identifiers from the coach whitelist', () => {
    for (const model of COACH_MODEL_WHITELIST) {
      expect(resolveCoachModel(model)).toBe(model);
    }
    expect(() => resolveCoachModel('gpt-5.5-unavailable')).toThrow(
      'is not allowed'
    );
  });

  it('routes models by action and classifies only transient failures for failover', () => {
    const previous = process.env.ALGO_COACH_HINT_MODEL;
    process.env.ALGO_COACH_HINT_MODEL = 'openai/gpt-5.5';
    try {
      expect(resolveCoachModelRoute('hint')).toMatchObject({
        primary: 'openai/gpt-5.5',
      });
    } finally {
      if (previous === undefined) delete process.env.ALGO_COACH_HINT_MODEL;
      else process.env.ALGO_COACH_HINT_MODEL = previous;
    }
    expect(
      classifyCoachProviderError(new Error('No available channel for model'))
    ).toBe('unavailable');
    expect(classifyCoachProviderError({ statusCode: 429 })).toBe(
      'rate_limited'
    );
    expect(classifyCoachProviderError({ status: 503 })).toBe('unavailable');
    expect(classifyCoachProviderError(new Error('request timed out'))).toBe(
      'timeout'
    );
    expect(
      classifyCoachProviderError(new Error('schema validation failed'))
    ).toBe('invalid_output');
  });

  it('detects terminal provider credential and model access failures', () => {
    expect(isCoachProviderAccessFailure({ statusCode: 401 })).toBe(true);
    expect(isCoachProviderAccessFailure({ cause: { status: 403 } })).toBe(true);
    expect(
      isCoachProviderAccessFailure(new Error('无权访问 gpt-5.5 分组'))
    ).toBe(true);
    expect(
      isCoachProviderAccessFailure(new Error('No available channel for model'))
    ).toBe(false);
  });

  it('opens and resets a model circuit after repeated transient failures', () => {
    resetCoachModelCircuits();
    const model = DEFAULT_COACH_MODEL;
    recordCoachModelFailure(model, 'unavailable', 1000);
    recordCoachModelFailure(model, 'unavailable', 1000);
    expect(isCoachModelCircuitOpen(model, 1000)).toBe(false);
    recordCoachModelFailure(model, 'unavailable', 1000);
    expect(isCoachModelCircuitOpen(model, 1000)).toBe(true);
    recordCoachModelSuccess(model);
    expect(isCoachModelCircuitOpen(model, 1000)).toBe(false);
  });

  it('calculates a bounded token cost estimate', () => {
    vi.stubEnv('COACH_INPUT_COST_PER_MILLION_USD', '');
    vi.stubEnv('COACH_OUTPUT_COST_PER_MILLION_USD', '');
    expect(
      estimateCoachCostUsd({
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
      })
    ).toBe(0.007);
  });

  it('prices primary and fallback models independently', () => {
    vi.stubEnv('COACH_INPUT_COST_PER_MILLION_USD', '');
    vi.stubEnv('COACH_OUTPUT_COST_PER_MILLION_USD', '');
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
    };

    expect(estimateCoachCostUsd(usage, 'google/gemini-2.5-flash')).toBe(12);
    expect(estimateCoachCostUsd(usage, 'openai/gpt-5.5')).toBe(90);
    expect(estimateCoachCostUsd(usage, 'anthropic/claude-4.5-sonnet')).toBe(30);

    vi.stubEnv('COACH_GPT_5_5_INPUT_COST_PER_MILLION_USD', '3');
    vi.stubEnv('COACH_GPT_5_5_OUTPUT_COST_PER_MILLION_USD', '7');
    expect(estimateCoachCostUsd(usage, 'openai/gpt-5.5')).toBe(10);
  });

  it('ships thirty-eight bilingual problems with verified tests and three hint levels', () => {
    expect(problems).toHaveLength(38);
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
    const artifact = createDemoArtifact(
      {
        action: 'diagnose',
        locale: 'zh',
        problemSlug: 'dependency-cycle',
        runResult: failedRun,
      },
      getProblemBySlug('dependency-cycle')
    );
    expect(artifact.diagnosisCategory).toBe('wrong-answer');
    expect(artifact.evidence.join(' ')).toContain('dfs-2');
    expect(artifact.evidence.join(' ')).toContain('期望 true');
  });

  it('returns curated counterexamples that map to a real test', () => {
    const artifact = createDemoArtifact(
      {
        action: 'counterexample',
        locale: 'en',
        problemSlug: 'minimum-processing-rate',
      },
      getProblemBySlug('minimum-processing-rate')
    );
    const counterexample = artifact.counterexample;
    expect(counterexample?.input.length).toBeGreaterThan(0);
    expect(counterexample?.expected).toBeDefined();
    expect(counterexample?.verification).toBe('unverified');
    expect(counterexample?.sourceTestId).toBeTruthy();
    const problem = getProblemBySlug('minimum-processing-rate');
    expect(
      problem?.tests.some(
        (test) =>
          JSON.stringify(test.args) === JSON.stringify(counterexample?.input) &&
          test.expected === counterexample?.expected
      )
    ).toBe(true);
  });

  it('marks a counterexample as observed only when it matches a real failed test', () => {
    const artifact = createDemoArtifact(
      {
        action: 'counterexample',
        locale: 'zh',
        problemSlug: 'dependency-cycle',
        runResult: failedRun,
      },
      getProblemBySlug('dependency-cycle')
    );

    expect(artifact.counterexample).toMatchObject({
      verification: 'observed',
      sourceTestId: 'dfs-2',
      expected: true,
      actual: false,
    });
    expect(artifact.evidence.join(' ')).toContain('dfs-2');
  });

  it('migrates v2 JavaScript and Python state without losing practice data', () => {
    window.localStorage.setItem(
      'algocoach:state:v2',
      JSON.stringify({
        version: 2,
        learningProfile: {
          goal: 'interview',
          preferredLanguage: 'python',
          weeklyTarget: 4,
          onboardedAt: '2026-01-01T00:00:00.000Z',
        },
        practiceSessions: [
          {
            problemSlug: 'dependency-cycle',
            code: {
              javascript: 'function hasDependencyCycle() {}',
              python: 'def has_dependency_cycle(): pass',
            },
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
    const migrated = loadCoachState(window.localStorage);
    expect(migrated.version).toBe(COACH_STORAGE_VERSION);
    expect(migrated.profile?.preferredLanguage).toBe('python');
    expect(migrated.code['dependency-cycle']?.python).toContain('def');
    expect(migrated.code['dependency-cycle']?.javascript).toContain('function');
    expect(migrated.runs).toHaveLength(1);
    expect(migrated.sessions['dependency-cycle']).toMatchObject({
      problemContentVersion: 1,
    });
    expect(migrated.runs[0]).toMatchObject({
      problemContentVersion: 1,
      runnerMode: 'browser-worker',
    });
    expect(window.localStorage.getItem(COACH_STORAGE_KEY)).not.toBeNull();
    window.localStorage.clear();
  });

  it('migrates and clears scoped legacy state keys for signed-in users', () => {
    const scope = createCoachStorageScope('legacy-account');
    const v2Key = getScopedStorageKey('algocoach:state:v2', scope);
    const v1Key = getScopedStorageKey('algocoach:state:v1', scope);
    window.localStorage.setItem(
      v2Key,
      JSON.stringify({
        version: 2,
        profile: {
          goal: 'interview',
          preferredLanguage: 'javascript',
          weeklyTarget: 3,
          onboardedAt: '2026-01-01T00:00:00.000Z',
        },
      })
    );
    window.localStorage.setItem(v1Key, JSON.stringify({ version: 1 }));

    expect(loadCoachState(window.localStorage, scope).profile?.goal).toBe(
      'interview'
    );
    expect(
      window.localStorage.getItem(getScopedStorageKey(COACH_STORAGE_KEY, scope))
    ).not.toBeNull();
    expect(window.localStorage.getItem(v2Key)).toBeNull();
    expect(window.localStorage.getItem(v1Key)).toBeNull();

    window.localStorage.setItem(v2Key, JSON.stringify({ version: 2 }));
    window.localStorage.setItem(v1Key, JSON.stringify({ version: 1 }));
    clearCoachState(window.localStorage, scope);
    expect(
      window.localStorage.getItem(getScopedStorageKey(COACH_STORAGE_KEY, scope))
    ).toBeNull();
    expect(window.localStorage.getItem(v2Key)).toBeNull();
    expect(window.localStorage.getItem(v1Key)).toBeNull();
  });

  it('normalizes a versioned session and code to the stable composite key', () => {
    const sessionKey = getPracticeSessionKey('dependency-cycle', 2);
    window.localStorage.setItem(
      COACH_STORAGE_KEY,
      JSON.stringify({
        version: COACH_STORAGE_VERSION,
        sessions: {
          'dependency-cycle': {
            problemSlug: 'dependency-cycle',
            problemContentVersion: 2,
            code: { javascript: 'version-two-session-code' },
            runs: [{ ...failedRun, problemContentVersion: 2 }],
            hintLevel: 2,
            diagnosisCount: 1,
            correctedAfterDiagnosis: false,
            startedAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        },
        code: { 'dependency-cycle': { javascript: 'version-two-flat-code' } },
      })
    );

    const migrated = loadCoachState(window.localStorage);
    expect(migrated.sessions['dependency-cycle']).toBeUndefined();
    expect(migrated.sessions[sessionKey]).toMatchObject({
      problemSlug: 'dependency-cycle',
      problemContentVersion: 2,
      hintLevel: 2,
      code: { javascript: 'version-two-flat-code' },
    });
    expect(migrated.sessions[sessionKey].runs).toEqual([
      expect.objectContaining({ problemContentVersion: 2 }),
    ]);
    expect(migrated.code[sessionKey]?.javascript).toBe('version-two-flat-code');
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
    const metrics = calculateProductMetrics(state, {}, { catalog: problems });
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
    expect(summary.sampleCount).toBe(100);
    expect(summary.failures).toEqual([]);
    expect(summary.structuredOutputRate).toBe(1);
    expect(summary.diagnosisAccuracy).toBe(1);
    expect(summary.hintLeakageRate).toBe(0);
    expect(summary.counterexampleExecutableRate).toBe(1);
    expect(summary.parseNoHiddenTestsRate).toBe(1);
    expect(summary.reviewGradeStructuredRate).toBe(1);
    expect(summary.reviewGradeRatingAccuracy).toBe(1);
    expect(summary.promptInjectionPassRate).toBe(1);
    expect(summary.answerLeakageRate).toBe(0);
  });
});
