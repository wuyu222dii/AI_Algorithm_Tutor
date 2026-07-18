import { z } from 'zod';

import {
  getScopedStorageKey,
  GUEST_COACH_STORAGE_SCOPE,
  type CoachStorageScope,
} from './storage';
import type { AssessmentDraftV1 } from './types';

export const ASSESSMENT_DRAFT_KEY = 'algocoach:assessment-draft:v1';

const languageSchema = z.enum(['javascript', 'typescript', 'python']);
const languageCodeSchema = z
  .object({
    javascript: z.string().optional(),
    typescript: z.string().optional(),
    python: z.string().optional(),
  })
  .strict();
const codeRunSchema = z
  .object({
    problemSlug: z.string().min(1).max(120),
    language: languageSchema,
    status: z.enum([
      'passed',
      'failed',
      'syntax_error',
      'runtime_error',
      'timeout',
    ]),
    passedTests: z.number().int().min(0),
    totalTests: z.number().int().min(0),
    testResults: z.array(z.unknown()),
    console: z.array(z.string()),
    durationMs: z.number().finite().min(0),
    executedAt: z.iso.datetime(),
  })
  .passthrough();

export const assessmentDraftV1Schema = z
  .object({
    version: z.literal(1),
    assessmentId: z.string().min(1).max(160),
    kind: z.enum(['baseline', 'checkpoint', 'practice']),
    baselineAssessmentId: z.string().max(160).optional(),
    token: z.string().min(32).max(4096),
    problemVersions: z
      .array(
        z.object({
          slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          contentVersion: z.number().int().min(1).max(1_000_000),
        })
      )
      .length(2),
    startedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    graceExpiresAt: z.iso.datetime(),
    serverOffsetMs: z
      .number()
      .int()
      .min(-24 * 60 * 60 * 1000)
      .max(24 * 60 * 60 * 1000)
      .optional()
      .default(0),
    language: languageSchema,
    codes: z.record(z.string().min(1).max(160), languageCodeSchema),
    activeIndex: z.number().int().min(0).max(1),
    sampleResults: z.record(z.string().min(1).max(160), codeRunSchema),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((draft, context) => {
    if (new Set(draft.problemVersions.map((item) => item.slug)).size !== 2) {
      context.addIssue({
        code: 'custom',
        path: ['problemVersions'],
        message: 'Assessment problem versions must be unique',
      });
    }
    if (Date.parse(draft.expiresAt) >= Date.parse(draft.graceExpiresAt)) {
      context.addIssue({
        code: 'custom',
        path: ['graceExpiresAt'],
        message: 'Assessment grace expiry must follow the answer deadline',
      });
    }
  });

function storageKey(scope: CoachStorageScope): string {
  return getScopedStorageKey(ASSESSMENT_DRAFT_KEY, scope);
}

export function loadAssessmentDraft(
  scope: CoachStorageScope,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage
): AssessmentDraftV1 | null {
  const key = storageKey(scope);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = assessmentDraftV1Schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data as unknown as AssessmentDraftV1;
    storage.removeItem(key);
  } catch {
    storage.removeItem(key);
  }
  return null;
}

export function saveAssessmentDraft(
  draft: AssessmentDraftV1,
  scope: CoachStorageScope,
  storage: Pick<Storage, 'setItem'> = window.localStorage
): void {
  const parsed = assessmentDraftV1Schema.parse(draft);
  storage.setItem(storageKey(scope), JSON.stringify(parsed));
}

export function clearAssessmentDraft(
  scope: CoachStorageScope,
  storage: Pick<Storage, 'removeItem'> = window.localStorage
): void {
  storage.removeItem(storageKey(scope));
}

export function claimGuestAssessmentDraft(
  scope: CoachStorageScope,
  storage: Storage = window.localStorage,
  options: { clearGuest?: boolean } = {}
): boolean {
  if (scope === GUEST_COACH_STORAGE_SCOPE) return false;
  const guestDraft = loadAssessmentDraft(GUEST_COACH_STORAGE_SCOPE, storage);
  if (!guestDraft) return false;
  if (!loadAssessmentDraft(scope, storage)) {
    saveAssessmentDraft(guestDraft, scope, storage);
  }
  if (options.clearGuest !== false) {
    clearAssessmentDraft(GUEST_COACH_STORAGE_SCOPE, storage);
  }
  return true;
}
