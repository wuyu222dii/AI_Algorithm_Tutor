import 'server-only';

import { PERMISSIONS } from '@/core/rbac/permission';
import { hasPermission } from '@/shared/services/rbac';

import { catalogStructuredReviewMode } from './admin-config';
import {
  catalogFunctionSignatureSchema,
  safeParseCatalogReviewDraftV2,
  type CatalogFunctionSignature,
} from './admin-contracts';
import { catalogAdminDatabase } from './admin-db.server';
import { listCanonicalCaseOptions } from './canonical-mapping';
import { CatalogDatabaseStore } from './catalog-store.server';
import type { CatalogCandidateState } from './raw-types';
import {
  catalogSourceProvenanceFromDiscoveryDraft,
  generateCatalogReviewStarterTemplates,
} from './review-draft';

const PENDING_STATES = [
  'discovered',
  'drafting',
  'quarantined',
  'validated',
  'approved',
] as const;

export interface CatalogAdminCandidateQuery {
  status?: string;
  limit?: number;
  query?: string;
  cursor?: string;
}

interface CandidateCursor {
  updatedAt: string;
  id: string;
}

export class CatalogAdminQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogAdminQueryError';
  }
}

function decodeCursor(value?: string): CandidateCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8')
    ) as CandidateCursor;
    if (
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0 ||
      parsed.id.length > 180 ||
      typeof parsed.updatedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.updatedAt))
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function encodeCursor(value: CandidateCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function candidateTitle(
  value: unknown
): { zh?: string; en?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const title = (value as { title?: unknown }).title;
  if (!title || typeof title !== 'object') return undefined;
  const localized = title as { zh?: unknown; en?: unknown };
  return {
    ...(typeof localized.zh === 'string' ? { zh: localized.zh } : {}),
    ...(typeof localized.en === 'string' ? { en: localized.en } : {}),
  };
}

type CandidateRow = Awaited<
  ReturnType<CatalogDatabaseStore['listCandidates']>
>[number];

function draftFromRow(row: CandidateRow): unknown {
  if (
    row.draft &&
    typeof row.draft === 'object' &&
    Object.keys(row.draft).length
  ) {
    return row.draft;
  }
  const normalized = row.normalizedProblem;
  return normalized && typeof normalized === 'object' && 'problem' in normalized
    ? (normalized as { problem: unknown }).problem
    : normalized;
}

export async function catalogAdminCapabilities(userId: string) {
  const [review, publish, rollback] = await Promise.all([
    hasPermission(userId, PERMISSIONS.CATALOG_REVIEW),
    hasPermission(userId, PERMISSIONS.CATALOG_PUBLISH),
    hasPermission(userId, PERMISSIONS.CATALOG_ROLLBACK),
  ]);
  return {
    review,
    publish,
    rollback,
    structuredReviewMode: catalogStructuredReviewMode(),
  };
}

export async function listCatalogAdminCandidates(
  options: CatalogAdminCandidateQuery = {}
) {
  const database = catalogAdminDatabase();
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const store = new CatalogDatabaseStore(
    database as ConstructorParameters<typeof CatalogDatabaseStore>[0]
  );
  const selectedStatus =
    !options.status || options.status === 'pending'
      ? [...PENDING_STATES]
      : options.status === 'all'
        ? undefined
        : (options.status as CatalogCandidateState);
  const cursor = decodeCursor(options.cursor);
  if (options.cursor && !cursor) {
    throw new CatalogAdminQueryError('Catalog candidate cursor is invalid.');
  }
  const rows = await store.listCandidates({
    status: selectedStatus,
    limit: limit + 1,
    query: options.query,
    cursor: cursor
      ? { updatedAt: new Date(cursor.updatedAt), id: cursor.id }
      : undefined,
  });
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => {
    const draft = draftFromRow(row);
    return {
      id: row.id,
      externalId: row.externalId,
      status: row.status,
      changeKind: row.changeKind,
      draftRevision: row.draftRevision,
      sourceRevision: row.sourceRevision,
      updatedAt: row.updatedAt.toISOString(),
      title: candidateTitle(draft),
    };
  });
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            updatedAt: last.updatedAt.toISOString(),
            id: last.id,
          })
        : undefined,
  };
}

export async function getCatalogAdminCandidate(candidateId: string) {
  const database = catalogAdminDatabase();
  const store = new CatalogDatabaseStore(
    database as ConstructorParameters<typeof CatalogDatabaseStore>[0]
  );
  const details = await store.getCandidate(candidateId);
  if (!details) return undefined;
  const {
    candidate: row,
    targetProblemSlug,
    audits,
    aiGenerations: generations,
  } = details;
  const draftProblem = draftFromRow(row);
  const parsedReviewDraft = safeParseCatalogReviewDraftV2(draftProblem);
  const raw = row.rawPayload as Record<string, unknown> | null;
  const draftKind = parsedReviewDraft.success
    ? ('review_v2' as const)
    : raw?.schemaVersion === 1 && raw?.proposed
      ? ('discovery' as const)
      : ('released' as const);
  let lockedSourceEvidence;
  try {
    lockedSourceEvidence = catalogSourceProvenanceFromDiscoveryDraft({
      candidateId: row.id,
      externalId: row.externalId,
      upstreamUrl: row.upstreamUrl,
      sourceRevision: row.sourceRevision,
      licenseSpdx: row.licenseSpdx,
      attribution: row.attribution,
      rawPayload: row.rawPayload as never,
    });
  } catch {
    lockedSourceEvidence = undefined;
  }
  const problemSlug = parsedReviewDraft.success
    ? parsedReviewDraft.data.slug
    : draftProblem && typeof draftProblem === 'object'
      ? ((draftProblem as { slug?: unknown }).slug as string | undefined)
      : undefined;
  return {
    id: row.id,
    externalId: row.externalId,
    status: row.status,
    changeKind: row.changeKind,
    draftRevision: row.draftRevision,
    sourceRevision: row.sourceRevision,
    updatedAt: row.updatedAt.toISOString(),
    title: candidateTitle(draftProblem),
    upstreamUrl: row.upstreamUrl,
    contentHash: row.contentHash,
    licenseSpdx: row.licenseSpdx,
    attribution: row.attribution,
    draftProblem,
    draftKind,
    reviewDraft: parsedReviewDraft.success ? parsedReviewDraft.data : undefined,
    lockedSourceEvidence,
    problemSlug,
    editable:
      catalogStructuredReviewMode() === 'write' &&
      [
        'discovered',
        'drafting',
        'quarantined',
        'validated',
        'approved',
      ].includes(row.status),
    validation: row.validation,
    approval: row.approvedByUserId
      ? {
          approvedByUserId: row.approvedByUserId,
          approvedAt: row.approvedAt?.toISOString(),
        }
      : undefined,
    targetProblemSlug,
    evidence: {
      rawContentHash: row.rawContentHash,
      draftHash: row.draftHash,
      policyVersion: row.policyVersion,
      targetProblemId: row.targetProblemId,
      audits: audits.map((audit) => ({
        id: audit.id,
        action: audit.action,
        reviewerUserId: audit.reviewerUserId,
        notes: audit.notes,
        contentHash: audit.contentHash,
        sourceRevision: audit.sourceRevision,
        draftHash: audit.draftHash,
        draftRevision: audit.draftRevision,
        policyVersion: audit.policyVersion,
        createdAt: audit.createdAt.toISOString(),
      })),
      aiGenerations: generations.map((generation) => ({
        id: generation.id,
        kind: generation.kind,
        provider: generation.provider,
        model: generation.model,
        promptVersion: generation.promptVersion,
        inputHash: generation.inputHash,
        outputHash: generation.outputHash,
        status: generation.status,
        metadata: generation.metadata,
        createdAt: generation.createdAt.toISOString(),
      })),
    },
  };
}

export async function getCatalogAdminCandidatePreview(
  candidateId: string,
  kind: 'upstream' | 'compiled'
) {
  const database = catalogAdminDatabase();
  const store = new CatalogDatabaseStore(
    database as ConstructorParameters<typeof CatalogDatabaseStore>[0]
  );
  const details = await store.getCandidate(candidateId);
  if (!details) return undefined;
  return kind === 'upstream'
    ? details.candidate.rawPayload
    : details.candidate.normalizedProblem;
}

export async function listCatalogAdminCanonicalCases(
  candidateId: string,
  options: {
    signature?: CatalogFunctionSignature | null;
    entryPoints?: Record<'javascript' | 'python' | 'typescript', string>;
    cursor?: number;
    limit?: number;
  } = {}
) {
  const database = catalogAdminDatabase();
  const store = new CatalogDatabaseStore(
    database as ConstructorParameters<typeof CatalogDatabaseStore>[0]
  );
  const details = await store.getCandidate(candidateId);
  if (!details) return undefined;
  const raw = details.candidate.rawPayload as {
    upstream?: { canonicalData?: unknown };
  };
  if (raw.upstream?.canonicalData === undefined) {
    throw new Error('Catalog candidate canonical data is unavailable.');
  }
  const reviewDraft = safeParseCatalogReviewDraftV2(details.candidate.draft);
  const signatureValue =
    options.signature ??
    (reviewDraft.success ? reviewDraft.data.functionProtocol.signature : null);
  const signature =
    signatureValue === null
      ? null
      : catalogFunctionSignatureSchema.parse(signatureValue);
  const all = listCanonicalCaseOptions(
    raw.upstream.canonicalData as never,
    signature
  );
  const cursor = Math.max(0, Math.trunc(options.cursor ?? 0));
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)));
  const page = all.slice(cursor, cursor + limit);
  return {
    items: page,
    total: all.length,
    mapped: all.filter((item) => item.status === 'mapped').length,
    nextCursor:
      cursor + page.length < all.length ? cursor + page.length : undefined,
    selected: reviewDraft.success ? reviewDraft.data.canonicalSelections : [],
    ...(signature && options.entryPoints
      ? {
          templates: generateCatalogReviewStarterTemplates(
            signature,
            options.entryPoints
          ),
        }
      : {}),
  };
}
