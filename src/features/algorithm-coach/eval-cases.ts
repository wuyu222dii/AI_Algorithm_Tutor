import { CoachRequest, DiagnosisCategory } from './types';

export interface CoachEvalCase {
  id: string;
  request: CoachRequest;
  expected: {
    diagnosisCategory?: DiagnosisCategory;
    hintLevel?: 1 | 2 | 3;
    noHiddenTests?: boolean;
    counterexampleRequired?: boolean;
    reviewCardRequired?: boolean;
  };
}

const run = (
  problemSlug: string,
  status: 'failed' | 'syntax_error' | 'runtime_error' | 'timeout',
  options: {
    error?: string;
    testId?: string;
    expected?: unknown;
    actual?: unknown;
  } = {}
) => ({
  problemSlug,
  language: 'javascript' as const,
  status,
  passedTests: status === 'failed' ? 2 : 0,
  totalTests: status === 'failed' ? 4 : 0,
  testResults: options.testId
    ? [
        {
          testId: options.testId,
          passed: false,
          expected: options.expected as never,
          actual: options.actual as never,
          durationMs: 1,
        },
      ]
    : [],
  console: [],
  error: options.error,
  durationMs: status === 'timeout' ? 3000 : 5,
  executedAt: '2026-01-15T00:00:00.000Z',
});

export const coachEvalCases: CoachEvalCase[] = [
  {
    id: 'diagnose-syntax',
    request: {
      action: 'diagnose',
      locale: 'zh',
      problemSlug: 'first-unique-position',
      runResult: run('first-unique-position', 'syntax_error', {
        error: 'SyntaxError: Unexpected token } at line 4',
      }),
    },
    expected: { diagnosisCategory: 'syntax' },
  },
  {
    id: 'diagnose-runtime',
    request: {
      action: 'diagnose',
      locale: 'en',
      problemSlug: 'sorted-pair-target',
      runResult: run('sorted-pair-target', 'runtime_error', {
        error: 'TypeError: Cannot read properties of undefined',
      }),
    },
    expected: { diagnosisCategory: 'runtime' },
  },
  {
    id: 'diagnose-timeout',
    request: {
      action: 'diagnose',
      locale: 'zh',
      problemSlug: 'minimum-processing-rate',
      runResult: run('minimum-processing-rate', 'timeout', {
        error: 'Execution exceeded 3000ms',
      }),
    },
    expected: { diagnosisCategory: 'timeout' },
  },
  {
    id: 'diagnose-wrong-answer',
    request: {
      action: 'diagnose',
      locale: 'en',
      problemSlug: 'dependency-cycle',
      runResult: run('dependency-cycle', 'failed', {
        testId: 'dfs-2',
        expected: true,
        actual: false,
      }),
    },
    expected: { diagnosisCategory: 'wrong-answer' },
  },
  {
    id: 'diagnose-edge-case',
    request: {
      action: 'diagnose',
      locale: 'zh',
      problemSlug: 'remove-linked-node-from-end',
      runResult: run('remove-linked-node-from-end', 'failed', {
        testId: 'll-2',
        expected: [],
        actual: [4],
      }),
    },
    expected: { diagnosisCategory: 'edge-case' },
  },
  {
    id: 'hint-array-level-1',
    request: {
      action: 'hint',
      locale: 'zh',
      problemSlug: 'first-unique-position',
      hintLevel: 1,
    },
    expected: { hintLevel: 1 },
  },
  {
    id: 'hint-array-level-2',
    request: {
      action: 'hint',
      locale: 'zh',
      problemSlug: 'first-unique-position',
      hintLevel: 2,
    },
    expected: { hintLevel: 2 },
  },
  {
    id: 'hint-array-level-3',
    request: {
      action: 'hint',
      locale: 'zh',
      problemSlug: 'first-unique-position',
      hintLevel: 3,
    },
    expected: { hintLevel: 3 },
  },
  {
    id: 'hint-bfs-level-1',
    request: {
      action: 'hint',
      locale: 'en',
      problemSlug: 'shortest-grid-exit',
      hintLevel: 1,
    },
    expected: { hintLevel: 1 },
  },
  {
    id: 'hint-bfs-level-2',
    request: {
      action: 'hint',
      locale: 'en',
      problemSlug: 'shortest-grid-exit',
      hintLevel: 2,
    },
    expected: { hintLevel: 2 },
  },
  {
    id: 'hint-bfs-level-3',
    request: {
      action: 'hint',
      locale: 'en',
      problemSlug: 'shortest-grid-exit',
      hintLevel: 3,
    },
    expected: { hintLevel: 3 },
  },
  {
    id: 'counterexample-two-pointers',
    request: {
      action: 'counterexample',
      locale: 'zh',
      problemSlug: 'sorted-pair-target',
    },
    expected: { counterexampleRequired: true },
  },
  {
    id: 'counterexample-binary-search',
    request: {
      action: 'counterexample',
      locale: 'en',
      problemSlug: 'minimum-processing-rate',
    },
    expected: { counterexampleRequired: true },
  },
  {
    id: 'counterexample-observed',
    request: {
      action: 'counterexample',
      locale: 'zh',
      problemSlug: 'dependency-cycle',
      runResult: run('dependency-cycle', 'failed', {
        testId: 'dfs-2',
        expected: true,
        actual: false,
      }),
    },
    expected: { counterexampleRequired: true },
  },
  {
    id: 'review-dp',
    request: {
      action: 'review_card',
      locale: 'zh',
      problemSlug: 'minimum-energy-path',
    },
    expected: { reviewCardRequired: true },
  },
  {
    id: 'review-stack',
    request: {
      action: 'review_card',
      locale: 'en',
      problemSlug: 'maximum-bracket-depth',
    },
    expected: { reviewCardRequired: true },
  },
  {
    id: 'review-dfs',
    request: {
      action: 'review_card',
      locale: 'zh',
      problemSlug: 'dependency-cycle',
    },
    expected: { reviewCardRequired: true },
  },
  {
    id: 'parse-chinese',
    request: {
      action: 'parse',
      locale: 'zh',
      statement:
        '题目：区间计数\n给定整数数组，返回满足条件的区间数量。\n约束：1 <= n <= 100000\n函数名：countRanges',
    },
    expected: { noHiddenTests: true },
  },
  {
    id: 'parse-english',
    request: {
      action: 'parse',
      locale: 'en',
      statement:
        'Problem: Balanced groups\nGiven a list of values, return the group count.\nConstraints: 0 <= values.length <= 5000\nfunction countGroups(values)',
    },
    expected: { noHiddenTests: true },
  },
  {
    id: 'parse-no-constraints',
    request: {
      action: 'parse',
      locale: 'zh',
      statement:
        '合并相邻片段\n输入若干片段，合并可以连接的相邻片段并返回结果。',
    },
    expected: { noHiddenTests: true },
  },
];
