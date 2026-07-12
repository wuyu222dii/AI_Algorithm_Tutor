import { z } from 'zod';

import {
  CoachChatRequest,
  CoachProblemContext,
  CoachRequest,
  CodeRunResult,
} from './types';

export const languageSchema = z.enum(['javascript', 'python']);
export const localeSchema = z.enum(['zh', 'en']);
export const difficultySchema = z.enum(['easy', 'medium', 'hard']);
export const topicSchema = z.enum([
  'array-hash',
  'two-pointers',
  'stack',
  'binary-search',
  'linked-list',
  'dynamic-programming',
  'bfs',
  'dfs',
]);

export const testCaseResultSchema = z.object({
  testId: z.string().min(1).max(100),
  passed: z.boolean(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  error: z.string().max(4000).optional(),
  durationMs: z.number().min(0).max(60_000),
});

export const codeRunResultSchema = z.object({
  problemSlug: z.string().min(1).max(120),
  language: languageSchema,
  status: z.enum([
    'passed',
    'failed',
    'syntax_error',
    'runtime_error',
    'timeout',
  ]),
  passedTests: z.number().int().min(0).max(1000),
  totalTests: z.number().int().min(0).max(1000),
  testResults: z.array(testCaseResultSchema).max(100),
  console: z.array(z.string().max(4000)).max(100),
  error: z.string().max(8000).optional(),
  durationMs: z.number().min(0).max(60_000),
  executedAt: z.string().max(80),
});

const localizedStringSchema = z.union([
  z.string(),
  z.object({ zh: z.string(), en: z.string() }),
]);

export const problemContextSchema = z
  .object({
    slug: z.string().max(120).optional(),
    title: localizedStringSchema,
    description: localizedStringSchema,
    difficulty: difficultySchema.optional(),
    topics: z.array(z.string().max(80)).max(8).optional(),
    constraints: z.array(localizedStringSchema).max(20).optional(),
    entryPoint: z.string().max(100).optional(),
  })
  .passthrough();

export const coachRequestSchema = z
  .object({
    action: z.enum([
      'parse',
      'diagnose',
      'hint',
      'counterexample',
      'review_card',
    ]),
    locale: localeSchema.default('zh'),
    problemSlug: z.string().max(120).optional(),
    problemId: z.string().max(120).optional(),
    problem: problemContextSchema.optional(),
    statement: z.string().max(12_000).optional(),
    language: languageSchema.optional(),
    code: z.string().max(30_000).optional(),
    runResult: codeRunResultSchema.optional(),
    hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    experimentVariant: z.enum(['A', 'B']).default('A'),
    model: z.string().max(100).optional(),
  })
  .strip()
  .superRefine((value, context) => {
    if (value.action === 'parse' && !value.statement?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['statement'],
        message: 'statement is required for parse',
      });
    }
    if (value.action === 'diagnose' && !value.runResult) {
      context.addIssue({
        code: 'custom',
        path: ['runResult'],
        message: 'runResult is required for diagnose',
      });
    }
    if (value.action === 'hint' && !value.hintLevel) {
      context.addIssue({
        code: 'custom',
        path: ['hintLevel'],
        message: 'hintLevel is required for hint',
      });
    }
    if (
      value.action !== 'parse' &&
      !value.problemSlug &&
      !value.problemId &&
      !value.problem
    ) {
      context.addIssue({
        code: 'custom',
        path: ['problemSlug'],
        message: 'problemSlug or problem is required',
      });
    }
  });

export const coachChatRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().min(1).max(4000),
        })
      )
      .min(1)
      .max(12),
    locale: localeSchema.default('zh'),
    problemSlug: z.string().max(120).optional(),
    problem: problemContextSchema.optional(),
    language: languageSchema.optional(),
    code: z.string().max(20_000).optional(),
    runResult: codeRunResultSchema.optional(),
    model: z.string().max(100).optional(),
  })
  .strip()
  .superRefine((value, context) => {
    const totalMessageLength = value.messages.reduce(
      (sum, message) => sum + message.content.length,
      0
    );
    if (totalMessageLength > 12_000) {
      context.addIssue({
        code: 'custom',
        path: ['messages'],
        message: 'total message length exceeds 12000 characters',
      });
    }
  });

export type ValidatedCoachRequest = z.infer<typeof coachRequestSchema>;
export type ValidatedCoachChatRequest = z.infer<typeof coachChatRequestSchema>;

function localizedValue(
  value: string | { zh: string; en: string },
  locale: 'zh' | 'en'
): string {
  return typeof value === 'string' ? value : value[locale];
}

function normalizeProblem(
  problem: ValidatedCoachRequest['problem'],
  locale: 'zh' | 'en'
): CoachProblemContext | undefined {
  if (!problem) return undefined;
  return {
    slug: problem.slug,
    title: localizedValue(problem.title, locale),
    description: localizedValue(problem.description, locale),
    difficulty: problem.difficulty,
    topics: problem.topics,
    constraints: problem.constraints?.map((item) =>
      localizedValue(item, locale)
    ),
    entryPoint: problem.entryPoint,
  };
}

export function normalizeCoachRequest(
  value: ValidatedCoachRequest
): CoachRequest {
  const locale = value.locale ?? 'zh';
  return {
    ...value,
    locale,
    problemSlug: value.problemSlug ?? value.problem?.slug ?? value.problemId,
    problem: normalizeProblem(value.problem, locale),
    runResult: value.runResult as CodeRunResult | undefined,
  };
}

export function normalizeCoachChatRequest(
  value: ValidatedCoachChatRequest
): CoachChatRequest {
  const locale = value.locale ?? 'zh';
  return {
    ...value,
    locale,
    problemSlug: value.problemSlug ?? value.problem?.slug,
    problem: normalizeProblem(value.problem, locale),
    runResult: value.runResult as CodeRunResult | undefined,
  };
}
