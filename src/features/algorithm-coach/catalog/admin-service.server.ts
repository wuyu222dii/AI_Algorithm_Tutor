import 'server-only';

import { PERMISSIONS } from '@/core/rbac/permission';
import { hasPermission } from '@/shared/services/rbac';

import { catalogAdminDatabase } from './admin-db.server';
import { CatalogDatabaseStore } from './catalog-store.server';
import type { CatalogCandidateState } from './raw-types';

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
  return { review, publish, rollback };
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
  const rows = await store.listCandidates({
    status: selectedStatus,
    limit,
  });
  return rows.map((row) => {
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
    upstreamPayload: row.rawPayload,
    draftProblem,
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
