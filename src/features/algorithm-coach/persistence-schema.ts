import { z } from 'zod';

import { ENABLED_LANGUAGE_IDS } from './languages';
import { REVIEW_PROGRESS_VERSION } from './learning-progress';
import { COACH_STORAGE_VERSION } from './storage';
import type { JsonValue, TypeSpec } from './types';

const languageSchema = z.enum(ENABLED_LANGUAGE_IDS);

const languageCodeSchema = z.object({
  javascript: z.string().max(30_000).optional(),
  typescript: z.string().max(30_000).optional(),
  python: z.string().max(30_000).optional(),
});

const problemTemplatesSchema = z.object({
  javascript: z.string().max(30_000),
  typescript: z.string().max(30_000).optional(),
  python: z.string().max(30_000),
});

const typeSpecSchema: z.ZodType<TypeSpec> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('unknown') }),
    z.object({ kind: z.literal('integer') }),
    z.object({ kind: z.literal('number') }),
    z.object({ kind: z.literal('string') }),
    z.object({ kind: z.literal('boolean') }),
    z.object({ kind: z.literal('null') }),
    z.object({ kind: z.literal('array'), items: typeSpecSchema }),
    z.object({
      kind: z.literal('tuple'),
      items: z.array(typeSpecSchema).max(30),
    }),
    z.object({
      kind: z.literal('object'),
      fields: z.record(z.string().max(100), typeSpecSchema),
      additionalProperties: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('union'),
      options: z.array(typeSpecSchema).min(1).max(10),
    }),
  ])
);

const functionSignatureSchema = z.object({
  parameters: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        type: typeSpecSchema,
      })
    )
    .max(30),
  returns: typeSpecSchema,
});

const problemLanguageConfigSchema = z.object({
  entryPoint: z.string().min(1).max(100),
  template: z.string().max(30_000),
  signature: functionSignatureSchema.optional(),
  runtimeVersion: z.string().max(100).optional(),
});

const languageConfigsSchema = z.object({
  javascript: problemLanguageConfigSchema.optional(),
  typescript: problemLanguageConfigSchema.optional(),
  python: problemLanguageConfigSchema.optional(),
  cpp: problemLanguageConfigSchema.optional(),
  java: problemLanguageConfigSchema.optional(),
  go: problemLanguageConfigSchema.optional(),
  rust: problemLanguageConfigSchema.optional(),
});

const problemVersionSchema = z.object({
  contentVersion: z.number().int().min(1),
  catalogVersion: z.string().max(100).optional(),
  sourceRevision: z.string().max(200).optional(),
  runtimeVersions: z
    .object({
      javascript: z.string().max(100).optional(),
      typescript: z.string().max(100).optional(),
      python: z.string().max(100).optional(),
      cpp: z.string().max(100).optional(),
      java: z.string().max(100).optional(),
      go: z.string().max(100).optional(),
      rust: z.string().max(100).optional(),
    })
    .optional(),
});

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
    entryPoint: z.string().min(1).max(100).optional(),
    templates: problemTemplatesSchema.optional(),
    languageConfigs: languageConfigsSchema.optional(),
    signature: functionSignatureSchema.optional(),
    version: problemVersionSchema.optional(),
    tests: z.array(testCaseSchema).max(100),
    examples: z.array(problemExampleSchema).max(20),
    constraints: z.array(localizedTextSchema).max(30),
    hints: z.object({
      zh: z.tuple([z.string(), z.string(), z.string()]),
      en: z.tuple([z.string(), z.string(), z.string()]),
    }),
    reviewPoints: z.array(localizedTextSchema).max(20),
    learningObjectives: z.array(localizedTextSchema).max(20).optional(),
    prerequisiteTopics: z
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
      .max(12)
      .optional(),
    solutionPatterns: z.array(z.string().min(1).max(160)).max(20).optional(),
    estimatedMinutes: z.number().int().min(1).max(180),
    sourceStatement: z.string().max(20_000).optional(),
    sourceUrl: z.url().max(2_000).optional(),
  })
  .superRefine((problem, context) => {
    if (
      !Object.values(problem.languageConfigs ?? {}).some(Boolean) &&
      !(problem.entryPoint && problem.templates)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['languageConfigs'],
        message:
          'at least one language config or a complete legacy template is required',
      });
    }
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
  console: z.array(z.string().max(10_000)).max(200),
  error: z.string().max(20_000).optional(),
  durationMs: z.number().finite().min(0).max(60_000),
  executedAt: z.iso.datetime(),
  codeSnapshot: z.string().max(30_000).optional(),
  testScope: z.enum(['sample', 'full', 'unknown']).optional(),
  submitted: z.boolean().optional(),
  problemContentVersion: z.number().int().min(1).optional().default(1),
  runtimeVersion: z.string().max(100).optional(),
  runnerMode: z.enum(['browser-worker', 'remote-judge']).optional(),
});

const practiceSessionSchema = z.object({
  problemSlug: z.string().min(1).max(120),
  problemContentVersion: z.number().int().min(1).optional().default(1),
  code: languageCodeSchema,
  runs: z.array(codeRunSchema).max(30),
  hintLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  diagnosisCount: z.number().int().min(0).max(10_000),
  correctedAfterDiagnosis: z.boolean(),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
});

const ianaTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA time zone');

const learningProfileSchema = z.object({
  goal: z.enum(['foundation', 'interview', 'contest']),
  preferredLanguage: languageSchema,
  weeklyTarget: z.number().int().min(1).max(14),
  dailyMinutes: z.number().int().min(10).max(180).optional().default(30),
  weeklyGoal: z.number().int().min(1).max(14).optional(),
  onboardingCompleted: z.boolean().optional(),
  createdAt: z.iso.datetime().optional(),
  onboardedAt: z.iso.datetime(),
  timeZone: ianaTimeZoneSchema.optional().default('UTC'),
});

const parsedDraftSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(20_000),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  constraints: z.array(z.string().max(1000)).max(30),
  entryPoint: z.string().max(100).optional(),
  templates: problemTemplatesSchema.optional(),
  languageConfigs: languageConfigsSchema.optional(),
  signature: functionSignatureSchema.optional(),
  version: problemVersionSchema.optional(),
  tests: z.array(testCaseSchema).max(100),
  testCoverage: z.literal('none'),
  warnings: z.array(z.string().max(1000)).max(20),
  source: z.literal('imported'),
  sourceStatement: z.string().max(20_000).optional(),
  sourceUrl: z.url().max(2_000).optional(),
});

const artifactSchema = z.object({
  id: z.string().min(1).max(160),
  type: z.enum([
    'parse',
    'diagnose',
    'hint',
    'counterexample',
    'review_card',
    'review_grade',
  ]),
  locale: z.enum(['zh', 'en']),
  problemSlug: z.string().max(120).optional(),
  runId: z.string().max(240).optional(),
  problemContentVersion: z.number().int().min(1).optional().default(1),
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
  reviewGrade: z
    .object({
      hitConcepts: z.array(z.string().max(300)).max(8),
      missedConcepts: z.array(z.string().max(300)).max(8),
      feedback: z.string().max(1200),
      suggestedRating: z.enum(['again', 'hard', 'good', 'easy']),
      confidence: z.number().min(0).max(1),
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
    'baseline_started',
    'baseline_completed',
    'checkpoint_completed',
    'daily_plan_viewed',
    'daily_plan_task_started',
    'daily_plan_task_swapped',
    'daily_plan_task_skipped',
    'daily_plan_task_completed',
    'review_answered',
    'review_rating_overridden',
    'correction_episode_completed',
    'counterexample_requested',
    'review_card_created',
    'review_completed',
    'guest_data_claimed',
    'sync_succeeded',
    'sync_failed',
    'language_selected',
    'typescript_transpile_failed',
    'catalog_sync_completed',
    'catalog_candidate_rejected',
    'catalog_revision_published',
    'catalog_revision_rolled_back',
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
  kind: z.enum(['baseline', 'checkpoint', 'practice']).optional(),
  baselineAssessmentId: z.string().max(160).optional(),
  version: z.string().max(100).optional(),
  verificationToken: z.string().max(4096).optional(),
  problemSlugs: z.array(z.string().max(120)).max(20),
  problemVersions: z
    .array(
      z.object({
        slug: z.string().min(1).max(120),
        contentVersion: z.number().int().min(1),
      })
    )
    .max(20)
    .optional(),
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
  averageDurationMs: z.number().int().min(0).max(10_800_000).optional(),
  hintCount: z.number().int().min(0).max(10_000).optional(),
  errorCategories: z
    .array(
      z.enum([
        'syntax',
        'runtime',
        'timeout',
        'wrong-answer',
        'edge-case',
        'unknown',
      ])
    )
    .max(20)
    .optional(),
  comparison: z
    .object({
      baselineAssessmentId: z.string().min(1).max(160),
      scoreDelta: z.number().int().min(-100).max(100),
      correctCountDelta: z.number().int().min(-100).max(100),
      averageDurationDeltaMs: z
        .number()
        .int()
        .min(-10_800_000)
        .max(10_800_000)
        .optional(),
      hintCountDelta: z.number().int().min(-10_000).max(10_000).optional(),
      baselineErrorCategories: z
        .array(
          z.enum([
            'syntax',
            'runtime',
            'timeout',
            'wrong-answer',
            'edge-case',
            'unknown',
          ])
        )
        .max(20)
        .optional(),
      checkpointErrorCategories: z
        .array(
          z.enum([
            'syntax',
            'runtime',
            'timeout',
            'wrong-answer',
            'edge-case',
            'unknown',
          ])
        )
        .max(20)
        .optional(),
    })
    .optional(),
  evidenceMode: z.literal('browser_local').optional(),
});

const activeAssessmentSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(['baseline', 'checkpoint', 'practice']).optional(),
  baselineAssessmentId: z.string().max(160).optional(),
  problemSlugs: z.array(z.string().max(120)).max(20),
  problemVersions: z
    .array(
      z.object({
        slug: z.string().min(1).max(120),
        contentVersion: z.number().int().min(1),
      })
    )
    .max(20)
    .optional(),
  startedAt: z.iso.datetime(),
  durationMinutes: z.number().int().min(1).max(180),
});

export const reviewItemSchema = z.object({
  problemSlug: z.string().min(1).max(120),
  problemContentVersion: z.number().int().min(1).optional().default(1),
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
  .record(z.string().min(1).max(140), reviewItemSchema)
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
      const expectedKey =
        item.problemContentVersion === 1
          ? item.problemSlug
          : `${item.problemSlug}::v${item.problemContentVersion}`;
      if (expectedKey !== slug) {
        context.addIssue({
          code: 'custom',
          path: [slug, 'problemSlug'],
          message: 'review item key must match problemSlug and contentVersion',
        });
      }
    });
  });

export const reviewProgressSchema = z.object({
  version: z.number().int().min(1).max(100),
  items: reviewItemsSchema,
});

const problemTopicSchema = z.enum([
  'array-hash',
  'two-pointers',
  'stack',
  'binary-search',
  'linked-list',
  'dynamic-programming',
  'bfs',
  'dfs',
]);

const dailyPlanTaskSchema = z.object({
  id: z.string().min(1).max(240),
  kind: z.enum(['due-review', 'weak-topic', 'new-topic']),
  status: z.enum(['pending', 'completed', 'skipped']),
  problemId: z.string().min(1).max(160),
  problemSlug: z.string().min(1).max(120),
  problemContentVersion: z.number().int().min(1),
  primaryTopic: problemTopicSchema,
  difficulty: z.enum(['easy', 'medium', 'hard']),
  reason: z.enum([
    'review-due',
    'assessment-weak',
    'weak-mastery',
    'new-topic',
  ]),
  estimatedMinutes: z.number().int().min(1).max(180),
  dueAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  skipReason: z.string().min(1).max(500).optional(),
  skippedAt: z.iso.datetime().optional(),
});

const dailyLearningPlanSchema = z.object({
  id: z.string().min(1).max(240),
  localDate: z.iso.date(),
  timeZone: z.string().min(1).max(100),
  budgetMinutes: z.number().int().min(1).max(180),
  estimatedMinutes: z.number().int().min(0).max(540),
  preferredLanguage: languageSchema.optional(),
  goal: z.enum(['foundation', 'interview', 'contest']),
  tasks: z.array(dailyPlanTaskSchema).max(3),
  changes: z
    .array(
      z.object({
        id: z.string().min(1).max(260),
        action: z.enum(['skipped', 'swapped', 'swap-unavailable']),
        taskId: z.string().min(1).max(240),
        reason: z.string().min(1).max(500),
        occurredAt: z.iso.datetime(),
        fromProblemSlug: z.string().min(1).max(120),
        fromProblemContentVersion: z.number().int().min(1),
        toProblemSlug: z.string().min(1).max(120).optional(),
        toProblemContentVersion: z.number().int().min(1).optional(),
      })
    )
    .max(30),
});

const reviewGradeSchema = z.object({
  suggestedRating: z.enum(['again', 'hard', 'good', 'easy']),
  coverage: z.number().min(0).max(1),
  matchedPoints: z.array(z.string().max(1000)).max(30),
  missingPoints: z.array(z.string().max(1000)).max(30),
  rationale: z.string().max(4000).optional(),
  gradedAt: z.iso.datetime().optional(),
});

const reviewAttemptSchema = z.object({
  id: z.string().min(1).max(160),
  problemSlug: z.string().min(1).max(120),
  problemContentVersion: z.number().int().min(1),
  answer: z.string().max(10_000),
  submittedAt: z.iso.datetime(),
  grade: reviewGradeSchema.optional(),
  selectedRating: z.enum(['again', 'hard', 'good', 'easy']).optional(),
  ratingOverride: z.enum(['again', 'hard', 'good', 'easy']).optional(),
  gradedArtifactId: z.string().max(160).optional(),
  gradeMode: z.enum(['ai', 'manual_fallback']).optional(),
  gradeErrorCode: z
    .enum([
      'configuration',
      'access_denied',
      'quota',
      'rate_limited',
      'timeout',
      'unavailable',
      'invalid_output',
      'unknown',
    ])
    .optional(),
});

const lineDiffSchema = z.object({
  beforeLines: z.number().int().min(0).max(100_000),
  afterLines: z.number().int().min(0).max(100_000),
  unchangedLines: z.number().int().min(0).max(100_000),
  changedLines: z.number().int().min(0).max(100_000),
  addedLines: z.number().int().min(0).max(100_000),
  removedLines: z.number().int().min(0).max(100_000),
  hasChanges: z.boolean(),
});

const correctionEpisodeSchema = z.object({
  id: z.string().min(1).max(320),
  problemSlug: z.string().min(1).max(120),
  problemContentVersion: z.number().int().min(1),
  startedAt: z.iso.datetime(),
  diagnosedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  initialFailure: z.object({
    runId: z.string().max(160).optional(),
    executedAt: z.iso.datetime(),
    status: z.enum([
      'passed',
      'failed',
      'syntax_error',
      'runtime_error',
      'timeout',
    ]),
    error: z.string().max(20_000).optional(),
    passedTests: z.number().int().min(0).max(1000),
    totalTests: z.number().int().min(0).max(1000),
    failedTests: z
      .array(
        z.object({
          testId: z.string().max(120),
          error: z.string().max(10_000).optional(),
          expected: jsonValueSchema.optional(),
          actual: jsonValueSchema.optional(),
        })
      )
      .max(100),
  }),
  diagnosisCategory: z.enum([
    'syntax',
    'runtime',
    'timeout',
    'wrong-answer',
    'edge-case',
    'unknown',
  ]),
  diagnoses: z
    .array(
      z.object({
        artifactId: z.string().max(160),
        runId: z.string().max(160).optional(),
        category: z.enum([
          'syntax',
          'runtime',
          'timeout',
          'wrong-answer',
          'edge-case',
          'unknown',
        ]),
        createdAt: z.iso.datetime(),
      })
    )
    .max(30),
  attempts: z
    .array(
      z.object({
        runId: z.string().max(160).optional(),
        executedAt: z.iso.datetime(),
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
        durationMs: z.number().min(0).max(60_000),
        codeSnapshot: z.string().max(30_000).optional(),
        diffFromPrevious: lineDiffSchema.optional(),
      })
    )
    .max(30),
  resolved: z.boolean(),
  resolvedAt: z.iso.datetime().optional(),
  passedWithinThreeRuns: z.boolean(),
  repairDurationMs: z.number().int().min(0).max(31_536_000_000).optional(),
  repeatedDiagnosisCategories: z
    .array(
      z.enum([
        'syntax',
        'runtime',
        'timeout',
        'wrong-answer',
        'edge-case',
        'unknown',
      ])
    )
    .max(10),
});

export const persistedCoachStateSchema = z.object({
  version: z.number().int().default(COACH_STORAGE_VERSION),
  profile: learningProfileSchema.nullable(),
  sessions: z.record(z.string(), practiceSessionSchema),
  artifacts: z.array(artifactSchema).max(100),
  events: z.array(productEventSchema).max(300),
  activeAssessment: activeAssessmentSchema.nullable(),
  assessments: z.array(assessmentResultSchema).max(20),
  dailyPlans: z
    .record(z.string().max(240), dailyLearningPlanSchema)
    .optional()
    .default({}),
  reviewAttempts: z.array(reviewAttemptSchema).max(200).optional().default([]),
  correctionEpisodes: z
    .array(correctionEpisodeSchema)
    .max(100)
    .optional()
    .default([]),
  code: z.record(z.string(), languageCodeSchema),
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
      version: REVIEW_PROGRESS_VERSION,
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
        dailyPlans: z
          .record(z.string().max(240), dailyLearningPlanSchema)
          .optional(),
        reviewAttempts: z.array(reviewAttemptSchema).max(200).optional(),
        correctionEpisodes: z
          .array(correctionEpisodeSchema)
          .max(100)
          .optional(),
        code: z
          .record(z.string().min(1).max(120), languageCodeSchema)
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
