import { z } from 'zod';

export const ANONYMOUS_PRODUCT_EVENT_NAMES = [
  'visitor_started',
  'onboarding_started',
  'activated',
  'practice_started',
  'first_code_run',
  'first_problem_passed',
  'code_run',
  'code_submitted',
  'corrected_after_diagnosis',
  'assessment_completed',
  'baseline_completed',
  'checkpoint_completed',
  'daily_plan_task_completed',
  'review_completed',
  'language_selected',
  'typescript_transpile_failed',
  'experiment_exposed',
] as const;

export const anonymousProductEventSchema = z
  .object({
    id: z.string().min(8).max(160),
    name: z.enum(ANONYMOUS_PRODUCT_EVENT_NAMES),
    timestamp: z.iso.datetime(),
    problemSlug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
  })
  .strict();

export const anonymousEventCheckpointSchema = z
  .object({
    sequence: z.number().int().min(0).max(10_000_000),
    generatedTotal: z.number().int().min(0).max(10_000_000),
    deliveredTotal: z.number().int().min(0).max(10_000_000),
  })
  .strict()
  .refine((value) => value.deliveredTotal <= value.generatedTotal, {
    message: 'deliveredTotal cannot exceed generatedTotal',
    path: ['deliveredTotal'],
  });

export const anonymousProductEventBatchSchema = z
  .object({
    events: z.array(anonymousProductEventSchema).min(1).max(50),
    checkpoint: anonymousEventCheckpointSchema.optional(),
  })
  .strict();

export type AnonymousProductEvent = z.infer<typeof anonymousProductEventSchema>;
export type AnonymousEventCheckpoint = z.infer<
  typeof anonymousEventCheckpointSchema
>;

export interface AnonymousProductEventBatch {
  events: AnonymousProductEvent[];
  checkpoint?: AnonymousEventCheckpoint;
}
