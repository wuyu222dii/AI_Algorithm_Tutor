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

export const persistedProblemSchema = z
  .object({
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
    sourceStatement: z.string().max(20_000).optional(),
    sourceUrl: z.url().max(2_000).optional(),
  })
  .superRefine((problem, context) => {
    const testIds = new Set<string>();
    problem.tests.forEach((test, index) => {
      if (testIds.has(test.id)) {
        context.addIssue({
          code: 'custom',
          path: ['tests', index, 'id'],
          message: 'test ids must be unique within a problem',
        });
      }
      testIds.add(test.id);
    });
  });

const importedDraftSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^imported-draft(?:-[a-z0-9]+)*$/);

const importedProblemSchema = persistedProblemSchema.safeExtend({
  slug: importedDraftSlugSchema,
});

export const importedDraftRecordSchema = z
  .object({
    problem: importedProblemSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((record, context) => {
    const now = Date.now();
    const createdAt = Date.parse(record.createdAt);
    const updatedAt = Date.parse(record.updatedAt);
    if (updatedAt > now + 24 * 60 * 60 * 1000) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'draft updatedAt is too far in the future',
      });
    }
    if (createdAt > updatedAt + 5 * 60 * 1000) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'draft createdAt cannot be after updatedAt',
      });
    }
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
  dailyMinutes: z.number().int().min(10).max(180).optional().default(30),
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
  sourceStatement: z.string().max(20_000).optional(),
  sourceUrl: z.url().max(2_000).optional(),
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
      verification: z.enum(['observed', 'executed', 'unverified']).optional(),
      sourceTestId: z.string().max(120).optional(),
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
    'visitor_started',
    'onboarding_started',
    'activated',
    'practice_started',
    'first_code_run',
    'first_problem_passed',
    'code_run',
    'code_submitted',
    'hint_revealed',
    'diagnosis_requested',
    'corrected_after_diagnosis',
    'assessment_started',
    'assessment_completed',
    'counterexample_requested',
    'review_card_created',
    'review_completed',
    'guest_data_claimed',
    'sync_succeeded',
    'sync_failed',
    'experiment_exposed',
    'imported_problem_saved',
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

export const reviewItemSchema = z.object({
  problemSlug: z.string().min(1).max(120),
  status: z.enum(['due', 'resolved', 'mastered']),
  source: z.enum(['mistake', 'completion']),
  dueAt: z.iso.datetime(),
  intervalDays: z.number().int().min(1).max(365),
  repetitions: z.number().int().min(0).max(1000),
  easeFactor: z.number().finite().min(1.3).max(3.2),
  updatedAt: z.iso.datetime(),
  lastObservedRunAt: z.iso.datetime().optional(),
  lastFailureAt: z.iso.datetime().optional(),
  lastReviewedAt: z.iso.datetime().optional(),
  lastRating: z.enum(['again', 'hard', 'good', 'easy']).optional(),
});

const reviewItemsSchema = z
  .record(z.string().min(1).max(120), reviewItemSchema)
  .superRefine((items, context) => {
    const entries = Object.entries(items);
    if (entries.length > 500) {
      context.addIssue({
        code: 'too_big',
        origin: 'object',
        maximum: 500,
        inclusive: true,
        path: [],
        message: 'review items must contain at most 500 entries',
      });
    }
    entries.forEach(([slug, item]) => {
      if (item.problemSlug !== slug) {
        context.addIssue({
          code: 'custom',
          path: [slug, 'problemSlug'],
          message: 'review item key must match problemSlug',
        });
      }
    });
  });

export const reviewProgressSchema = z.object({
  version: z.number().int().min(1).max(100),
  items: reviewItemsSchema,
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

export const coachSyncRequestSchema = z
  .object({
    revision: z.number().int().min(0),
    state: persistedCoachStateSchema,
    importedProblem: importedProblemSchema.nullable(),
    importedDrafts: z.array(importedDraftRecordSchema).max(20).optional(),
    reviewProgress: reviewProgressSchema.optional().default({
      version: 1,
      items: {},
    }),
  })
  .superRefine((value, context) => {
    const slugs = new Set<string>();
    const ids = new Set<string>();
    value.importedDrafts?.forEach((record, index) => {
      if (slugs.has(record.problem.slug)) {
        context.addIssue({
          code: 'custom',
          path: ['importedDrafts', index, 'problem', 'slug'],
          message: 'imported draft slugs must be unique',
        });
      }
      slugs.add(record.problem.slug);
      if (ids.has(record.problem.id)) {
        context.addIssue({
          code: 'custom',
          path: ['importedDrafts', index, 'problem', 'id'],
          message: 'imported draft ids must be unique',
        });
      }
      ids.add(record.problem.id);
    });
    if (
      value.importedDrafts &&
      value.importedProblem &&
      !slugs.has(value.importedProblem.slug)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['importedProblem', 'slug'],
        message: 'active imported problem must exist in imported drafts',
      });
    }
    if (value.importedDrafts?.length && !value.importedProblem) {
      context.addIssue({
        code: 'custom',
        path: ['importedProblem'],
        message: 'imported drafts require an active imported problem',
      });
    }
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
        reviewItems: reviewItemsSchema.optional(),
      })
      .strict(),
    importedProblem: importedProblemSchema.nullable().optional(),
    importedDraftUpserts: z.array(importedDraftRecordSchema).max(20).optional(),
    deletedImportedDraftSlugs: z
      .array(importedDraftSlugSchema)
      .max(20)
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      !Object.keys(value.changes).length &&
      !Object.hasOwn(value, 'importedProblem') &&
      !value.importedDraftUpserts?.length &&
      !value.deletedImportedDraftSlugs?.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['changes'],
        message: 'mutation must contain at least one change',
      });
    }
    const upsertSlugs = new Set<string>();
    const upsertIds = new Set<string>();
    value.importedDraftUpserts?.forEach((record, index) => {
      if (upsertSlugs.has(record.problem.slug)) {
        context.addIssue({
          code: 'custom',
          path: ['importedDraftUpserts', index, 'problem', 'slug'],
          message: 'imported draft upsert slugs must be unique',
        });
      }
      upsertSlugs.add(record.problem.slug);
      if (upsertIds.has(record.problem.id)) {
        context.addIssue({
          code: 'custom',
          path: ['importedDraftUpserts', index, 'problem', 'id'],
          message: 'imported draft upsert ids must be unique',
        });
      }
      upsertIds.add(record.problem.id);
    });
    const deletedSlugs = new Set<string>();
    value.deletedImportedDraftSlugs?.forEach((slug, index) => {
      if (deletedSlugs.has(slug)) {
        context.addIssue({
          code: 'custom',
          path: ['deletedImportedDraftSlugs', index],
          message: 'deleted imported draft slugs must be unique',
        });
      }
      if (upsertSlugs.has(slug)) {
        context.addIssue({
          code: 'custom',
          path: ['deletedImportedDraftSlugs', index],
          message: 'a draft cannot be upserted and deleted together',
        });
      }
      deletedSlugs.add(slug);
    });
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
