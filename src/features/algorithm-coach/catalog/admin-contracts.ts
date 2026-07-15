import { z } from 'zod';

import type { CatalogJsonValue, CatalogTypeSpec } from './raw-types';

export const CATALOG_REVIEW_DRAFT_SCHEMA_VERSION = 2 as const;
export const CATALOG_SOURCE_PROVENANCE_VERSION = 1 as const;
export const CATALOG_ADMIN_CONTRACT_VERSION = 2 as const;

const BLOCKED_IDENTIFIERS = new Set([
  'Function',
  '__proto__',
  'constructor',
  'eval',
  'import',
  'prototype',
  'require',
]);

export const catalogLanguageSchema = z.enum([
  'javascript',
  'python',
  'typescript',
]);

export const catalogDifficultySchema = z.enum(['easy', 'medium', 'hard']);

export const catalogJsonValueSchema: z.ZodType<CatalogJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(catalogJsonValueSchema),
    z.record(z.string(), catalogJsonValueSchema),
  ])
);

export const catalogLocalizedTextSchema = z
  .object({
    zh: z.string().max(20_000),
    en: z.string().max(20_000),
  })
  .strict();

const identifierSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
  .max(64)
  .refine((value) => !BLOCKED_IDENTIFIERS.has(value));

const primitiveTypeSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unknown') }).strict(),
  z.object({ kind: z.literal('integer') }).strict(),
  z.object({ kind: z.literal('number') }).strict(),
  z.object({ kind: z.literal('string') }).strict(),
  z.object({ kind: z.literal('boolean') }).strict(),
  z.object({ kind: z.literal('null') }).strict(),
]);

export const catalogTypeSpecSchema: z.ZodType<CatalogTypeSpec> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    ...primitiveTypeSpecSchema.options,
    z
      .object({
        kind: z.literal('array'),
        items: catalogTypeSpecSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('object'),
        fields: z.record(identifierSchema, catalogTypeSpecSchema),
      })
      .strict(),
    z
      .object({
        kind: z.literal('union'),
        options: z.array(catalogTypeSpecSchema).min(1).max(8),
      })
      .strict(),
  ])
);

export const catalogFunctionSignatureSchema = z
  .object({
    parameters: z
      .array(
        z
          .object({
            name: identifierSchema,
            type: catalogTypeSpecSchema,
          })
          .strict()
      )
      .max(8),
    returns: catalogTypeSpecSchema,
  })
  .strict()
  .superRefine((signature, context) => {
    const names = signature.parameters.map((parameter) => parameter.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Function parameter names must be unique.',
      });
    }
  });

export const catalogCanonicalSelectionV1Schema = z
  .object({
    sourceTestUuid: z.string().trim().min(1).max(200),
    id: z.string().trim().min(1).max(180),
    isSample: z.boolean(),
  })
  .strict();

export const catalogManualTestV1Schema = z
  .object({
    id: z.string().trim().min(1).max(180),
    args: z.array(catalogJsonValueSchema).max(16),
    expected: catalogJsonValueSchema,
    isSample: z.boolean(),
    reviewNote: z.string().trim().max(2_000),
  })
  .strict();

const languageStringRecordSchema = (value: z.ZodString) =>
  z
    .object({
      javascript: value,
      python: value,
      typescript: value,
    })
    .strict();

export const catalogReviewFunctionProtocolV2Schema = z
  .object({
    signature: catalogFunctionSignatureSchema.nullable(),
    entryPoints: languageStringRecordSchema(z.string().trim().max(64)),
    templates: languageStringRecordSchema(z.string().max(50_000)),
  })
  .strict();

/**
 * The editable contract intentionally contains no upstream, origin, runtime,
 * hash, or canonical input/expected fields. Those values are materialized from
 * immutable source evidence after review.
 */
export const catalogReviewDraftV2Schema = z
  .object({
    schemaVersion: z.literal(CATALOG_REVIEW_DRAFT_SCHEMA_VERSION),
    id: z.string().trim().max(180),
    slug: z.string().trim().max(180),
    title: catalogLocalizedTextSchema,
    description: catalogLocalizedTextSchema,
    difficulty: catalogDifficultySchema.nullable(),
    topics: z.array(z.string().trim().min(1).max(100)).max(20),
    learningObjectives: z.array(catalogLocalizedTextSchema).max(6),
    prerequisiteTopics: z.array(z.string().trim().min(1).max(100)).max(12),
    solutionPatterns: z.array(z.string().trim().min(1).max(200)).max(12),
    constraints: z.array(catalogLocalizedTextSchema).max(20),
    hints: z.array(catalogLocalizedTextSchema).max(3),
    reviewPoints: z.array(catalogLocalizedTextSchema).max(20),
    estimatedMinutes: z.number().int().min(1).max(480).nullable(),
    functionProtocol: catalogReviewFunctionProtocolV2Schema,
    canonicalSelections: z.array(catalogCanonicalSelectionV1Schema).max(100),
    manualTests: z.array(catalogManualTestV1Schema).max(100),
  })
  .strict();

export const catalogSourceProvenanceV1Schema = z
  .object({
    provider: z.literal('exercism'),
    repository: z.literal('exercism/problem-specifications'),
    externalId: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    upstreamUrl: z.string().url().max(2_000),
    statementPath: z.string().trim().min(1).max(500),
    canonicalPath: z.string().trim().min(1).max(500),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    licenseSpdx: z.literal('MIT'),
    attribution: z.string().trim().min(1).max(2_000),
    statementHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    canonicalDataHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    licenseContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    statementBlobSha: z.string().regex(/^[a-f0-9]{40}$/),
    canonicalBlobSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (
      !source.upstreamUrl.startsWith(
        `https://github.com/exercism/problem-specifications/tree/${source.sourceRevision}/exercises/${source.externalId}`
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['upstreamUrl'],
        message:
          'Upstream URL must be pinned to the immutable source revision.',
      });
    }
    if (
      !source.statementPath.startsWith(`exercises/${source.externalId}/`) ||
      source.statementPath.includes('..')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['statementPath'],
        message: 'Statement path must belong to the source exercise.',
      });
    }
    if (
      source.canonicalPath !==
      `exercises/${source.externalId}/canonical-data.json`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalPath'],
        message: 'Canonical path must belong to the source exercise.',
      });
    }
  })
  .readonly();

export const catalogReviewDraftUpdateV2Schema = z
  .object({
    schemaVersion: z.literal(CATALOG_REVIEW_DRAFT_SCHEMA_VERSION),
    expectedDraftRevision: z.number().int().min(1).max(1_000_000),
    draft: catalogReviewDraftV2Schema,
  })
  .strict();

export type CatalogLanguage = z.infer<typeof catalogLanguageSchema>;
export type CatalogFunctionSignature = z.infer<
  typeof catalogFunctionSignatureSchema
>;
export type CatalogCanonicalSelectionV1 = z.infer<
  typeof catalogCanonicalSelectionV1Schema
>;
export type CatalogManualTestV1 = z.infer<typeof catalogManualTestV1Schema>;
export type CatalogReviewDraftV2 = z.infer<typeof catalogReviewDraftV2Schema>;
export type CatalogSourceProvenanceV1 = z.infer<
  typeof catalogSourceProvenanceV1Schema
>;
export type CatalogLockedProvenance = CatalogSourceProvenanceV1;
export type CatalogReviewDraftUpdateV2 = z.infer<
  typeof catalogReviewDraftUpdateV2Schema
>;

export interface NormalizationResult {
  candidateId: string;
  status: string;
  draftRevision: number;
  blockers: Array<{ code: string; path: string; message: string }>;
  mappedCount: number;
  materialized: boolean;
  alreadyNormalized: boolean;
  aiFallback: boolean;
}

export function safeParseCatalogReviewDraftV2(value: unknown) {
  return catalogReviewDraftV2Schema.safeParse(value);
}

export function safeParseCatalogSourceProvenanceV1(value: unknown) {
  return catalogSourceProvenanceV1Schema.safeParse(value);
}

export function safeParseCatalogReviewDraftUpdateV2(value: unknown) {
  return catalogReviewDraftUpdateV2Schema.safeParse(value);
}
