import { z } from 'zod';

import { COACH_STORAGE_VERSION } from './storage';
import { JsonValue } from './types';

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

const localizedTextSchema = z.object({
  zh: z.string().max(20_000),
  en: z.string().max(20_000),
});

const testCaseSchema = z.object({
  id: z.string().min(1).max(120),
  args: z.array(jsonValueSchema).max(30),
  expected: jsonValueSchema,
  isSample: z.boolean(),
  label: localizedTextSchema.optional(),
});

const problemExampleSchema = z.object({
  id: z.string().min(1).max(120),
  input: jsonValueSchema,
  expected: jsonValueSchema,
  output: jsonValueSchema.optional(),
  explanation: localizedTextSchema.optional(),
});

export const persistedProblemSchema = z.object({
  id: z.string().min(1).max(160),
  slug: z.string().min(1).max(120),
  title: localizedTextSchema,
  description: localizedTextSchema,
  difficulty: z.enum(['easy', 'medium', 'hard']),
  topics: z.array(z.string().min(1).max(80)).max(12),
  entryPoint: z.string().min(1).max(100),
  templates: z.object({
    javascript: z.string().max(30_000),
    python: z.string().max(30_000),
  }),
  tests: z.array(testCaseSchema).max(100),
  examples: z.array(problemExampleSchema).max(20),
  constraints: z.array(localizedTextSchema).max(30),
  hints: z.object({
    zh: z.tuple([z.string(), z.string(), z.string()]),
    en: z.tuple([z.string(), z.string(), z.string()]),
  }),
  reviewPoints: z.array(localizedTextSchema).max(20),
  estimatedMinutes: z.number().int().min(1).max(180),
});

const testCaseResultSchema = z.object({
  testId: z.string().min(1).max(120),
  passed: z.boolean(),
  expected: jsonValueSchema.optional(),
  actual: jsonValueSchema.optional(),
  error: z.string().max(10_000).optional(),
  durationMs: z.number().finite().min(0).max(60_000),
});

const codeRunSchema = z.object({
  id: z.string().max(160).optional(),
  problemSlug: z.string().min(1).max(120),
  language: z.enum(['javascript', 'python']),
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
  console: z.array(z.string().max(10_000)).max(200),
  error: z.string().max(20_000).optional(),
  durationMs: z.number().finite().min(0).max(60_000),
  executedAt: z.iso.datetime(),
  codeSnapshot: z.string().max(30_000).optional(),
  testScope: z.enum(['sample', 'full', 'unknown']).optional(),
  submitted: z.boolean().optional(),
});

const practiceSessionSchema = z.object({
  problemSlug: z.string().min(1).max(120),
  code: z.object({
    javascript: z.string().max(30_000).optional(),
    python: z.string().max(30_000).optional(),
  }),
  runs: z.array(codeRunSchema).max(30),
  hintLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  diagnosisCount: z.number().int().min(0).max(10_000),
  correctedAfterDiagnosis: z.boolean(),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
});

const learningProfileSchema = z.object({
  goal: z.enum(['foundation', 'interview', 'contest']),
  preferredLanguage: z.enum(['javascript', 'python']),
  weeklyTarget: z.number().int().min(1).max(14),
  weeklyGoal: z.number().int().min(1).max(14).optional(),
  onboardingCompleted: z.boolean().optional(),
  createdAt: z.iso.datetime().optional(),
  onboardedAt: z.iso.datetime(),
});

const parsedDraftSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(20_000),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  constraints: z.array(z.string().max(1000)).max(30),
  entryPoint: z.string().max(100),
  templates: z.object({
    javascript: z.string().max(30_000),
    python: z.string().max(30_000),
  }),
  tests: z.array(testCaseSchema).max(100),
  testCoverage: z.literal('none'),
  warnings: z.array(z.string().max(1000)).max(20),
  source: z.literal('imported'),
});

const artifactSchema = z.object({
  id: z.string().min(1).max(160),
  type: z.enum(['parse', 'diagnose', 'hint', 'counterexample', 'review_card']),
  locale: z.enum(['zh', 'en']),
  problemSlug: z.string().max(120).optional(),
  runId: z.string().max(240).optional(),
  title: z.string().max(300),
  summary: z.string().max(4000),
  details: z.array(z.string().max(4000)).max(20),
  evidence: z.array(z.string().max(4000)).max(20),
  nextAction: z.string().max(2000).optional(),
  diagnosisCategory: z
    .enum([
      'syntax',
      'runtime',
      'timeout',
      'wrong-answer',
      'edge-case',
      'unknown',
    ])
    .optional(),
  hint: z
    .object({
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      principle: z.string().max(4000),
      direction: z.string().max(4000).optional(),
      pseudocode: z.string().max(8000).optional(),
    })
    .optional(),
  counterexample: z
    .object({
      input: z.array(jsonValueSchema).max(30),
      expected: jsonValueSchema.optional(),
      actual: jsonValueSchema.optional(),
      explanation: z.string().max(4000),
    })
    .optional(),
  reviewCard: z
    .object({
      front: z.string().max(2000),
      back: z.string().max(8000),
      tags: z.array(z.string().max(100)).max(20),
    })
    .optional(),
  draft: parsedDraftSchema.optional(),
  generationMode: z.enum(['live', 'local']).optional(),
  model: z.string().max(160).optional(),
  promptVersion: z.string().max(100).optional(),
  traceId: z.string().max(160).optional(),
  latencyMs: z.number().int().min(0).max(300_000).optional(),
  createdAt: z.iso.datetime(),
});

const productEventSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.enum([
    'activated',
    'practice_started',
    'code_run',
    'code_submitted',
    'hint_revealed',
    'diagnosis_requested',
    'corrected_after_diagnosis',
    'assessment_started',
    'assessment_completed',
    'counterexample_requested',
    'review_card_created',
    'coach_chat_message',
    'csat_submitted',
  ]),
  timestamp: z.iso.datetime(),
  sessionId: z.string().min(1).max(160),
  problemSlug: z.string().max(120).optional(),
  properties: z.record(z.string(), jsonValueSchema).optional(),
});

const assessmentResultSchema = z.object({
  id: z.string().min(1).max(160),
  version: z.string().max(100).optional(),
  verificationToken: z.string().max(4096).optional(),
  problemSlugs: z.array(z.string().max(120)).max(20),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  score: z.number().int().min(0).max(100),
  correctCount: z.number().int().min(0).max(100),
  totalCount: z.number().int().min(0).max(100),
  weakTopics: z
    .array(
      z.enum([
        'array-hash',
        'two-pointers',
        'stack',
        'binary-search',
        'linked-list',
        'dynamic-programming',
        'bfs',
        'dfs',
      ])
    )
    .max(20),
  recommendation: z.string().max(4000),
});

const activeAssessmentSchema = z.object({
  id: z.string().min(1).max(160),
  problemSlugs: z.array(z.string().max(120)).max(20),
  startedAt: z.iso.datetime(),
  durationMinutes: z.number().int().min(1).max(180),
});

export const persistedCoachStateSchema = z.object({
  version: z.number().int().default(COACH_STORAGE_VERSION),
  profile: learningProfileSchema.nullable(),
  sessions: z.record(z.string(), practiceSessionSchema),
  artifacts: z.array(artifactSchema).max(100),
  events: z.array(productEventSchema).max(300),
  activeAssessment: activeAssessmentSchema.nullable(),
  assessments: z.array(assessmentResultSchema).max(20),
  code: z.record(
    z.string(),
    z.object({
      javascript: z.string().max(30_000).optional(),
      python: z.string().max(30_000).optional(),
    })
  ),
  runs: z.array(codeRunSchema).max(200),
  completedProblemIds: z.array(z.string().max(160)).max(500),
});

export const coachSyncRequestSchema = z.object({
  revision: z.number().int().min(0),
  state: persistedCoachStateSchema,
  importedProblem: persistedProblemSchema.nullable(),
});

export const coachSyncMutationSchema = z
  .object({
    id: z.string().min(1).max(160),
    baseRevision: z.number().int().min(0),
    createdAt: z.iso.datetime(),
    changes: z
      .object({
        profile: learningProfileSchema.nullable().optional(),
        sessions: z
          .record(z.string().min(1).max(120), practiceSessionSchema)
          .optional(),
        artifacts: z.array(artifactSchema).max(100).optional(),
        events: z.array(productEventSchema).max(300).optional(),
        activeAssessment: activeAssessmentSchema.nullable().optional(),
        assessments: z.array(assessmentResultSchema).max(20).optional(),
        code: z
          .record(
            z.string().min(1).max(120),
            z.object({
              javascript: z.string().max(30_000).optional(),
              python: z.string().max(30_000).optional(),
            })
          )
          .optional(),
        runs: z.array(codeRunSchema).max(200).optional(),
        completedProblemIds: z
          .array(z.string().min(1).max(160))
          .max(500)
          .optional(),
      })
      .strict(),
    importedProblem: persistedProblemSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      !Object.keys(value.changes).length &&
      !Object.hasOwn(value, 'importedProblem')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['changes'],
        message: 'mutation must contain at least one change',
      });
    }
  });

export const coachMutationSyncRequestSchema = z
  .object({
    revision: z.number().int().min(0),
    mutations: z.array(coachSyncMutationSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.mutations.forEach((mutation, index) => {
      if (ids.has(mutation.id)) {
        context.addIssue({
          code: 'custom',
          path: ['mutations', index, 'id'],
          message: 'mutation ids must be unique within a request',
        });
      }
      if (mutation.baseRevision > value.revision) {
        context.addIssue({
          code: 'custom',
          path: ['mutations', index, 'baseRevision'],
          message: 'mutation baseRevision cannot exceed request revision',
        });
      }
      ids.add(mutation.id);
    });
  });
