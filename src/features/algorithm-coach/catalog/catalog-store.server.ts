import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  max,
  or,
  sql,
} from 'drizzle-orm';

import { dbPostgres } from '@/core/db';
import {
  coachCatalogAdminMutation,
  coachCatalogAiGeneration,
  coachCatalogReviewAudit,
  coachCatalogSource,
  coachCatalogSyncRun,
  coachProblem,
  coachProblemCandidate,
  coachProblemOrigin,
  coachProblemRevision,
  coachTestCase,
} from '@/config/db/schema.postgres';

import { isValidCoachModelId } from '../model';
import {
  safeParseCatalogReviewDraftV2,
  type CatalogReviewDraftV2,
} from './admin-contracts';
import {
  createDefaultCanonicalSelections,
  listCanonicalCaseOptions,
} from './canonical-mapping';
import {
  calculateCandidateContentHash,
  calculateCanonicalDataHash,
  calculateCatalogContentFingerprint,
  calculateCatalogRawEvidenceHash,
  sha256,
  stableStringify,
} from './content-hash';
import {
  assertDiscoveryDraftBoundary,
  calculateDiscoveryContentHash,
  CATALOG_AI_DRAFT_PROMPT_VERSION,
} from './discovery-enrichment';
import {
  calculateGitBlobSha,
  ExercismCatalogAdapter,
  isExercismLicenseEvidenceValid,
} from './exercism-adapter';
import { emitCatalogOperationalEvent } from './operational-events';
import type {
  CatalogBootstrapSummary,
  CatalogCandidateState,
  CatalogJsonValue,
  CatalogValidationResult,
  ExercismDiscoveryDraft,
  ExercismDiscoveryReport,
  ExercismSnapshot,
  ExercismUpstreamProblem,
  RawCatalogProblem,
} from './raw-types';
import {
  materializeCatalogReviewDraftV2,
  normalizeCatalogReviewDraftV2,
  type CatalogReviewBlocker,
  type CatalogReviewRawCandidateFactsV1,
} from './review-draft';
import {
  CATALOG_RUNNER_VALIDATION_VERSION,
  validateCatalogRunnerCompatibility,
} from './runner-compatibility.server';
import {
  candidateStateForValidation,
  mergeCatalogValidationResults,
  validateCandidatePayload,
  validateCanonicalTestProvenance,
  validateCatalogBatch,
} from './validation';

const EXERCISM_SOURCE_ID = 'catalog_source_exercism';
const EXERCISM_SOURCE_KEY = 'exercism-problem-specifications';
export const CATALOG_POLICY_VERSION = 'catalog-policy-v1';

const REVIEWER_ROLE = 'algocoach_catalog_reviewer';
const PUBLISHER_ROLE = 'algocoach_catalog_publisher';
const AI_FINISH_REASONS = new Set([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
  'unknown',
]);

type Database = ReturnType<typeof dbPostgres>;
type CatalogTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

interface CandidatePayload {
  problem: RawCatalogProblem;
  upstream: ExercismUpstreamProblem;
}

type CandidateRow = typeof coachProblemCandidate.$inferSelect;

export interface CatalogCandidateListOptions {
  status?: CatalogCandidateState | CatalogCandidateState[];
  changeKind?: CandidateRow['changeKind'];
  query?: string;
  cursor?: { updatedAt: Date; id: string };
  limit?: number;
  offset?: number;
}

export interface CatalogCandidateDetails {
  candidate: CandidateRow;
  targetProblemSlug?: string;
  audits: Array<typeof coachCatalogReviewAudit.$inferSelect>;
  aiGenerations: Array<typeof coachCatalogAiGeneration.$inferSelect>;
}

export interface CatalogReviewDraftMutationResult {
  candidate: CandidateRow;
  draft: CatalogReviewDraftV2;
  blockers: CatalogReviewBlocker[];
  materialized: boolean;
  alreadyNormalized?: boolean;
}

export interface CatalogDiscoveryIngestionSummary {
  ingested: number;
  alreadyPresent: number;
  candidateIds: string[];
  discovered: number;
  duplicates: number;
  quarantined: string[];
  rejected: string[];
}

export interface CatalogAdminMutationClaim {
  mutation: typeof coachCatalogAdminMutation.$inferSelect;
  claimed: boolean;
}

export interface RecordedExercismEvidence {
  externalId: string;
  sourceRevision: string;
  statementBlobSha?: string;
  canonicalBlobSha?: string;
  rawContentHash?: string;
  originOnly: boolean;
}

export interface CatalogDiscoveryState {
  etag?: string;
  revision?: string;
  backlogComplete: boolean;
  consecutiveFailures: number;
  previousLicenseSpdx?: string;
  previousLicenseContentHash?: string;
  latestLicenseSpdx?: string;
  latestLicenseContentHash?: string;
  previousTreeExercises?: number;
  latestTreeExercises?: number;
  latestCandidateDelta?: number;
  candidateCount: number;
  pendingCandidateCount: number;
}

export interface ClaimCatalogAdminMutationInput {
  actorUserId: string;
  idempotencyKey: string;
  action:
    | 'update_draft'
    | 'validate'
    | 'approve'
    | 'reject'
    | 'publish'
    | 'rollback'
    | 'bootstrap';
  targetType: 'candidate' | 'problem' | 'revision' | 'catalog';
  targetId: string;
  requestHash: string;
}

export interface DatabaseSyncSummary {
  runId: string;
  revision?: string;
  etag?: string;
  localContentFingerprint: string;
  notModified: boolean;
  discovered: number;
  candidateIds: string[];
}

export function calculateCatalogCandidateDelta(
  latestStatistics: Record<string, unknown>,
  previousStatistics: Record<string, unknown>
): number | undefined {
  const count = (statistics: Record<string, unknown>, ...keys: string[]) => {
    const value = keys
      .map((key) => statistics[key])
      .find((candidate) => candidate !== undefined);
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, value)
      : undefined;
  };
  const latestBacklog = count(
    latestStatistics,
    'candidateBacklog',
    'undiscoveredExercises'
  );
  const previousBacklog = count(
    previousStatistics,
    'candidateBacklog',
    'undiscoveredExercises'
  );
  const previousDiscovered = count(previousStatistics, 'discovered');
  if (
    latestBacklog === undefined ||
    previousBacklog === undefined ||
    previousDiscovered === undefined
  ) {
    return undefined;
  }
  const expectedBacklog = Math.max(0, previousBacklog - previousDiscovered);
  return Math.max(0, latestBacklog - expectedBacklog);
}

export function isSuccessfulCatalogDiscoveryRun(run: {
  status: string;
  statistics: unknown;
}): boolean {
  const statistics = run.statistics as { kind?: unknown } | null;
  return statistics?.kind === 'discovery' && run.status !== 'failed';
}

export function countConsecutiveDiscoveryFailures(
  runs: Array<{ status: string; statistics: unknown }>
): number {
  const discoveryRuns = runs.filter(
    (run) =>
      run.statistics !== null &&
      typeof run.statistics === 'object' &&
      (run.statistics as { kind?: unknown }).kind === 'discovery'
  );
  let failures = 0;
  for (const run of discoveryRuns) {
    if (run.status !== 'failed') break;
    failures += 1;
  }
  return failures;
}

export interface DatabaseValidationSummary {
  checked: number;
  skipped: number;
  validated: number;
  quarantined: number;
  rejected: number;
  candidateIds: string[];
}

export interface DatabaseApprovalSummary {
  approved: number;
  alreadyApproved: number;
  alreadyPublished: number;
  candidateIds: string[];
}

export interface DatabasePublishSummary {
  published: number;
  alreadyPublished: number;
  problemSlugs: string[];
  revisionIds: string[];
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u001f'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function templatesFrom(problem: RawCatalogProblem) {
  return Object.fromEntries(
    Object.entries(problem.languageConfigs).map(([language, config]) => [
      language,
      config.template,
    ])
  );
}

function legacyEntryPoint(problem: RawCatalogProblem): string {
  return (
    problem.languageConfigs.javascript?.entryPoint ??
    problem.languageConfigs.typescript?.entryPoint ??
    problem.languageConfigs.python.entryPoint
  );
}

function candidatePayload(value: unknown): CandidatePayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Catalog candidate payload is malformed.');
  }
  const payload = value as Partial<CandidatePayload>;
  if (!payload.problem || !payload.upstream) {
    throw new Error('Catalog candidate payload is incomplete.');
  }
  return payload as CandidatePayload;
}

function candidatePayloadOrUndefined(
  value: unknown
): CandidatePayload | undefined {
  try {
    return candidatePayload(value);
  } catch {
    return undefined;
  }
}

function actorUserId(actor: string): string {
  const value = actor.trim();
  if (!value) throw new Error('A catalog actor user id is required.');
  return value;
}

async function setLocalCapabilityRole(
  tx: CatalogTransaction,
  role: typeof REVIEWER_ROLE | typeof PUBLISHER_ROLE
): Promise<void> {
  await tx.execute(
    role === REVIEWER_ROLE
      ? sql.raw(`SET LOCAL ROLE ${REVIEWER_ROLE}`)
      : sql.raw(`SET LOCAL ROLE ${PUBLISHER_ROLE}`)
  );
}

function jsonHash(value: unknown): string {
  return sha256(stableStringify(value as CatalogJsonValue));
}

function rawEvidenceHashFromPayload(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const source =
    raw.source && typeof raw.source === 'object'
      ? (raw.source as Record<string, unknown>)
      : raw;
  const upstream =
    raw.upstream && typeof raw.upstream === 'object'
      ? (raw.upstream as Record<string, unknown>)
      : undefined;
  const externalId =
    typeof raw.externalId === 'string'
      ? raw.externalId
      : typeof upstream?.externalId === 'string'
        ? upstream.externalId
        : undefined;
  if (
    !externalId ||
    typeof source.statementHash !== 'string' ||
    typeof source.statementBlobSha !== 'string' ||
    typeof source.canonicalDataHash !== 'string' ||
    typeof source.licenseGitBlobSha !== 'string' ||
    typeof source.licenseContentHash !== 'string'
  ) {
    return undefined;
  }
  return calculateCatalogRawEvidenceHash({
    externalId,
    statementHash: source.statementHash,
    statementBlobSha: source.statementBlobSha,
    canonicalDataHash: source.canonicalDataHash,
    ...(typeof source.canonicalBlobSha === 'string'
      ? { canonicalBlobSha: source.canonicalBlobSha }
      : {}),
    licenseGitBlobSha: source.licenseGitBlobSha,
    licenseContentHash: source.licenseContentHash,
  });
}

async function hasEquivalentRawEvidence(
  tx: CatalogTransaction,
  sourceId: string,
  externalId: string,
  rawContentHash: string
): Promise<boolean> {
  const rows = await tx
    .select({
      rawPayload: coachProblemCandidate.rawPayload,
      rawContentHash: coachProblemCandidate.rawContentHash,
    })
    .from(coachProblemCandidate)
    .where(
      and(
        eq(coachProblemCandidate.sourceId, sourceId),
        eq(coachProblemCandidate.externalId, externalId)
      )
    );
  return rows.some(
    (row) =>
      row.rawContentHash === rawContentHash ||
      rawEvidenceHashFromPayload(row.rawPayload) === rawContentHash
  );
}

export function calculateCatalogValidationFingerprint(input: {
  draftHash: string;
  policyVersion: string;
  runnerVersion?: string;
}): string {
  return sha256(
    stableStringify({
      draftHash: input.draftHash,
      policyVersion: input.policyVersion,
      runnerVersion: input.runnerVersion ?? CATALOG_RUNNER_VALIDATION_VERSION,
    })
  );
}

function validationFingerprint(candidate: CandidateRow): string {
  return calculateCatalogValidationFingerprint({
    draftHash: candidate.draftHash,
    policyVersion: candidate.policyVersion,
  });
}

function persistedValidationFingerprint(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const fingerprint = (value as { fingerprint?: unknown }).fingerprint;
  return typeof fingerprint === 'string' ? fingerprint : undefined;
}

function discoveryDraftFromCandidate(
  row: CandidateRow
): ExercismDiscoveryDraft {
  const raw = row.rawPayload as Partial<ExercismDiscoveryDraft> | null;
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    !raw.source ||
    !raw.upstream ||
    !raw.proposed
  ) {
    throw new Error('Catalog candidate has no immutable discovery payload.');
  }
  return raw as ExercismDiscoveryDraft;
}

function reviewFactsFromCandidate(
  row: CandidateRow
): CatalogReviewRawCandidateFactsV1 {
  return {
    candidateId: row.id,
    externalId: row.externalId,
    upstreamUrl: row.upstreamUrl,
    sourceRevision: row.sourceRevision,
    licenseSpdx: row.licenseSpdx,
    attribution: row.attribution,
    rawPayload: discoveryDraftFromCandidate(row),
  };
}

async function nextCatalogReviewProblemId(
  tx: CatalogTransaction
): Promise<string> {
  const schema = (process.env.DB_SCHEMA || 'algocoach').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error('DB_SCHEMA is invalid for catalog id allocation.');
  }
  const sequenceName = `${schema}.coach_catalog_problem_draft_id_seq`;
  const rows = (await tx.execute(
    sql`select nextval(${sequenceName}::regclass)::bigint as value`
  )) as unknown as Array<{ value: string | number | bigint }>;
  const value = rows[0]?.value;
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 999_999) {
    throw new Error('Catalog problem id sequence is exhausted.');
  }
  return `ex-${String(numeric).padStart(3, '0')}`;
}

function blockerValidation(blockers: CatalogReviewBlocker[]) {
  return {
    valid: false,
    issues: blockers.map((blocker) => ({
      code: 'manual_review_required' as const,
      message: blocker.message,
      path: blocker.path,
    })),
  };
}

async function persistCatalogReviewDraft(
  tx: CatalogTransaction,
  candidate: CandidateRow,
  draft: CatalogReviewDraftV2,
  reviewerUserId: string,
  editKind: 'normalized' | 'structured_edit'
): Promise<CatalogReviewDraftMutationResult> {
  const materialization = materializeCatalogReviewDraftV2(
    draft,
    reviewFactsFromCandidate(candidate)
  );
  if (
    materialization.blockers.some(
      (blocker) =>
        blocker.code === 'immutable_source_invalid' ||
        blocker.code === 'immutable_source_mismatch'
    )
  ) {
    throw new Error('Catalog candidate immutable source evidence is invalid.');
  }
  const payload =
    materialization.problem && materialization.upstream
      ? {
          problem: materialization.problem,
          upstream: materialization.upstream,
        }
      : undefined;
  if (payload) assertCandidatePayloadMatchesRawEvidence(candidate, payload);
  const nextContentHash = payload
    ? calculateCandidateContentHash(payload.problem, payload.upstream)
    : sha256(
        stableStringify({
          rawContentHash: candidate.rawContentHash,
          draft,
        } as unknown as CatalogJsonValue)
      );
  const nextDraftRevision = candidate.draftRevision + 1;
  const nextDraftHash = jsonHash(draft);
  const blockers = materialization.blockers;
  const validation = blockerValidation(
    blockers.length > 0
      ? blockers
      : [
          {
            code: 'missing_required_field',
            path: 'validation',
            message:
              'The structured draft is complete and must pass deterministic validation before approval.',
          },
        ]
  );
  const [updated] = await tx
    .update(coachProblemCandidate)
    .set({
      draft,
      draftHash: nextDraftHash,
      draftRevision: nextDraftRevision,
      normalizedProblem:
        payload ??
        ({
          schemaVersion: 2,
          reviewDraft: draft,
          publishable: false,
          blockers,
        } as Record<string, unknown>),
      contentHash: nextContentHash,
      validation,
      status: 'quarantined',
      rejectionReason: null,
      approvedByUserId: null,
      approvedAt: null,
      approvedContentHash: null,
      approvedSourceRevision: null,
      approvedDraftHash: null,
      approvedDraftRevision: null,
      approvedPolicyVersion: null,
      publishedByUserId: null,
      publishedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(coachProblemCandidate.id, candidate.id))
    .returning();
  if (!updated) throw new Error('Catalog review draft update failed.');
  await tx.insert(coachCatalogReviewAudit).values({
    id: `catalog_audit_${randomUUID()}`,
    candidateId: candidate.id,
    reviewerUserId,
    action: 'draft_updated',
    contentHash: updated.contentHash,
    sourceRevision: updated.sourceRevision,
    draftHash: updated.draftHash,
    draftRevision: updated.draftRevision,
    policyVersion: updated.policyVersion,
    metadata: {
      editKind,
      fromDraftRevision: candidate.draftRevision,
      toDraftRevision: updated.draftRevision,
      materialized: Boolean(payload),
      blockerCodes: [...new Set(blockers.map((blocker) => blocker.code))],
    },
  });
  return {
    candidate: updated,
    draft,
    blockers,
    materialized: Boolean(payload),
  };
}

function assertCandidatePayloadMatchesRawEvidence(
  candidate: CandidateRow,
  payload: CandidatePayload
): void {
  const raw =
    candidate.rawPayload && typeof candidate.rawPayload === 'object'
      ? (candidate.rawPayload as Record<string, unknown>)
      : {};
  const source =
    raw.source && typeof raw.source === 'object'
      ? (raw.source as Record<string, unknown>)
      : raw;
  const checks: Array<[unknown, unknown]> = [
    [payload.problem.origin.externalId, candidate.externalId],
    [payload.problem.origin.sourceRevision, candidate.sourceRevision],
    [payload.problem.origin.upstreamUrl, candidate.upstreamUrl],
    [payload.problem.origin.licenseSpdx, candidate.licenseSpdx],
    [payload.problem.origin.attribution, candidate.attribution],
    [payload.upstream.externalId, candidate.externalId],
    [payload.upstream.upstreamUrl, candidate.upstreamUrl],
    [payload.upstream.statementPath, source.statementPath],
    [payload.problem.origin.statementPath, source.statementPath],
    [payload.upstream.statementHash, source.statementHash],
    [payload.upstream.canonicalDataHash, source.canonicalDataHash],
    [payload.upstream.statementBlobSha, source.statementBlobSha],
    [payload.upstream.canonicalPath, source.canonicalPath],
    [payload.upstream.canonicalBlobSha, source.canonicalBlobSha],
  ];
  if (
    checks.some(
      ([actual, expected]) =>
        typeof expected === 'string' && actual !== expected
    )
  ) {
    throw new Error(
      'Catalog draft does not match immutable upstream evidence.'
    );
  }
  const rawUpstream = raw.upstream;
  if (
    rawUpstream &&
    typeof rawUpstream === 'object' &&
    stableStringify(payload.upstream as unknown as CatalogJsonValue) !==
      stableStringify(rawUpstream as CatalogJsonValue)
  ) {
    throw new Error(
      'Catalog draft upstream payload differs from immutable evidence.'
    );
  }
  if (
    typeof source.licenseText === 'string' &&
    (typeof source.licenseContentHash !== 'string' ||
      sha256(source.licenseText) !== source.licenseContentHash ||
      typeof source.licenseGitBlobSha !== 'string' ||
      calculateGitBlobSha(source.licenseText) !== source.licenseGitBlobSha ||
      source.licenseSpdx !== candidate.licenseSpdx ||
      source.attribution !== candidate.attribution)
  ) {
    throw new Error('Catalog license evidence is invalid.');
  }
}

function candidateHasDiscoveryEvidence(candidate: CandidateRow): boolean {
  if (!candidate.rawPayload || typeof candidate.rawPayload !== 'object') {
    return false;
  }
  const raw = candidate.rawPayload as {
    schemaVersion?: unknown;
    publishable?: unknown;
    source?: { statementBlobSha?: unknown };
    upstream?: { statementBlobSha?: unknown };
  };
  return (
    raw.schemaVersion === 1 &&
    raw.publishable === false &&
    typeof raw.source?.statementBlobSha === 'string' &&
    typeof raw.upstream?.statementBlobSha === 'string'
  );
}

function candidateSourceEvidence(
  candidate: CandidateRow
): Record<string, unknown> {
  if (!candidate.rawPayload || typeof candidate.rawPayload !== 'object') {
    return {};
  }
  const raw = candidate.rawPayload as Record<string, unknown>;
  return raw.source && typeof raw.source === 'object'
    ? (raw.source as Record<string, unknown>)
    : raw;
}

function candidateLicenseEvidenceIssues(
  candidate: CandidateRow
): CatalogValidationResult['issues'] {
  const source = candidateSourceEvidence(candidate);
  if (
    typeof source.licenseSpdx !== 'string' ||
    typeof source.licenseText !== 'string' ||
    typeof source.licenseGitBlobSha !== 'string' ||
    typeof source.licenseContentHash !== 'string'
  ) {
    return [
      {
        code: 'invalid_license',
        message:
          'Candidate must retain the exact verified MIT license text, Git blob SHA, content hash, and attribution.',
        path: 'rawPayload.source',
      },
    ];
  }
  if (
    !isExercismLicenseEvidenceValid({
      path: 'LICENSE',
      spdx: source.licenseSpdx,
      text: source.licenseText,
      gitBlobSha: source.licenseGitBlobSha,
      contentHash: source.licenseContentHash,
    }) ||
    source.licenseSpdx !== candidate.licenseSpdx ||
    source.attribution !== candidate.attribution
  ) {
    return [
      {
        code: 'invalid_license',
        message:
          'Candidate must retain the exact verified MIT license text, Git blob SHA, content hash, and attribution.',
        path: 'rawPayload.source',
      },
    ];
  }
  return [];
}

function candidateTestProvenanceIssues(
  candidate: CandidateRow,
  problem: RawCatalogProblem
): CatalogValidationResult['issues'] {
  if (!candidateHasDiscoveryEvidence(candidate)) return [];
  const raw = candidate.rawPayload as {
    upstream?: { canonicalData?: unknown };
  };
  const canonicalData = raw.upstream?.canonicalData;
  if (
    canonicalData === undefined ||
    canonicalData === null ||
    (typeof canonicalData !== 'object' &&
      !['string', 'number', 'boolean'].includes(typeof canonicalData))
  ) {
    return [
      {
        code: 'invalid_upstream_data',
        message: 'Immutable canonical test evidence is missing.',
        path: 'rawPayload.upstream.canonicalData',
      },
    ];
  }
  return validateCanonicalTestProvenance(
    problem,
    canonicalData as CatalogJsonValue
  ).issues;
}

async function priorTestEvidenceIssues(
  tx: CatalogTransaction,
  candidate: CandidateRow,
  problem: RawCatalogProblem
): Promise<CatalogValidationResult['issues']> {
  if (!candidate.targetProblemId) return [];
  const prior = await tx
    .select({
      args: coachTestCase.args,
      expected: coachTestCase.expected,
      sourceTestUuid: coachTestCase.sourceTestUuid,
    })
    .from(coachTestCase)
    .where(eq(coachTestCase.problemId, candidate.targetProblemId));
  const expectedByArgs = new Map(
    prior.map((test) => [
      stableStringify(test.args as CatalogJsonValue),
      stableStringify(test.expected as CatalogJsonValue),
    ])
  );
  const argsByCanonicalUuid = new Map(
    prior.flatMap((test) =>
      test.sourceTestUuid
        ? [
            [
              test.sourceTestUuid,
              stableStringify(test.args as CatalogJsonValue),
            ] as const,
          ]
        : []
    )
  );
  const issues: CatalogValidationResult['issues'] = [];
  problem.tests.forEach((test, index) => {
    const args = stableStringify(test.args as CatalogJsonValue);
    const expected = stableStringify(test.expected as CatalogJsonValue);
    const priorExpected = expectedByArgs.get(args);
    if (priorExpected !== undefined && priorExpected !== expected) {
      issues.push({
        code: 'invalid_upstream_data',
        message:
          'A prior revision has the same test arguments with a different expected result.',
        path: `tests.${index}`,
      });
    }
    if (
      test.sourceKind === 'canonical' &&
      test.sourceTestUuid &&
      argsByCanonicalUuid.has(test.sourceTestUuid) &&
      argsByCanonicalUuid.get(test.sourceTestUuid) !== args
    ) {
      issues.push({
        code: 'invalid_upstream_data',
        message: 'Canonical test UUID maps to a different prior test vector.',
        path: `tests.${index}.sourceTestUuid`,
      });
    }
  });
  return issues;
}

function normalizedTestSetSignature(
  signature: unknown,
  tests: Array<{ args: unknown; expected: unknown }>
): string {
  const vectors = tests
    .map((test) =>
      stableStringify({
        args: test.args as CatalogJsonValue,
        expected: test.expected as CatalogJsonValue,
      })
    )
    .sort((left, right) => left.localeCompare(right));
  return sha256(
    stableStringify({
      signature: (signature ?? null) as CatalogJsonValue,
      vectors,
    })
  );
}

async function duplicateCatalogIdentityIssues(
  tx: CatalogTransaction,
  candidate: CandidateRow,
  problem: RawCatalogProblem
): Promise<CatalogValidationResult['issues']> {
  const candidateSignature = normalizedTestSetSignature(
    problem.languageConfigs.javascript.signature,
    problem.tests
  );
  const issues: CatalogValidationResult['issues'] = [];
  const issueKeys = new Set<string>();
  const addIssue = (
    matchedId: string,
    reason: string,
    matchedProblemId?: string | null
  ) => {
    if (
      matchedProblemId &&
      candidate.targetProblemId &&
      matchedProblemId === candidate.targetProblemId
    ) {
      return;
    }
    const key = `${matchedProblemId ?? matchedId}:${reason}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push({
      code:
        reason === 'external mapping'
          ? 'duplicate_external_id'
          : 'duplicate_content',
      message: `Candidate matches existing ${reason} ${matchedId}; associate it to the existing external problem before validation.`,
      path: 'targetProblemId',
    });
  };

  const existingCandidates = await tx.select().from(coachProblemCandidate);
  for (const existing of existingCandidates) {
    if (existing.id === candidate.id || existing.status === 'rejected')
      continue;
    const existingPayload = candidatePayloadOrUndefined(
      existing.normalizedProblem
    );
    const inferredProblemId =
      existing.targetProblemId ??
      (existing.status === 'published'
        ? stableId('problem', existing.sourceId, existing.externalId)
        : null);
    if (existing.externalId === candidate.externalId) {
      addIssue(existing.id, 'external mapping', inferredProblemId);
    }
    if (existing.contentHash === candidate.contentHash) {
      addIssue(existing.id, 'candidate content hash', inferredProblemId);
    }
    if (
      existingPayload?.problem.origin.contentHash === problem.origin.contentHash
    ) {
      addIssue(existing.id, 'local content hash', inferredProblemId);
    }
    if (
      existingPayload &&
      normalizedTestSetSignature(
        existingPayload.problem.languageConfigs.javascript.signature,
        existingPayload.problem.tests
      ) === candidateSignature
    ) {
      addIssue(
        existing.id,
        'complete test-vector signature',
        inferredProblemId
      );
    }
  }

  const revisions = await tx
    .select({
      id: coachProblemRevision.id,
      problemId: coachProblemRevision.problemId,
      contentHash: coachProblemRevision.contentHash,
      sourceExternalId: coachProblemRevision.sourceExternalId,
      signature: coachProblemRevision.signature,
    })
    .from(coachProblemRevision)
    .where(inArray(coachProblemRevision.status, ['published', 'archived']));
  if (revisions.length === 0) return issues;
  const revisionIds = revisions.map((revision) => revision.id);
  const revisionTests = await tx
    .select({
      revisionId: coachTestCase.revisionId,
      args: coachTestCase.args,
      expected: coachTestCase.expected,
    })
    .from(coachTestCase)
    .where(inArray(coachTestCase.revisionId, revisionIds));
  const testsByRevision = new Map<
    string,
    Array<{ args: unknown; expected: unknown }>
  >();
  for (const test of revisionTests) {
    const tests = testsByRevision.get(test.revisionId) ?? [];
    tests.push({ args: test.args, expected: test.expected });
    testsByRevision.set(test.revisionId, tests);
  }
  for (const revision of revisions) {
    if (revision.sourceExternalId === candidate.externalId) {
      addIssue(revision.id, 'external mapping', revision.problemId);
    }
    if (revision.contentHash === candidate.contentHash) {
      addIssue(revision.id, 'revision content hash', revision.problemId);
    }
    const tests = testsByRevision.get(revision.id);
    if (
      tests?.length === problem.tests.length &&
      normalizedTestSetSignature(revision.signature, tests) ===
        candidateSignature
    ) {
      addIssue(
        revision.id,
        'complete test-vector signature',
        revision.problemId
      );
    }
  }
  return issues;
}

async function validateRunnerCompatibility(
  problem: RawCatalogProblem
): Promise<CatalogValidationResult> {
  try {
    const result = await validateCatalogRunnerCompatibility(problem);
    return {
      valid: result.valid,
      issues: result.issues.map((item) => ({
        code: 'invalid_function_protocol' as const,
        message: [
          item.language ? `[${item.language}]` : '[catalog]',
          `[${item.stage}]`,
          item.testId ? `[test:${item.testId}]` : '',
          item.message,
        ]
          .filter(Boolean)
          .join(' '),
        path:
          item.path ??
          (item.language
            ? `languageConfigs.${item.language}`
            : item.testId
              ? `tests.${item.testId}`
              : 'runnerCompatibility'),
      })),
      runnerCompatibility: {
        valid: result.valid,
        testCount: result.testCount,
        checks: result.checks,
        issues: result.issues,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown runner gate failure.';
    return {
      valid: false,
      issues: [
        {
          code: 'invalid_function_protocol',
          message: `Runner compatibility gate failed: ${message.slice(0, 1000)}`,
          path: 'runnerCompatibility',
        },
      ],
      runnerCompatibility: {
        valid: false,
        testCount: problem.tests.length,
        checks: [],
        issues: [
          {
            code: 'runtime_protocol_error',
            stage: 'runtime',
            message: message.slice(0, 1000),
          },
        ],
      },
    };
  }
}

function boundedLimit(value: number | undefined, fallback = 50): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value))
    throw new Error('Catalog limit must be an integer.');
  return Math.max(1, Math.min(101, value));
}

async function reconcileAdminMutationResult(
  tx: CatalogTransaction,
  mutation: typeof coachCatalogAdminMutation.$inferSelect
): Promise<Record<string, unknown> | undefined> {
  if (mutation.targetType === 'candidate') {
    const [candidate] = await tx
      .select({ status: coachProblemCandidate.status })
      .from(coachProblemCandidate)
      .where(eq(coachProblemCandidate.id, mutation.targetId))
      .limit(1);
    if (!candidate) return undefined;
    const audits = await tx
      .select({
        action: coachCatalogReviewAudit.action,
        createdAt: coachCatalogReviewAudit.createdAt,
      })
      .from(coachCatalogReviewAudit)
      .where(eq(coachCatalogReviewAudit.candidateId, mutation.targetId))
      .orderBy(desc(coachCatalogReviewAudit.createdAt))
      .limit(100);
    const actions = new Set(
      audits
        .filter((audit) => audit.createdAt >= mutation.claimedAt)
        .map((audit) => audit.action)
    );
    const applied =
      (mutation.action === 'approve' &&
        ['approved', 'published'].includes(candidate.status) &&
        actions.has('approved')) ||
      (mutation.action === 'publish' &&
        candidate.status === 'published' &&
        actions.has('published')) ||
      (mutation.action === 'reject' &&
        candidate.status === 'rejected' &&
        actions.has('rejected')) ||
      (mutation.action === 'update_draft' && actions.has('draft_updated')) ||
      (mutation.action === 'validate' && actions.has('submitted'));
    return applied
      ? {
          reconciled: true,
          action: mutation.action,
          targetId: mutation.targetId,
          candidateStatus: candidate.status,
        }
      : undefined;
  }
  if (
    mutation.action === 'rollback' &&
    ['problem', 'revision'].includes(mutation.targetType)
  ) {
    const audits = await tx
      .select()
      .from(coachCatalogReviewAudit)
      .where(
        mutation.targetType === 'problem'
          ? eq(coachCatalogReviewAudit.problemId, mutation.targetId)
          : eq(coachCatalogReviewAudit.revisionId, mutation.targetId)
      )
      .orderBy(desc(coachCatalogReviewAudit.createdAt))
      .limit(20);
    if (
      audits.some(
        (audit) =>
          audit.action === 'rolled_back' &&
          audit.createdAt >= mutation.claimedAt
      )
    ) {
      return {
        reconciled: true,
        action: mutation.action,
        targetId: mutation.targetId,
      };
    }
  }
  if (mutation.action === 'bootstrap') {
    const runs = await tx
      .select()
      .from(coachCatalogSyncRun)
      .orderBy(desc(coachCatalogSyncRun.createdAt))
      .limit(20);
    if (
      runs.some(
        (run) =>
          run.createdAt >= mutation.claimedAt &&
          (run.statistics as { kind?: unknown })?.kind === 'bootstrap' &&
          run.status === 'succeeded'
      )
    ) {
      return { reconciled: true, action: mutation.action };
    }
  }
  return undefined;
}

async function ensureExercismSource(database: Database | CatalogTransaction) {
  await database
    .insert(coachCatalogSource)
    .values({
      id: EXERCISM_SOURCE_ID,
      key: EXERCISM_SOURCE_KEY,
      name: 'Exercism Problem Specifications',
      adapter: 'exercism-github-v1',
      baseUrl: 'https://github.com/exercism/problem-specifications',
      status: 'active',
      syncEnabled: true,
      syncIntervalMinutes: 1440,
      licensePolicy: { allow: ['MIT'] },
    })
    .onConflictDoUpdate({
      target: coachCatalogSource.key,
      set: {
        name: 'Exercism Problem Specifications',
        adapter: 'exercism-github-v1',
        baseUrl: 'https://github.com/exercism/problem-specifications',
        licensePolicy: { allow: ['MIT'] },
        updatedAt: new Date(),
      },
    });
  const [source] = await database
    .select()
    .from(coachCatalogSource)
    .where(eq(coachCatalogSource.key, EXERCISM_SOURCE_KEY))
    .limit(1);
  if (!source) throw new Error('Unable to initialize the Exercism source.');
  return source;
}

export class CatalogDatabaseStore {
  constructor(private readonly database: Database = dbPostgres()) {}

  async listCandidates(
    options: CatalogCandidateListOptions = {}
  ): Promise<CandidateRow[]> {
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const filters = [];
      if (options.status) {
        filters.push(
          Array.isArray(options.status)
            ? inArray(coachProblemCandidate.status, options.status)
            : eq(coachProblemCandidate.status, options.status)
        );
      }
      if (options.changeKind) {
        filters.push(eq(coachProblemCandidate.changeKind, options.changeKind));
      }
      const query = options.query?.trim();
      if (query) {
        const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
        filters.push(
          or(
            ilike(coachProblemCandidate.externalId, pattern),
            sql`coalesce(${coachProblemCandidate.draft}->'title'->>'zh', '') ilike ${pattern} escape '\\'`,
            sql`coalesce(${coachProblemCandidate.draft}->'title'->>'en', '') ilike ${pattern} escape '\\'`
          )!
        );
      }
      if (options.cursor) {
        filters.push(
          or(
            lt(coachProblemCandidate.updatedAt, options.cursor.updatedAt),
            and(
              eq(coachProblemCandidate.updatedAt, options.cursor.updatedAt),
              lt(coachProblemCandidate.id, options.cursor.id)
            )
          )!
        );
      }
      return tx
        .select()
        .from(coachProblemCandidate)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(
          desc(coachProblemCandidate.updatedAt),
          desc(coachProblemCandidate.id)
        )
        .limit(boundedLimit(options.limit))
        .offset(Math.max(0, Math.trunc(options.offset ?? 0)));
    });
  }

  async getCandidate(
    candidateId: string
  ): Promise<CatalogCandidateDetails | undefined> {
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const [candidate] = await tx
        .select()
        .from(coachProblemCandidate)
        .where(eq(coachProblemCandidate.id, candidateId))
        .limit(1);
      if (!candidate) return undefined;
      const [targetProblem] = candidate.targetProblemId
        ? await tx
            .select({ slug: coachProblem.slug })
            .from(coachProblem)
            .where(eq(coachProblem.id, candidate.targetProblemId))
            .limit(1)
        : [];
      const audits = await tx
        .select()
        .from(coachCatalogReviewAudit)
        .where(eq(coachCatalogReviewAudit.candidateId, candidateId))
        .orderBy(desc(coachCatalogReviewAudit.createdAt))
        .limit(100);
      const aiGenerations = await tx
        .select()
        .from(coachCatalogAiGeneration)
        .where(eq(coachCatalogAiGeneration.candidateId, candidateId))
        .orderBy(desc(coachCatalogAiGeneration.createdAt))
        .limit(50);
      return {
        candidate,
        ...(targetProblem?.slug
          ? { targetProblemSlug: targetProblem.slug }
          : {}),
        audits,
        aiGenerations,
      };
    });
  }

  async normalizeCandidateReviewDraft(
    candidateId: string,
    proposedDraft: unknown,
    actor: string,
    expectedDraftRevision: number
  ): Promise<CatalogReviewDraftMutationResult> {
    const reviewerUserId = actorUserId(actor);
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 1) {
      throw new Error('Expected draft revision must be a positive integer.');
    }
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const [candidate] = await tx
        .select()
        .from(coachProblemCandidate)
        .where(eq(coachProblemCandidate.id, candidateId))
        .for('update');
      if (!candidate) throw new Error('Catalog candidate was not found.');
      if (candidate.draftRevision !== expectedDraftRevision) {
        throw new Error('Catalog candidate draft revision is stale.');
      }
      if (safeParseCatalogReviewDraftV2(candidate.draft).success) {
        const current = safeParseCatalogReviewDraftV2(candidate.draft);
        return {
          candidate,
          draft: current.success ? current.data : (candidate.draft as never),
          blockers: normalizeCatalogReviewDraftV2(
            candidate.draft,
            reviewFactsFromCandidate(candidate)
          ).blockers,
          materialized: Boolean(
            candidatePayloadOrUndefined(candidate.normalizedProblem)
          ),
          alreadyNormalized: true,
        };
      }
      if (
        !['discovered', 'drafting', 'quarantined'].includes(candidate.status)
      ) {
        throw new Error(
          'Only discovered or quarantined candidates can be normalized.'
        );
      }
      const normalized = normalizeCatalogReviewDraftV2(
        proposedDraft,
        reviewFactsFromCandidate(candidate)
      );
      let targetSlug: string | undefined;
      let targetDraftId: string | undefined;
      if (candidate.targetProblemId) {
        const [target] = await tx
          .select({
            slug: coachProblem.slug,
            currentRevisionId: coachProblem.currentRevisionId,
          })
          .from(coachProblem)
          .where(eq(coachProblem.id, candidate.targetProblemId))
          .limit(1);
        targetSlug = target?.slug;
        if (target?.currentRevisionId) {
          const [revision] = await tx
            .select({ candidateId: coachProblemRevision.candidateId })
            .from(coachProblemRevision)
            .where(eq(coachProblemRevision.id, target.currentRevisionId))
            .limit(1);
          if (revision?.candidateId) {
            const [previousCandidate] = await tx
              .select({
                normalizedProblem: coachProblemCandidate.normalizedProblem,
              })
              .from(coachProblemCandidate)
              .where(eq(coachProblemCandidate.id, revision.candidateId))
              .limit(1);
            targetDraftId = candidatePayloadOrUndefined(
              previousCandidate?.normalizedProblem
            )?.problem.id;
          }
        }
      }
      const draft: CatalogReviewDraftV2 = {
        ...normalized.draft,
        id:
          normalized.draft.id ||
          targetDraftId ||
          (await nextCatalogReviewProblemId(tx)),
        slug: targetSlug || normalized.draft.slug,
      };
      if (draft.canonicalSelections.length === 0) {
        const source = discoveryDraftFromCandidate(candidate);
        draft.canonicalSelections = createDefaultCanonicalSelections(
          listCanonicalCaseOptions(
            source.upstream.canonicalData,
            draft.functionProtocol.signature
          )
        );
      }
      return persistCatalogReviewDraft(
        tx,
        candidate,
        draft,
        reviewerUserId,
        'normalized'
      );
    });
  }

  async saveCandidateReviewDraft(
    candidateId: string,
    draftValue: unknown,
    actor: string,
    expectedDraftRevision: number
  ): Promise<CatalogReviewDraftMutationResult> {
    const reviewerUserId = actorUserId(actor);
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 1) {
      throw new Error('Expected draft revision must be a positive integer.');
    }
    const parsed = safeParseCatalogReviewDraftV2(draftValue);
    if (!parsed.success) {
      throw new Error('Catalog structured review draft is invalid.');
    }
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const [candidate] = await tx
        .select()
        .from(coachProblemCandidate)
        .where(eq(coachProblemCandidate.id, candidateId))
        .for('update');
      if (!candidate) throw new Error('Catalog candidate was not found.');
      if (candidate.draftRevision !== expectedDraftRevision) {
        throw new Error('Catalog candidate draft revision is stale.');
      }
      if (
        ![
          'discovered',
          'drafting',
          'quarantined',
          'validated',
          'approved',
        ].includes(candidate.status)
      ) {
        throw new Error('Catalog candidate cannot be edited in this state.');
      }
      const currentDraft = safeParseCatalogReviewDraftV2(candidate.draft);
      if (!currentDraft.success) {
        throw new Error('Catalog candidate must be normalized before editing.');
      }
      if (parsed.data.id !== currentDraft.data.id) {
        throw new Error('Catalog problem id is server assigned and immutable.');
      }
      return persistCatalogReviewDraft(
        tx,
        candidate,
        parsed.data,
        reviewerUserId,
        'structured_edit'
      );
    });
  }

  async updateCandidateDraft(
    candidateId: string,
    draft: unknown,
    actor: string,
    expectedDraftRevision: number
  ): Promise<CandidateRow> {
    const reviewerUserId = actorUserId(actor);
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 1) {
      throw new Error('Expected draft revision must be a positive integer.');
    }
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const [candidate] = await tx
        .select()
        .from(coachProblemCandidate)
        .where(eq(coachProblemCandidate.id, candidateId))
        .for('update');
      if (!candidate) throw new Error('Catalog candidate was not found.');
      if (candidate.draftRevision !== expectedDraftRevision) {
        throw new Error('Catalog candidate draft revision is stale.');
      }
      if (
        ['approved', 'published', 'rejected', 'archived'].includes(
          candidate.status
        )
      ) {
        throw new Error(
          'Approved, published, rejected, or archived legacy catalog drafts are immutable.'
        );
      }

      const proposedPayload = candidatePayloadOrUndefined(draft);
      if (proposedPayload) {
        assertCandidatePayloadMatchesRawEvidence(candidate, proposedPayload);
      }
      const normalizedProblem =
        proposedPayload ??
        ({
          schemaVersion: 2,
          reviewDraft: draft,
          publishable: false,
          blockers: [
            {
              code: 'invalid_contract',
              path: 'draft',
              message:
                'Legacy JSON did not contain a complete candidate payload.',
            },
          ],
        } as Record<string, unknown>);
      const nextContentHash = proposedPayload
        ? calculateCandidateContentHash(
            proposedPayload.problem,
            proposedPayload.upstream
          )
        : sha256(
            stableStringify({
              rawContentHash: candidate.rawContentHash,
              draft,
            } as unknown as CatalogJsonValue)
          );
      const nextDraftRevision = candidate.draftRevision + 1;
      const nextDraftHash = jsonHash(draft);
      const [updated] = await tx
        .update(coachProblemCandidate)
        .set({
          draft,
          draftHash: nextDraftHash,
          draftRevision: nextDraftRevision,
          normalizedProblem,
          contentHash: nextContentHash,
          validation: {},
          status: 'quarantined',
          rejectionReason: null,
          approvedByUserId: null,
          approvedAt: null,
          approvedContentHash: null,
          approvedSourceRevision: null,
          approvedDraftHash: null,
          approvedDraftRevision: null,
          approvedPolicyVersion: null,
          publishedByUserId: null,
          publishedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(coachProblemCandidate.id, candidateId))
        .returning();
      if (!updated) throw new Error('Catalog candidate draft update failed.');
      await tx.insert(coachCatalogReviewAudit).values({
        id: `catalog_audit_${randomUUID()}`,
        candidateId,
        reviewerUserId,
        action: 'draft_updated',
        contentHash: updated.contentHash,
        sourceRevision: updated.sourceRevision,
        draftHash: updated.draftHash,
        draftRevision: updated.draftRevision,
        policyVersion: updated.policyVersion,
        metadata: {
          fromDraftRevision: candidate.draftRevision,
          toDraftRevision: updated.draftRevision,
        },
      });
      return updated;
    });
  }

  async associateCandidateTarget(
    candidateId: string,
    targetProblemSlug: string | null,
    actor: string,
    expectedDraftRevision: number
  ): Promise<CandidateRow> {
    const reviewerUserId = actorUserId(actor);
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 1) {
      throw new Error('Expected draft revision must be a positive integer.');
    }
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const [candidate] = await tx
        .select()
        .from(coachProblemCandidate)
        .where(eq(coachProblemCandidate.id, candidateId))
        .for('update');
      if (!candidate) throw new Error('Catalog candidate was not found.');
      if (candidate.draftRevision !== expectedDraftRevision) {
        throw new Error('Catalog candidate draft revision is stale.');
      }
      if (['published', 'rejected', 'archived'].includes(candidate.status)) {
        throw new Error(
          'Published, rejected, or archived catalog target associations are immutable.'
        );
      }

      let targetProblemId: string | null = null;
      if (targetProblemSlug !== null) {
        const slug = targetProblemSlug.trim();
        if (!slug) throw new Error('Target problem slug cannot be blank.');
        const [target] = await tx
          .select({
            id: coachProblem.id,
            source: coachProblem.source,
            status: coachProblem.status,
          })
          .from(coachProblem)
          .where(
            and(eq(coachProblem.slug, slug), isNull(coachProblem.ownerUserId))
          )
          .limit(1);
        if (
          !target ||
          target.source !== 'external' ||
          target.status !== 'published'
        ) {
          throw new Error(
            'Target must be a published shared external catalog problem.'
          );
        }
        targetProblemId = target.id;
      }
      const changeKind = targetProblemId ? 'content_update' : 'new';
      if (
        candidate.targetProblemId === targetProblemId &&
        candidate.changeKind === changeKind
      ) {
        return candidate;
      }
      const nextDraftRevision = candidate.draftRevision + 1;
      const nextDraftHash = jsonHash({
        draft: candidate.draft,
        targetProblemId,
        changeKind,
      });
      const [updated] = await tx
        .update(coachProblemCandidate)
        .set({
          targetProblemId,
          changeKind,
          draftRevision: nextDraftRevision,
          draftHash: nextDraftHash,
          validation: {},
          status: 'quarantined',
          rejectionReason: null,
          approvedByUserId: null,
          approvedAt: null,
          approvedContentHash: null,
          approvedSourceRevision: null,
          approvedDraftHash: null,
          approvedDraftRevision: null,
          approvedPolicyVersion: null,
          publishedByUserId: null,
          publishedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(coachProblemCandidate.id, candidateId))
        .returning();
      if (!updated) throw new Error('Catalog target association failed.');
      await tx.insert(coachCatalogReviewAudit).values({
        id: `catalog_audit_${randomUUID()}`,
        candidateId,
        reviewerUserId,
        action: 'draft_updated',
        contentHash: updated.contentHash,
        sourceRevision: updated.sourceRevision,
        draftHash: updated.draftHash,
        draftRevision: updated.draftRevision,
        policyVersion: updated.policyVersion,
        metadata: {
          kind: 'target_association',
          previousTargetProblemId: candidate.targetProblemId,
          targetProblemId,
          changeKind,
        },
      });
      return updated;
    });
  }

  async rejectCandidate(
    candidateId: string,
    actor: string,
    reason: string,
    expectedDraftRevision?: number
  ): Promise<CandidateRow> {
    const reviewerUserId = actorUserId(actor);
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error('A rejection reason is required.');
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const [candidate] = await tx
        .select()
        .from(coachProblemCandidate)
        .where(eq(coachProblemCandidate.id, candidateId))
        .for('update');
      if (!candidate) throw new Error('Catalog candidate was not found.');
      if (
        expectedDraftRevision !== undefined &&
        candidate.draftRevision !== expectedDraftRevision
      ) {
        throw new Error('Catalog candidate draft revision is stale.');
      }
      if (candidate.status === 'published' || candidate.status === 'archived') {
        throw new Error('Published catalog candidates cannot be rejected.');
      }
      if (candidate.status === 'rejected') return candidate;
      const [updated] = await tx
        .update(coachProblemCandidate)
        .set({
          status: 'rejected',
          rejectionReason: normalizedReason.slice(0, 2000),
          approvedByUserId: null,
          approvedAt: null,
          approvedContentHash: null,
          approvedSourceRevision: null,
          approvedDraftHash: null,
          approvedDraftRevision: null,
          approvedPolicyVersion: null,
          publishedByUserId: null,
          publishedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(coachProblemCandidate.id, candidateId))
        .returning();
      if (!updated) throw new Error('Catalog candidate rejection failed.');
      await tx.insert(coachCatalogReviewAudit).values({
        id: `catalog_audit_${randomUUID()}`,
        candidateId,
        reviewerUserId,
        action: 'rejected',
        notes: normalizedReason.slice(0, 2000),
        contentHash: candidate.contentHash,
        sourceRevision: candidate.sourceRevision,
        draftHash: candidate.draftHash,
        draftRevision: candidate.draftRevision,
        policyVersion: candidate.policyVersion,
        metadata: { reason: normalizedReason.slice(0, 2000) },
      });
      return updated;
    });
  }

  async recordAiGeneration(input: {
    candidateId: string;
    actorUserId: string;
    kind: 'translation' | 'topic_mapping' | 'difficulty' | 'review_summary';
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
    outputHash: string;
    status: 'generated' | 'accepted' | 'rejected';
    metadata?: Record<string, unknown>;
  }): Promise<typeof coachCatalogAiGeneration.$inferSelect> {
    const userId = actorUserId(input.actorUserId);
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const [record] = await tx
        .insert(coachCatalogAiGeneration)
        .values({
          id: `catalog_ai_${randomUUID()}`,
          candidateId: input.candidateId,
          actorUserId: userId,
          kind: input.kind,
          provider: input.provider,
          model: input.model,
          promptVersion: input.promptVersion,
          inputHash: input.inputHash,
          outputHash: input.outputHash,
          status: input.status,
          metadata: input.metadata ?? {},
        })
        .returning();
      if (!record) throw new Error('Catalog AI generation was not recorded.');
      return record;
    });
  }

  async claimAdminMutation(
    input: ClaimCatalogAdminMutationInput
  ): Promise<CatalogAdminMutationClaim> {
    const userId = actorUserId(input.actorUserId);
    const role = ['publish', 'rollback'].includes(input.action)
      ? PUBLISHER_ROLE
      : REVIEWER_ROLE;
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, role);
      const id = stableId('catalog_mutation', userId, input.idempotencyKey);
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
      const inserted = await tx
        .insert(coachCatalogAdminMutation)
        .values({
          id,
          actorUserId: userId,
          idempotencyKey: input.idempotencyKey,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          requestHash: input.requestHash,
          status: 'claimed',
          claimedAt: now,
          leaseExpiresAt,
          attemptCount: 1,
        })
        .onConflictDoNothing({
          target: [
            coachCatalogAdminMutation.actorUserId,
            coachCatalogAdminMutation.idempotencyKey,
          ],
        })
        .returning();
      let [mutation] = inserted.length
        ? inserted
        : await tx
            .select()
            .from(coachCatalogAdminMutation)
            .where(
              and(
                eq(coachCatalogAdminMutation.actorUserId, userId),
                eq(
                  coachCatalogAdminMutation.idempotencyKey,
                  input.idempotencyKey
                )
              )
            )
            .limit(1)
            .for('update');
      if (!mutation) throw new Error('Catalog admin mutation claim failed.');
      if (
        mutation.requestHash !== input.requestHash ||
        mutation.action !== input.action ||
        mutation.targetType !== input.targetType ||
        mutation.targetId !== input.targetId
      ) {
        throw new Error('Idempotency key was reused with a different request.');
      }
      if (
        inserted.length === 0 &&
        mutation.status === 'claimed' &&
        mutation.leaseExpiresAt <= now
      ) {
        const reconciled = await reconcileAdminMutationResult(tx, mutation);
        if (reconciled) {
          [mutation] = await tx
            .update(coachCatalogAdminMutation)
            .set({
              status: 'completed',
              result: reconciled,
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(coachCatalogAdminMutation.id, mutation.id))
            .returning();
          if (!mutation) {
            throw new Error('Catalog admin mutation reconciliation failed.');
          }
          return { mutation, claimed: false };
        }
        [mutation] = await tx
          .update(coachCatalogAdminMutation)
          .set({
            claimedAt: now,
            leaseExpiresAt,
            attemptCount: mutation.attemptCount + 1,
            errorCode: null,
            updatedAt: now,
          })
          .where(eq(coachCatalogAdminMutation.id, mutation.id))
          .returning();
        if (!mutation)
          throw new Error('Catalog admin mutation reclaim failed.');
        return { mutation, claimed: true };
      }
      return { mutation, claimed: inserted.length > 0 };
    });
  }

  async completeAdminMutation(
    mutationId: string,
    actor: string,
    outcome: {
      status: 'completed' | 'failed';
      result?: Record<string, unknown>;
      errorCode?: string;
    }
  ): Promise<typeof coachCatalogAdminMutation.$inferSelect> {
    const userId = actorUserId(actor);
    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const [mutation] = await tx
        .select()
        .from(coachCatalogAdminMutation)
        .where(
          and(
            eq(coachCatalogAdminMutation.id, mutationId),
            eq(coachCatalogAdminMutation.actorUserId, userId)
          )
        )
        .for('update');
      if (!mutation) throw new Error('Catalog admin mutation was not found.');
      if (mutation.status !== 'claimed') return mutation;
      const [updated] = await tx
        .update(coachCatalogAdminMutation)
        .set({
          status: outcome.status,
          result: outcome.result ?? {},
          errorCode: outcome.errorCode ?? null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(coachCatalogAdminMutation.id, mutationId))
        .returning();
      if (!updated)
        throw new Error('Catalog admin mutation completion failed.');
      return updated;
    });
  }

  async sourceState(): Promise<{
    etag?: string;
    revision?: string;
    localContentFingerprint?: string;
  }> {
    const [source] = await this.database
      .select()
      .from(coachCatalogSource)
      .where(eq(coachCatalogSource.key, EXERCISM_SOURCE_KEY))
      .limit(1);
    if (!source) return {};
    const [run] = await this.database
      .select()
      .from(coachCatalogSyncRun)
      .where(
        and(
          eq(coachCatalogSyncRun.sourceId, source.id),
          eq(coachCatalogSyncRun.status, 'succeeded')
        )
      )
      .orderBy(desc(coachCatalogSyncRun.completedAt))
      .limit(1);
    const statistics =
      run?.statistics && typeof run.statistics === 'object'
        ? (run.statistics as { localContentFingerprint?: unknown })
        : undefined;
    return {
      revision: source.lastSuccessfulRevision ?? undefined,
      etag: run?.cursor ?? undefined,
      localContentFingerprint:
        typeof statistics?.localContentFingerprint === 'string'
          ? statistics.localContentFingerprint
          : undefined,
    };
  }

  async recordedExercismExternalIds(): Promise<string[]> {
    return Array.from(
      new Set(
        (await this.recordedExercismEvidence()).map((entry) => entry.externalId)
      )
    );
  }

  async recordedExercismEvidence(): Promise<RecordedExercismEvidence[]> {
    const [source] = await this.database
      .select({ id: coachCatalogSource.id })
      .from(coachCatalogSource)
      .where(eq(coachCatalogSource.key, EXERCISM_SOURCE_KEY))
      .limit(1);
    if (!source) return [];
    const [origins, candidates, runs] = await Promise.all([
      this.database
        .select({
          externalId: coachProblemOrigin.externalId,
          sourceRevision: coachProblemOrigin.sourceRevision,
        })
        .from(coachProblemOrigin)
        .where(eq(coachProblemOrigin.sourceId, source.id)),
      this.database
        .select()
        .from(coachProblemCandidate)
        .where(eq(coachProblemCandidate.sourceId, source.id))
        .orderBy(desc(coachProblemCandidate.createdAt)),
      this.database
        .select({ statistics: coachCatalogSyncRun.statistics })
        .from(coachCatalogSyncRun)
        .where(
          and(
            eq(coachCatalogSyncRun.sourceId, source.id),
            eq(coachCatalogSyncRun.status, 'succeeded'),
            sql`${coachCatalogSyncRun.statistics}->>'kind' = 'bootstrap'`
          )
        )
        .orderBy(desc(coachCatalogSyncRun.createdAt))
        .limit(1),
    ]);
    const bootstrapStatistics = runs
      .map((run) => run.statistics)
      .find(
        (statistics) =>
          statistics !== null &&
          typeof statistics === 'object' &&
          (statistics as { kind?: unknown }).kind === 'bootstrap'
      ) as { baselineHashes?: unknown } | undefined;
    const bootstrapEvidence = new Map<
      string,
      { statementBlobSha: string; canonicalBlobSha?: string }
    >();
    if (Array.isArray(bootstrapStatistics?.baselineHashes)) {
      for (const item of bootstrapStatistics.baselineHashes) {
        if (!item || typeof item !== 'object') continue;
        const value = item as Record<string, unknown>;
        if (
          typeof value.externalId !== 'string' ||
          typeof value.statementBlobSha !== 'string'
        ) {
          continue;
        }
        bootstrapEvidence.set(value.externalId, {
          statementBlobSha: value.statementBlobSha,
          ...(typeof value.canonicalBlobSha === 'string'
            ? { canonicalBlobSha: value.canonicalBlobSha }
            : {}),
        });
      }
    }
    const evidence: RecordedExercismEvidence[] = [];
    const evidenceKeys = new Set<string>();
    const addEvidence = (entry: RecordedExercismEvidence) => {
      const key = [
        entry.externalId,
        entry.statementBlobSha ?? '',
        entry.canonicalBlobSha ?? '',
        entry.originOnly ? 'origin' : 'blob',
      ].join(':');
      if (evidenceKeys.has(key)) return;
      evidenceKeys.add(key);
      evidence.push(entry);
    };
    for (const candidate of candidates) {
      const sourceEvidence = candidateSourceEvidence(candidate);
      const statementBlobSha =
        typeof sourceEvidence.statementBlobSha === 'string'
          ? sourceEvidence.statementBlobSha
          : undefined;
      const canonicalBlobSha =
        typeof sourceEvidence.canonicalBlobSha === 'string'
          ? sourceEvidence.canonicalBlobSha
          : undefined;
      addEvidence({
        externalId: candidate.externalId,
        sourceRevision: candidate.sourceRevision,
        ...(statementBlobSha ? { statementBlobSha } : {}),
        ...(canonicalBlobSha ? { canonicalBlobSha } : {}),
        ...(candidate.rawContentHash
          ? { rawContentHash: candidate.rawContentHash }
          : {}),
        originOnly: !statementBlobSha,
      });
    }
    for (const origin of origins) {
      const baseline = bootstrapEvidence.get(origin.externalId);
      addEvidence({
        externalId: origin.externalId,
        sourceRevision: origin.sourceRevision,
        ...(baseline?.statementBlobSha
          ? { statementBlobSha: baseline.statementBlobSha }
          : {}),
        ...(baseline?.canonicalBlobSha
          ? { canonicalBlobSha: baseline.canonicalBlobSha }
          : {}),
        originOnly: !baseline?.statementBlobSha,
      });
    }
    return evidence.sort(
      (left, right) =>
        left.externalId.localeCompare(right.externalId) ||
        (left.statementBlobSha ?? '').localeCompare(
          right.statementBlobSha ?? ''
        )
    );
  }

  async discoveryState(): Promise<CatalogDiscoveryState> {
    const [source] = await this.database
      .select({ id: coachCatalogSource.id })
      .from(coachCatalogSource)
      .where(eq(coachCatalogSource.key, EXERCISM_SOURCE_KEY))
      .limit(1);
    if (!source) {
      return {
        backlogComplete: false,
        consecutiveFailures: 0,
        candidateCount: 0,
        pendingCandidateCount: 0,
      };
    }
    const [runs, candidates] = await Promise.all([
      this.database
        .select()
        .from(coachCatalogSyncRun)
        .where(eq(coachCatalogSyncRun.sourceId, source.id))
        .orderBy(desc(coachCatalogSyncRun.createdAt))
        .limit(100),
      this.database
        .select({
          id: coachProblemCandidate.id,
          status: coachProblemCandidate.status,
        })
        .from(coachProblemCandidate)
        .where(eq(coachProblemCandidate.sourceId, source.id)),
    ]);
    const discoveries = runs.filter(isSuccessfulCatalogDiscoveryRun);
    const consecutiveFailures = countConsecutiveDiscoveryFailures(runs);
    const latest = discoveries[0];
    const previous = discoveries[1];
    const latestStats = (latest?.statistics ?? {}) as Record<string, unknown>;
    const previousStats = (previous?.statistics ?? {}) as Record<
      string,
      unknown
    >;
    const optionalString = (value: unknown) =>
      typeof value === 'string' ? value : undefined;
    const optionalNumber = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const previousTreeExercises = optionalNumber(previousStats.treeExercises);
    const latestTreeExercises = optionalNumber(latestStats.treeExercises);
    const latestCandidateDelta = calculateCatalogCandidateDelta(
      latestStats,
      previousStats
    );
    return {
      ...(latest?.cursor ? { etag: latest.cursor } : {}),
      ...(latest?.upstreamRevision
        ? { revision: latest.upstreamRevision }
        : {}),
      backlogComplete: latestStats.backlogComplete === true,
      consecutiveFailures,
      ...(optionalString(previousStats.licenseSpdx)
        ? { previousLicenseSpdx: optionalString(previousStats.licenseSpdx) }
        : {}),
      ...(optionalString(previousStats.licenseContentHash)
        ? {
            previousLicenseContentHash: optionalString(
              previousStats.licenseContentHash
            ),
          }
        : {}),
      ...(optionalString(latestStats.licenseSpdx)
        ? { latestLicenseSpdx: optionalString(latestStats.licenseSpdx) }
        : {}),
      ...(optionalString(latestStats.licenseContentHash)
        ? {
            latestLicenseContentHash: optionalString(
              latestStats.licenseContentHash
            ),
          }
        : {}),
      ...(previousTreeExercises === undefined ? {} : { previousTreeExercises }),
      ...(latestTreeExercises === undefined ? {} : { latestTreeExercises }),
      ...(latestCandidateDelta === undefined ? {} : { latestCandidateDelta }),
      candidateCount: candidates.length,
      pendingCandidateCount: candidates.filter((candidate) =>
        [
          'discovered',
          'drafting',
          'quarantined',
          'validated',
          'approved',
        ].includes(candidate.status)
      ).length,
    };
  }

  async recordDiscoveryFailure(
    actor: string,
    errorCode: string,
    errorMessage: string,
    trigger: 'manual' | 'scheduled' = 'scheduled'
  ): Promise<{ runId: string }> {
    const actorIdentity = actor.trim();
    const code = errorCode.trim().slice(0, 200) || 'discovery_failed';
    const message = errorMessage.trim().slice(0, 2000) || 'Unknown failure.';
    if (!actorIdentity) throw new Error('Discovery failure actor is required.');
    const source = await ensureExercismSource(this.database);
    const runId = `catalog_discovery_failure_${randomUUID()}`;
    const now = new Date();
    await this.database.insert(coachCatalogSyncRun).values({
      id: runId,
      sourceId: source.id,
      trigger,
      status: 'failed',
      statistics: {
        kind: 'discovery',
        actor: actorIdentity.slice(0, 200),
        backlogComplete: false,
        failureRecorded: true,
      },
      errorCode: code,
      errorMessage: message,
      startedAt: now,
      completedAt: now,
    });
    return { runId };
  }

  async bootstrapExercism(
    curatedProblems: RawCatalogProblem[],
    adapter: ExercismCatalogAdapter,
    actor: string
  ): Promise<CatalogBootstrapSummary> {
    const actorIdentity = actor.trim();
    if (!actorIdentity) throw new Error('Catalog bootstrap actor is required.');
    const seedRevisions = [
      ...new Set(
        curatedProblems.map((problem) => problem.origin.sourceRevision)
      ),
    ];
    if (
      seedRevisions.length !== 1 ||
      !/^[a-f0-9]{40}$/.test(seedRevisions[0] ?? '')
    ) {
      throw new Error(
        'Catalog bootstrap requires one full immutable seed commit SHA.'
      );
    }
    const fetched = await adapter.fetchSnapshotAtRevision(
      curatedProblems,
      seedRevisions[0]!
    );
    const snapshot = fetched.snapshot;
    if (!snapshot || fetched.notModified) {
      throw new Error('Catalog bootstrap requires a complete fixed snapshot.');
    }
    if (
      snapshot.licenseSpdx !== snapshot.license.spdx ||
      !isExercismLicenseEvidenceValid(snapshot.license)
    ) {
      throw new Error('Catalog bootstrap snapshot license is not allowed.');
    }
    const localContentFingerprint =
      calculateCatalogContentFingerprint(curatedProblems);
    if (snapshot.localContentFingerprint !== localContentFingerprint) {
      throw new Error('Catalog bootstrap local content fingerprint is stale.');
    }
    const upstreamByExternalId = new Map(
      snapshot.problems.map((problem) => [problem.externalId, problem])
    );
    if (
      upstreamByExternalId.size !== curatedProblems.length ||
      curatedProblems.some(
        (problem) => !upstreamByExternalId.has(problem.origin.externalId)
      )
    ) {
      throw new Error(
        'Catalog bootstrap snapshot does not cover the curated set.'
      );
    }
    const runId = stableId(
      'catalog_bootstrap',
      snapshot.revision,
      localContentFingerprint
    );

    return this.database.transaction(async (tx) => {
      const source = await ensureExercismSource(tx);
      const origins = await tx
        .select()
        .from(coachProblemOrigin)
        .where(eq(coachProblemOrigin.sourceId, source.id));
      if (origins.length !== curatedProblems.length) {
        throw new Error(
          `Catalog bootstrap expected ${curatedProblems.length} origins but found ${origins.length}.`
        );
      }
      const originByExternalId = new Map(
        origins.map((origin) => [origin.externalId, origin])
      );
      for (const localProblem of curatedProblems) {
        const upstream = upstreamByExternalId.get(
          localProblem.origin.externalId
        );
        const origin = originByExternalId.get(localProblem.origin.externalId);
        if (!upstream || !origin) {
          throw new Error(
            `Catalog bootstrap source mismatch: ${localProblem.origin.externalId}`
          );
        }
        const expectedHash = localProblem.origin.contentHash;
        const [problem] = await tx
          .select()
          .from(coachProblem)
          .where(eq(coachProblem.id, origin.problemId))
          .limit(1);
        if (!problem?.currentRevisionId || problem.status !== 'published') {
          throw new Error(
            `Catalog bootstrap problem is not published: ${localProblem.origin.externalId}`
          );
        }
        const [revision] = await tx
          .select()
          .from(coachProblemRevision)
          .where(eq(coachProblemRevision.id, problem.currentRevisionId))
          .limit(1);
        if (
          !revision ||
          revision.problemId !== problem.id ||
          revision.status !== 'published' ||
          revision.contentHash !== expectedHash ||
          revision.sourceRevision !== snapshot.revision ||
          origin.contentHash !== expectedHash ||
          origin.sourceRevision !== snapshot.revision ||
          origin.upstreamUrl !== upstream.upstreamUrl ||
          origin.licenseSpdx !== snapshot.licenseSpdx ||
          localProblem.origin.statementPath !== upstream.statementPath
        ) {
          throw new Error(
            `Catalog bootstrap evidence mismatch: ${localProblem.origin.externalId}`
          );
        }
      }

      const inserted = await tx
        .insert(coachCatalogSyncRun)
        .values({
          id: runId,
          sourceId: source.id,
          trigger: 'manual',
          status: 'succeeded',
          upstreamRevision: snapshot.revision,
          cursor: fetched.etag ?? snapshot.etag,
          statistics: {
            kind: 'bootstrap',
            actor: actorIdentity,
            verified: curatedProblems.length,
            localContentFingerprint,
            license: snapshot.license,
            baselineHashes: curatedProblems.map((problem) => {
              const upstreamProblem = upstreamByExternalId.get(
                problem.origin.externalId
              )!;
              return {
                externalId: problem.origin.externalId,
                publishedContentHash: problem.origin.contentHash,
                combinedContentHash: calculateCandidateContentHash(
                  problem,
                  upstreamProblem
                ),
                statementPath: upstreamProblem.statementPath,
                statementHash: upstreamProblem.statementHash,
                statementBlobSha: upstreamProblem.statementBlobSha,
                canonicalPath: upstreamProblem.canonicalPath,
                ...(upstreamProblem.canonicalBlobSha
                  ? { canonicalBlobSha: upstreamProblem.canonicalBlobSha }
                  : {}),
              };
            }),
          },
          startedAt: new Date(snapshot.fetchedAt),
          completedAt: new Date(),
        })
        .onConflictDoNothing({ target: coachCatalogSyncRun.id })
        .returning({ id: coachCatalogSyncRun.id });
      await tx
        .update(coachCatalogSource)
        .set({
          lastSuccessfulRevision: snapshot.revision,
          updatedAt: new Date(),
        })
        .where(eq(coachCatalogSource.id, source.id));
      return {
        runId,
        revision: snapshot.revision,
        etag: fetched.etag ?? snapshot.etag,
        localContentFingerprint,
        baselined: inserted.length > 0 ? curatedProblems.length : 0,
        alreadyBaselined: inserted.length > 0 ? 0 : curatedProblems.length,
      };
    });
  }

  async ingestDiscoveryReport(
    report: ExercismDiscoveryReport,
    actor = 'catalog-sync'
  ): Promise<CatalogDiscoveryIngestionSummary> {
    if (
      report.schemaVersion !== 1 ||
      report.notModified !== false ||
      report.repository !== 'exercism/problem-specifications' ||
      report.license.spdx !== 'MIT' ||
      !report.license.text.trim() ||
      sha256(report.license.text) !== report.license.contentHash ||
      calculateGitBlobSha(report.license.text) !== report.license.gitBlobSha ||
      !/^[a-f0-9]{40}$/.test(report.license.gitBlobSha) ||
      !/^sha256:[a-f0-9]{64}$/.test(report.license.contentHash) ||
      !/^[a-f0-9]{40}$/.test(report.revision)
    ) {
      throw new Error('Exercism discovery report provenance is invalid.');
    }
    const reportHash = jsonHash(report);
    const runId = stableId('catalog_discovery', report.revision, reportHash);
    const outcome = await this.database.transaction(async (tx) => {
      const source = await ensureExercismSource(tx);
      await tx
        .insert(coachCatalogSyncRun)
        .values({
          id: runId,
          sourceId: source.id,
          trigger: 'manual',
          status: 'running',
          upstreamRevision: report.revision,
          cursor: report.etag,
          statistics: {
            kind: 'discovery',
            actor,
            generatorId: report.generatorId,
            reportHash,
          },
          startedAt: new Date(),
        })
        .onConflictDoNothing({ target: coachCatalogSyncRun.id });

      const candidateIds: string[] = [];
      const quarantined: string[] = [];
      const rejected: string[] = [];
      const aiDraftFailures: Array<{
        candidateId: string;
        reason: NonNullable<ExercismDiscoveryDraft['aiFailureReason']>;
      }> = [];
      let duplicates = 0;
      for (const discoveryDraft of report.drafts) {
        assertDiscoveryDraftBoundary(discoveryDraft, {
          repository: report.repository,
          revision: report.revision,
          licenseSpdx: report.license.spdx,
          licenseText: report.license.text,
          licenseGitBlobSha: report.license.gitBlobSha,
          licenseContentHash: report.license.contentHash,
          exercise: discoveryDraft.upstream,
        });
        if (
          discoveryDraft.schemaVersion !== 1 ||
          discoveryDraft.publishable !== false ||
          discoveryDraft.source.revision !== report.revision ||
          discoveryDraft.source.licenseSpdx !== 'MIT' ||
          discoveryDraft.source.licenseContentHash !==
            report.license.contentHash ||
          discoveryDraft.source.licenseText !== report.license.text ||
          discoveryDraft.source.licenseGitBlobSha !==
            report.license.gitBlobSha ||
          !/^[a-f0-9]{40}$/.test(discoveryDraft.source.statementBlobSha) ||
          (discoveryDraft.source.canonicalBlobSha !== undefined &&
            !/^[a-f0-9]{40}$/.test(discoveryDraft.source.canonicalBlobSha)) ||
          !/^sha256:[a-f0-9]{64}$/.test(discoveryDraft.source.statementHash) ||
          !/^sha256:[a-f0-9]{64}$/.test(
            discoveryDraft.source.canonicalDataHash
          ) ||
          calculateDiscoveryContentHash({
            externalId: discoveryDraft.externalId,
            revision: discoveryDraft.source.revision,
            statementHash: discoveryDraft.source.statementHash,
            statementBlobSha: discoveryDraft.source.statementBlobSha,
            canonicalDataHash: discoveryDraft.source.canonicalDataHash,
            canonicalBlobSha: discoveryDraft.source.canonicalBlobSha,
            licenseGitBlobSha: discoveryDraft.source.licenseGitBlobSha,
            licenseContentHash: discoveryDraft.source.licenseContentHash,
          }) !== discoveryDraft.discoveryContentHash ||
          !discoveryDraft.source.attribution.trim() ||
          discoveryDraft.upstream.externalId !== discoveryDraft.externalId ||
          discoveryDraft.upstream.upstreamUrl !==
            discoveryDraft.source.upstreamUrl ||
          discoveryDraft.upstream.statementPath !==
            discoveryDraft.source.statementPath ||
          discoveryDraft.upstream.statementHash !==
            discoveryDraft.source.statementHash ||
          sha256(discoveryDraft.upstream.statementMarkdown) !==
            discoveryDraft.source.statementHash ||
          calculateGitBlobSha(discoveryDraft.upstream.statementMarkdown) !==
            discoveryDraft.source.statementBlobSha ||
          discoveryDraft.upstream.statementBlobSha !==
            discoveryDraft.source.statementBlobSha ||
          discoveryDraft.upstream.canonicalPath !==
            discoveryDraft.source.canonicalPath ||
          discoveryDraft.upstream.canonicalDataHash !==
            discoveryDraft.source.canonicalDataHash ||
          calculateCanonicalDataHash(discoveryDraft.upstream.canonicalData) !==
            discoveryDraft.source.canonicalDataHash ||
          discoveryDraft.upstream.canonicalBlobSha !==
            discoveryDraft.source.canonicalBlobSha ||
          (discoveryDraft.upstream.canonicalDataStatus === 'available' &&
            !discoveryDraft.upstream.canonicalBlobSha) ||
          (discoveryDraft.upstream.canonicalDataStatus === 'missing' &&
            (discoveryDraft.upstream.canonicalBlobSha !== undefined ||
              discoveryDraft.upstream.canonicalData !== null)) ||
          (discoveryDraft.aiMetadata !== undefined &&
            ((discoveryDraft.aiMetadata.provider !== 'ai-relay' &&
              discoveryDraft.aiMetadata.provider !== 'openrouter') ||
              !isValidCoachModelId(discoveryDraft.aiMetadata.model) ||
              (discoveryDraft.aiMetadata.attempts !== undefined &&
                (!Number.isInteger(discoveryDraft.aiMetadata.attempts) ||
                  discoveryDraft.aiMetadata.attempts <= 0 ||
                  discoveryDraft.aiMetadata.attempts > 4)) ||
              (discoveryDraft.aiMetadata.fallbackFrom !== undefined &&
                (!isValidCoachModelId(discoveryDraft.aiMetadata.fallbackFrom) ||
                  discoveryDraft.aiMetadata.fallbackFrom ===
                    discoveryDraft.aiMetadata.model)) ||
              discoveryDraft.aiMetadata.promptVersion !==
                CATALOG_AI_DRAFT_PROMPT_VERSION ||
              !AI_FINISH_REASONS.has(discoveryDraft.aiMetadata.finishReason) ||
              !/^sha256:[a-f0-9]{64}$/.test(
                discoveryDraft.aiMetadata.inputHash
              ) ||
              !/^sha256:[a-f0-9]{64}$/.test(
                discoveryDraft.aiMetadata.outputHash
              ) ||
              !Number.isInteger(discoveryDraft.aiMetadata.latencyMs) ||
              discoveryDraft.aiMetadata.latencyMs < 0 ||
              (discoveryDraft.aiMetadata.inputTokens !== undefined &&
                (!Number.isInteger(discoveryDraft.aiMetadata.inputTokens) ||
                  discoveryDraft.aiMetadata.inputTokens < 0)) ||
              (discoveryDraft.aiMetadata.outputTokens !== undefined &&
                (!Number.isInteger(discoveryDraft.aiMetadata.outputTokens) ||
                  discoveryDraft.aiMetadata.outputTokens < 0)) ||
              (discoveryDraft.aiMetadata.estimatedCostUsd !== undefined &&
                (!Number.isFinite(discoveryDraft.aiMetadata.estimatedCostUsd) ||
                  discoveryDraft.aiMetadata.estimatedCostUsd < 0)))) ||
          (discoveryDraft.aiFailureMetadata !== undefined &&
            (discoveryDraft.aiFailureReason === undefined ||
              !Number.isInteger(discoveryDraft.aiFailureMetadata.attempts) ||
              discoveryDraft.aiFailureMetadata.attempts <= 0 ||
              discoveryDraft.aiFailureMetadata.attempts > 4 ||
              discoveryDraft.aiFailureMetadata.models.length !==
                discoveryDraft.aiFailureMetadata.attempts ||
              !discoveryDraft.aiFailureMetadata.models.every(
                isValidCoachModelId
              ) ||
              !Number.isInteger(discoveryDraft.aiFailureMetadata.latencyMs) ||
              discoveryDraft.aiFailureMetadata.latencyMs < 0 ||
              !Number.isFinite(
                discoveryDraft.aiFailureMetadata.reservedCostUsd
              ) ||
              discoveryDraft.aiFailureMetadata.reservedCostUsd < 0))
        ) {
          throw new Error(
            `Discovery draft provenance is invalid: ${discoveryDraft.externalId}`
          );
        }
        const rawContentHash = discoveryDraft.discoveryContentHash;
        if (
          await hasEquivalentRawEvidence(
            tx,
            source.id,
            discoveryDraft.externalId,
            rawContentHash
          )
        ) {
          duplicates += 1;
          continue;
        }
        const candidateId = stableId(
          'catalog_candidate',
          source.id,
          discoveryDraft.externalId,
          rawContentHash
        );
        const [origin] = await tx
          .select({ problemId: coachProblemOrigin.problemId })
          .from(coachProblemOrigin)
          .where(
            and(
              eq(coachProblemOrigin.sourceId, source.id),
              eq(coachProblemOrigin.externalId, discoveryDraft.externalId)
            )
          )
          .limit(1);
        const status =
          discoveryDraft.status === 'rejected'
            ? ('rejected' as const)
            : ('quarantined' as const);
        const draftHash = jsonHash(discoveryDraft.proposed);
        const inserted = await tx
          .insert(coachProblemCandidate)
          .values({
            id: candidateId,
            sourceId: source.id,
            syncRunId: runId,
            externalId: discoveryDraft.externalId,
            upstreamUrl: discoveryDraft.source.upstreamUrl,
            sourceRevision: discoveryDraft.source.revision,
            contentHash: rawContentHash,
            licenseSpdx: discoveryDraft.source.licenseSpdx,
            attribution: discoveryDraft.source.attribution,
            rawPayload: discoveryDraft,
            rawContentHash,
            draft: discoveryDraft.proposed,
            draftHash,
            draftRevision: 1,
            policyVersion: CATALOG_POLICY_VERSION,
            changeKind: origin ? 'content_update' : 'new',
            targetProblemId: origin?.problemId,
            normalizedProblem: {
              schemaVersion: 1,
              discoveryDraft,
              publishable: false,
            },
            validation: {
              valid: false,
              issues: [
                {
                  code:
                    status === 'rejected'
                      ? 'invalid_upstream_data'
                      : 'manual_review_required',
                  message:
                    status === 'rejected'
                      ? discoveryDraft.warnings.join(' ')
                      : 'Discovery drafts require human normalization and executable tests.',
                },
              ],
            },
            status,
            rejectionReason:
              status === 'rejected'
                ? discoveryDraft.warnings.join(',').slice(0, 2000)
                : null,
          })
          .onConflictDoNothing({
            target: [
              coachProblemCandidate.sourceId,
              coachProblemCandidate.externalId,
              coachProblemCandidate.rawContentHash,
            ],
          })
          .returning({ id: coachProblemCandidate.id });
        if (inserted.length === 0) {
          duplicates += 1;
          continue;
        }
        candidateIds.push(candidateId);
        (status === 'rejected' ? rejected : quarantined).push(candidateId);
        const aiDraftFailed = discoveryDraft.aiFailureReason !== undefined;
        if (discoveryDraft.aiFailureReason) {
          aiDraftFailures.push({
            candidateId,
            reason: discoveryDraft.aiFailureReason,
          });
        }
        await tx.insert(coachCatalogReviewAudit).values({
          id: `catalog_audit_${randomUUID()}`,
          candidateId,
          action: 'submitted',
          contentHash: rawContentHash,
          sourceRevision: report.revision,
          draftHash,
          draftRevision: 1,
          policyVersion: CATALOG_POLICY_VERSION,
          metadata: {
            stage: 'discovery',
            actor,
            generatorId: report.generatorId,
            status,
            reportHash,
            aiDraftOutcome: discoveryDraft.aiMetadata
              ? 'generated'
              : aiDraftFailed
                ? 'failed_fallback'
                : 'not_requested',
            ...(aiDraftFailed
              ? {
                  aiFailureCode: `catalog_ai_${discoveryDraft.aiFailureReason}`,
                  aiFailureReason: discoveryDraft.aiFailureReason,
                  ...(discoveryDraft.aiFailureMetadata
                    ? {
                        aiFailureMetadata: discoveryDraft.aiFailureMetadata,
                      }
                    : {}),
                }
              : {}),
          },
        });
        if (discoveryDraft.aiMetadata) {
          const ai = discoveryDraft.aiMetadata;
          await tx.insert(coachCatalogAiGeneration).values({
            id: stableId(
              'catalog_ai',
              candidateId,
              ai.promptVersion,
              ai.outputHash
            ),
            candidateId,
            actorUserId: null,
            kind: 'review_summary',
            provider: ai.provider,
            model: ai.model,
            promptVersion: ai.promptVersion,
            inputHash: ai.inputHash,
            outputHash: ai.outputHash,
            status: 'generated',
            metadata: {
              generatorId: report.generatorId,
              reportHash,
              nonPublishable: true,
              finishReason: ai.finishReason,
              attempts: ai.attempts ?? 1,
              ...(ai.fallbackFrom ? { fallbackFrom: ai.fallbackFrom } : {}),
              latencyMs: ai.latencyMs,
              ...(ai.inputTokens === undefined
                ? {}
                : { inputTokens: ai.inputTokens }),
              ...(ai.outputTokens === undefined
                ? {}
                : { outputTokens: ai.outputTokens }),
              ...(ai.estimatedCostUsd === undefined
                ? {}
                : { estimatedCostUsd: ai.estimatedCostUsd }),
            },
          });
        }
      }
      await tx
        .update(coachCatalogSyncRun)
        .set({
          status:
            rejected.length > 0 || report.counts.selectionTruncated
              ? 'partial'
              : 'succeeded',
          cursor: report.etag,
          statistics: {
            kind: 'discovery',
            actor,
            generatorId: report.generatorId,
            reportHash,
            etag: report.etag,
            backlogComplete: !report.counts.selectionTruncated,
            selectionTruncated: report.counts.selectionTruncated,
            treeExercises: report.counts.treeExercises,
            knownExercises: report.counts.knownExercises,
            newExercises: report.counts.newExercises,
            changedExercises: report.counts.changedExercises,
            unchangedExercises: report.counts.unchangedExercises,
            candidateBacklog: report.counts.undiscoveredExercises,
            undiscoveredExercises: report.counts.undiscoveredExercises,
            licenseSpdx: report.license.spdx,
            licenseContentHash: report.license.contentHash,
            licenseGitBlobSha: report.license.gitBlobSha,
            discovered: candidateIds.length,
            duplicates,
            quarantined: quarantined.length,
            rejected: rejected.length,
          },
          completedAt: new Date(),
        })
        .where(eq(coachCatalogSyncRun.id, runId));
      await tx
        .update(coachCatalogSource)
        .set({
          lastSuccessfulRevision: report.revision,
          updatedAt: new Date(),
        })
        .where(eq(coachCatalogSource.id, source.id));
      return {
        summary: {
          ingested: candidateIds.length,
          alreadyPresent: duplicates,
          candidateIds,
          discovered: candidateIds.length,
          duplicates,
          quarantined,
          rejected,
        },
        aiDraftFailures,
      };
    });
    for (const failure of outcome.aiDraftFailures) {
      emitCatalogOperationalEvent('catalog_ai_draft_failed', {
        mode: 'database',
        outcome: 'failed',
        candidateId: failure.candidateId,
        errorCode: failure.reason,
      });
    }
    return outcome.summary;
  }

  async syncExercism(
    curatedProblems: RawCatalogProblem[],
    adapter: ExercismCatalogAdapter,
    trigger: 'manual' | 'scheduled' = 'manual'
  ): Promise<DatabaseSyncSummary> {
    const source = await ensureExercismSource(this.database);
    if (source.status === 'disabled') {
      throw new Error('The Exercism catalog source is disabled.');
    }
    if (
      trigger === 'scheduled' &&
      (!source.syncEnabled || source.status !== 'active')
    ) {
      throw new Error('Scheduled Exercism synchronization is paused.');
    }
    const runId = `catalog_sync_${randomUUID()}`;
    const startedAt = new Date();
    await this.database.insert(coachCatalogSyncRun).values({
      id: runId,
      sourceId: source.id,
      trigger,
      status: 'running',
      startedAt,
    });

    try {
      const previous = await this.sourceState();
      const fetched = await adapter.fetchSnapshot(curatedProblems, previous);
      let candidateIds: string[] = [];
      const completedAt = new Date();
      await this.database.transaction(async (tx) => {
        candidateIds = fetched.snapshot
          ? await this.persistSnapshot(
              tx,
              source.id,
              runId,
              fetched.snapshot,
              curatedProblems
            )
          : [];
        await tx
          .update(coachCatalogSyncRun)
          .set({
            status: 'succeeded',
            upstreamRevision: fetched.revision ?? previous.revision,
            cursor: fetched.etag ?? previous.etag,
            statistics: {
              kind: 'sync',
              discovered: candidateIds.length,
              notModified: fetched.notModified,
              localContentFingerprint: fetched.localContentFingerprint,
              ...(fetched.snapshot
                ? {
                    licenseSpdx: fetched.snapshot.license.spdx,
                    licenseContentHash: fetched.snapshot.license.contentHash,
                    licenseGitBlobSha: fetched.snapshot.license.gitBlobSha,
                  }
                : {}),
            },
            completedAt,
          })
          .where(eq(coachCatalogSyncRun.id, runId));
        if (fetched.revision ?? previous.revision) {
          await tx
            .update(coachCatalogSource)
            .set({
              lastSuccessfulRevision: fetched.revision ?? previous.revision,
              updatedAt: completedAt,
            })
            .where(eq(coachCatalogSource.id, source.id));
        }
      });
      const result = {
        runId,
        revision: fetched.revision ?? previous.revision,
        etag: fetched.etag ?? previous.etag,
        localContentFingerprint: fetched.localContentFingerprint,
        notModified: fetched.notModified,
        discovered: candidateIds.length,
        candidateIds,
      };
      emitCatalogOperationalEvent('catalog_sync_completed', {
        mode: 'database',
        outcome: 'succeeded',
        runId,
        revision: result.revision,
        discovered: result.discovered,
        notModified: result.notModified,
      });
      return result;
    } catch (error) {
      await this.database
        .update(coachCatalogSyncRun)
        .set({
          status: 'failed',
          errorCode: 'upstream_sync_failed',
          errorMessage:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : String(error),
          completedAt: new Date(),
        })
        .where(eq(coachCatalogSyncRun.id, runId));
      emitCatalogOperationalEvent('catalog_sync_completed', {
        mode: 'database',
        outcome: 'failed',
        runId,
        discovered: 0,
        errorCode: 'upstream_sync_failed',
      });
      throw error;
    }
  }

  private async persistSnapshot(
    tx: CatalogTransaction,
    sourceId: string,
    runId: string,
    snapshot: ExercismSnapshot,
    curatedProblems: RawCatalogProblem[]
  ): Promise<string[]> {
    if (
      snapshot.licenseSpdx !== snapshot.license.spdx ||
      !isExercismLicenseEvidenceValid(snapshot.license)
    ) {
      throw new Error('Catalog snapshot license is not allowed.');
    }
    if (
      snapshot.localContentFingerprint !==
      calculateCatalogContentFingerprint(curatedProblems)
    ) {
      throw new Error('Catalog snapshot local content fingerprint is stale.');
    }
    const curatedByExternalId = new Map(
      curatedProblems.map((problem) => [problem.origin.externalId, problem])
    );
    const candidateIds: string[] = [];
    for (const upstream of snapshot.problems) {
      const problem = curatedByExternalId.get(upstream.externalId);
      if (!problem) continue;
      const contentHash = calculateCandidateContentHash(problem, upstream);
      const id = stableId(
        'catalog_candidate',
        sourceId,
        upstream.externalId,
        contentHash
      );
      const versionedProblem: RawCatalogProblem = {
        ...problem,
        origin: {
          ...problem.origin,
          upstreamUrl: upstream.upstreamUrl,
          sourceRevision: snapshot.revision,
        },
      };
      const payload: CandidatePayload = {
        problem: versionedProblem,
        upstream,
      };
      if (
        calculateGitBlobSha(upstream.statementMarkdown) !==
          upstream.statementBlobSha ||
        !/^[a-f0-9]{40}$/.test(upstream.statementBlobSha) ||
        !/^exercises\/[a-z0-9]+(?:-[a-z0-9]+)*\/canonical-data\.json$/.test(
          upstream.canonicalPath
        ) ||
        (upstream.canonicalBlobSha !== undefined &&
          !/^[a-f0-9]{40}$/.test(upstream.canonicalBlobSha))
      ) {
        throw new Error(
          `Catalog upstream blob evidence is invalid: ${upstream.externalId}`
        );
      }
      const rawPayload = {
        schemaVersion: 1,
        evidenceKind: 'legacy_sync',
        source: {
          provider: 'exercism',
          repository: snapshot.repository,
          revision: snapshot.revision,
          upstreamUrl: upstream.upstreamUrl,
          statementPath: upstream.statementPath,
          statementHash: upstream.statementHash,
          statementBlobSha: upstream.statementBlobSha,
          canonicalPath: upstream.canonicalPath,
          canonicalDataHash: upstream.canonicalDataHash,
          ...(upstream.canonicalBlobSha
            ? { canonicalBlobSha: upstream.canonicalBlobSha }
            : {}),
          licenseSpdx: snapshot.license.spdx,
          licenseText: snapshot.license.text,
          licenseGitBlobSha: snapshot.license.gitBlobSha,
          licenseContentHash: snapshot.license.contentHash,
          attribution: problem.origin.attribution,
        },
        upstream,
      };
      const rawContentHash = calculateCatalogRawEvidenceHash({
        externalId: upstream.externalId,
        statementHash: upstream.statementHash,
        statementBlobSha: upstream.statementBlobSha,
        canonicalDataHash: upstream.canonicalDataHash,
        canonicalBlobSha: upstream.canonicalBlobSha,
        licenseGitBlobSha: snapshot.license.gitBlobSha,
        licenseContentHash: snapshot.license.contentHash,
      });
      if (
        await hasEquivalentRawEvidence(
          tx,
          sourceId,
          upstream.externalId,
          rawContentHash
        )
      ) {
        continue;
      }
      const [existingOrigin] = await tx
        .select({ problemId: coachProblemOrigin.problemId })
        .from(coachProblemOrigin)
        .where(
          and(
            eq(coachProblemOrigin.sourceId, sourceId),
            eq(coachProblemOrigin.externalId, upstream.externalId)
          )
        )
        .limit(1);
      const inserted = await tx
        .insert(coachProblemCandidate)
        .values({
          id,
          sourceId,
          syncRunId: runId,
          externalId: upstream.externalId,
          upstreamUrl: upstream.upstreamUrl,
          sourceRevision: snapshot.revision,
          contentHash,
          licenseSpdx: snapshot.licenseSpdx,
          attribution: problem.origin.attribution,
          rawPayload,
          rawContentHash,
          draft: versionedProblem,
          draftHash: jsonHash(versionedProblem),
          draftRevision: 1,
          policyVersion: CATALOG_POLICY_VERSION,
          changeKind: existingOrigin ? 'content_update' : 'new',
          targetProblemId: existingOrigin?.problemId,
          normalizedProblem: payload,
          validation: {},
          status: 'discovered',
        })
        .onConflictDoNothing({
          target: [
            coachProblemCandidate.sourceId,
            coachProblemCandidate.externalId,
            coachProblemCandidate.rawContentHash,
          ],
        })
        .returning({ id: coachProblemCandidate.id });
      if (inserted.length > 0) {
        candidateIds.push(id);
        await tx.insert(coachCatalogReviewAudit).values({
          id: `catalog_audit_${randomUUID()}`,
          candidateId: id,
          action: 'submitted',
          contentHash,
          sourceRevision: snapshot.revision,
          draftHash: jsonHash(versionedProblem),
          draftRevision: 1,
          policyVersion: CATALOG_POLICY_VERSION,
          metadata: { stage: 'sync', externalId: upstream.externalId },
        });
      }
    }
    return candidateIds;
  }

  async validateCandidates(
    candidateIds?: string[],
    capability: 'sync' | 'reviewer' = 'sync',
    expectedDraftRevision?: number
  ): Promise<DatabaseValidationSummary> {
    const outcome = await this.database.transaction(async (tx) => {
      if (capability === 'reviewer') {
        await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      }
      const [latestRun] =
        !candidateIds || candidateIds.length === 0
          ? await tx
              .select({ id: coachCatalogSyncRun.id })
              .from(coachCatalogSyncRun)
              .where(
                inArray(coachCatalogSyncRun.status, ['succeeded', 'partial'])
              )
              .orderBy(
                desc(coachCatalogSyncRun.completedAt),
                desc(coachCatalogSyncRun.createdAt)
              )
              .limit(1)
          : [];
      if ((!candidateIds || candidateIds.length === 0) && !latestRun) {
        return {
          summary: {
            checked: 0,
            skipped: 0,
            validated: 0,
            quarantined: 0,
            rejected: 0,
            candidateIds: [],
          },
          rejectedCandidates: [],
        };
      }
      const filters = [
        inArray(coachProblemCandidate.status, [
          'discovered',
          'drafting',
          'quarantined',
        ]),
      ];
      if (candidateIds && candidateIds.length > 0) {
        filters.push(inArray(coachProblemCandidate.id, candidateIds));
      } else if (latestRun) {
        filters.push(eq(coachProblemCandidate.syncRunId, latestRun.id));
      }
      const rows = await tx
        .select()
        .from(coachProblemCandidate)
        .where(and(...filters))
        .for('update');
      if (expectedDraftRevision !== undefined) {
        if (!candidateIds || candidateIds.length !== 1 || rows.length !== 1) {
          throw new Error(
            'Expected draft revision can only validate one eligible candidate.'
          );
        }
        if (rows[0]!.draftRevision !== expectedDraftRevision) {
          throw new Error('Catalog candidate draft revision is stale.');
        }
      }
      const payloads = rows.map((row) => ({
        row,
        payload: candidatePayloadOrUndefined(row.normalizedProblem),
      }));
      const batch = validateCatalogBatch(
        payloads.flatMap(({ payload }) => (payload ? [payload.problem] : []))
      );
      let validated = 0;
      let quarantined = 0;
      let rejected = 0;
      let skipped = 0;
      const rejectedCandidates: Array<{
        candidateId: string;
        issueCodes: string[];
      }> = [];

      for (const { row, payload } of payloads) {
        const fingerprint = validationFingerprint(row);
        if (
          capability === 'sync' &&
          (!candidateIds || candidateIds.length === 0) &&
          expectedDraftRevision === undefined &&
          persistedValidationFingerprint(row.validation) === fingerprint
        ) {
          skipped += 1;
          continue;
        }
        if (!payload) {
          const validation: CatalogValidationResult = {
            valid: false,
            issues: [
              {
                code: 'manual_review_required',
                message:
                  'The discovery draft is intentionally incomplete and must be normalized by a human reviewer.',
                path: 'draft',
              },
            ],
            fingerprint,
            policyVersion: row.policyVersion,
            runnerVersion: CATALOG_RUNNER_VALIDATION_VERSION,
          };
          quarantined += 1;
          await tx
            .update(coachProblemCandidate)
            .set({
              validation,
              status: 'quarantined',
              rejectionReason: null,
              updatedAt: new Date(),
            })
            .where(eq(coachProblemCandidate.id, row.id));
          await tx.insert(coachCatalogReviewAudit).values({
            id: `catalog_audit_${randomUUID()}`,
            candidateId: row.id,
            action: 'submitted',
            contentHash: row.contentHash,
            sourceRevision: row.sourceRevision,
            draftHash: row.draftHash,
            draftRevision: row.draftRevision,
            policyVersion: row.policyVersion,
            metadata: { status: 'quarantined', validation },
          });
          continue;
        }
        const base = batch.get(payload.problem.slug) ?? {
          valid: false,
          issues: [
            {
              code: 'invalid_problem' as const,
              message: 'Candidate was not present in the validation batch.',
            },
          ],
        };
        const persistedIssues: CatalogValidationResult['issues'] = [];
        persistedIssues.push(
          ...candidateLicenseEvidenceIssues(row),
          ...candidateTestProvenanceIssues(row, payload.problem)
        );
        persistedIssues.push(
          ...(await priorTestEvidenceIssues(tx, row, payload.problem))
        );
        persistedIssues.push(
          ...(await duplicateCatalogIdentityIssues(tx, row, payload.problem))
        );
        try {
          assertCandidatePayloadMatchesRawEvidence(row, payload);
        } catch {
          persistedIssues.push({
            code: 'invalid_origin',
            message:
              'Candidate payload does not match immutable upstream evidence.',
            path: 'rawPayload',
          });
        }
        if (row.licenseSpdx !== 'MIT') {
          persistedIssues.push({
            code: 'invalid_license',
            message: `Persisted license ${row.licenseSpdx} is not allowed.`,
            path: 'licenseSpdx',
          });
        }
        if (
          row.externalId !== payload.problem.origin.externalId ||
          row.sourceRevision !== payload.problem.origin.sourceRevision ||
          row.upstreamUrl !== payload.upstream.upstreamUrl ||
          row.contentHash !==
            calculateCandidateContentHash(payload.problem, payload.upstream)
        ) {
          persistedIssues.push({
            code:
              row.contentHash !==
              calculateCandidateContentHash(payload.problem, payload.upstream)
                ? 'invalid_content_hash'
                : 'invalid_origin',
            message:
              'Persisted candidate provenance or hash does not match its payload.',
            path: 'normalizedProblem',
          });
        }
        const staticValidation = mergeCatalogValidationResults(
          base,
          validateCandidatePayload(
            payload.problem,
            payload.upstream,
            row.contentHash
          ),
          {
            valid: persistedIssues.length === 0,
            issues: persistedIssues,
          }
        );
        const validationResult = staticValidation.valid
          ? mergeCatalogValidationResults(
              staticValidation,
              await validateRunnerCompatibility(payload.problem)
            )
          : staticValidation;
        const validation: CatalogValidationResult = {
          ...validationResult,
          fingerprint,
          policyVersion: row.policyVersion,
          runnerVersion: CATALOG_RUNNER_VALIDATION_VERSION,
        };
        const status =
          row.status === 'drafting'
            ? ('quarantined' as const)
            : candidateStateForValidation(validation);
        if (validation.valid) validated += 1;
        else if (status === 'rejected') {
          rejected += 1;
          rejectedCandidates.push({
            candidateId: row.id,
            issueCodes: [
              ...new Set(validation.issues.map((item) => item.code)),
            ],
          });
        } else quarantined += 1;
        await tx
          .update(coachProblemCandidate)
          .set({
            validation,
            status,
            rejectionReason:
              status === 'rejected'
                ? [...new Set(validation.issues.map((item) => item.code))].join(
                    ','
                  )
                : null,
            updatedAt: new Date(),
          })
          .where(eq(coachProblemCandidate.id, row.id));
        await tx.insert(coachCatalogReviewAudit).values({
          id: `catalog_audit_${randomUUID()}`,
          candidateId: row.id,
          action: 'submitted',
          contentHash: row.contentHash,
          sourceRevision: row.sourceRevision,
          draftHash: row.draftHash,
          draftRevision: row.draftRevision,
          policyVersion: row.policyVersion,
          metadata: { status, validation },
        });
      }
      return {
        summary: {
          checked: rows.length - skipped,
          skipped,
          validated,
          quarantined,
          rejected,
          candidateIds: rows.map((row) => row.id),
        },
        rejectedCandidates,
      };
    });
    for (const item of outcome.rejectedCandidates) {
      emitCatalogOperationalEvent('catalog_candidate_rejected', {
        mode: 'database',
        outcome: 'rejected',
        candidateId: item.candidateId,
        issueCodes: item.issueCodes,
      });
    }
    return outcome.summary;
  }

  async approveCandidates(
    candidateIds: string[],
    reviewer: string,
    notes?: string,
    expectedDraftRevision?: number
  ): Promise<DatabaseApprovalSummary> {
    const reviewerUserId = actorUserId(reviewer);
    const ids = [...new Set(candidateIds)];
    if (ids.length === 0) throw new Error('No candidate ids were supplied.');

    return this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, REVIEWER_ROLE);
      const candidates = await tx
        .select()
        .from(coachProblemCandidate)
        .where(inArray(coachProblemCandidate.id, ids))
        .for('update');
      if (candidates.length !== ids.length) {
        throw new Error('One or more catalog candidates do not exist.');
      }
      if (
        expectedDraftRevision !== undefined &&
        (ids.length !== 1 ||
          candidates[0]!.draftRevision !== expectedDraftRevision)
      ) {
        throw new Error('Catalog candidate draft revision is stale.');
      }
      if (
        candidates.some(
          (candidate) =>
            !['validated', 'approved', 'published'].includes(candidate.status)
        )
      ) {
        throw new Error(
          'Every catalog candidate must be validated before approval.'
        );
      }

      let approved = 0;
      let alreadyApproved = 0;
      let alreadyPublished = 0;
      for (const candidate of candidates) {
        if (candidate.status === 'published') {
          alreadyPublished += 1;
          continue;
        }
        if (candidate.status === 'approved') {
          alreadyApproved += 1;
          continue;
        }
        await tx
          .update(coachProblemCandidate)
          .set({
            status: 'approved',
            approvedByUserId: reviewerUserId,
            approvedAt: new Date(),
            approvedContentHash: candidate.contentHash,
            approvedSourceRevision: candidate.sourceRevision,
            approvedDraftHash: candidate.draftHash,
            approvedDraftRevision: candidate.draftRevision,
            approvedPolicyVersion: candidate.policyVersion,
            updatedAt: new Date(),
          })
          .where(eq(coachProblemCandidate.id, candidate.id));
        await tx.insert(coachCatalogReviewAudit).values({
          id: `catalog_audit_${randomUUID()}`,
          candidateId: candidate.id,
          reviewerUserId,
          action: 'approved',
          notes:
            notes?.trim().slice(0, 2000) ||
            `Approved by user ${reviewerUserId}`,
          contentHash: candidate.contentHash,
          sourceRevision: candidate.sourceRevision,
          draftHash: candidate.draftHash,
          draftRevision: candidate.draftRevision,
          policyVersion: candidate.policyVersion,
          metadata: { reviewerUserId },
        });
        approved += 1;
      }
      return {
        approved,
        alreadyApproved,
        alreadyPublished,
        candidateIds: ids,
      };
    });
  }

  async publishCandidates(
    candidateIds: string[],
    reviewer: string,
    notes?: string,
    expectedDraftRevision?: number
  ): Promise<DatabasePublishSummary> {
    const publisherUserId = actorUserId(reviewer);
    const ids = [...new Set(candidateIds)];
    if (ids.length === 0) throw new Error('No candidate ids were supplied.');

    const committed = await this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, PUBLISHER_ROLE);
      const candidates = await tx
        .select()
        .from(coachProblemCandidate)
        .where(inArray(coachProblemCandidate.id, ids))
        .for('update');
      if (candidates.length !== ids.length) {
        throw new Error('One or more catalog candidates do not exist.');
      }
      if (
        expectedDraftRevision !== undefined &&
        (ids.length !== 1 ||
          candidates[0]!.draftRevision !== expectedDraftRevision)
      ) {
        throw new Error('Catalog candidate draft revision is stale.');
      }
      if (
        candidates.some(
          (candidate) =>
            candidate.status !== 'approved' && candidate.status !== 'published'
        )
      ) {
        throw new Error(
          'Every catalog candidate must be approved before publishing.'
        );
      }
      for (const candidate of candidates) {
        if (candidate.status === 'published') continue;
        if (!candidate.approvedByUserId) {
          throw new Error(
            'Catalog approval does not identify a real reviewer.'
          );
        }
        if (candidate.approvedByUserId === publisherUserId) {
          throw new Error(
            'Catalog approver and publisher must be different users.'
          );
        }
        if (
          candidate.approvedContentHash !== candidate.contentHash ||
          candidate.approvedSourceRevision !== candidate.sourceRevision ||
          candidate.approvedDraftHash !== candidate.draftHash ||
          candidate.approvedDraftRevision !== candidate.draftRevision ||
          candidate.approvedPolicyVersion !== candidate.policyVersion
        ) {
          throw new Error('Catalog approval binding is stale.');
        }
      }

      const payloads = candidates.map((candidate) => ({
        candidate,
        payload: candidatePayload(candidate.normalizedProblem),
      }));
      const batch = validateCatalogBatch(
        payloads.map(({ payload }) => payload.problem)
      );
      const invalid: Array<{
        candidateId: string;
        validation: CatalogValidationResult;
      }> = [];
      for (const { candidate, payload } of payloads) {
        const persistedIssues: CatalogValidationResult['issues'] = [];
        persistedIssues.push(
          ...candidateLicenseEvidenceIssues(candidate),
          ...candidateTestProvenanceIssues(candidate, payload.problem)
        );
        persistedIssues.push(
          ...(await priorTestEvidenceIssues(tx, candidate, payload.problem))
        );
        persistedIssues.push(
          ...(await duplicateCatalogIdentityIssues(
            tx,
            candidate,
            payload.problem
          ))
        );
        try {
          assertCandidatePayloadMatchesRawEvidence(candidate, payload);
        } catch {
          persistedIssues.push({
            code: 'invalid_origin',
            message:
              'Candidate payload does not match immutable upstream evidence.',
            path: 'rawPayload',
          });
        }
        if (candidate.licenseSpdx !== 'MIT') {
          persistedIssues.push({
            code: 'invalid_license',
            message: 'Persisted candidate license is not allowed.',
            path: 'licenseSpdx',
          });
        }
        if (
          candidate.externalId !== payload.problem.origin.externalId ||
          candidate.sourceRevision !== payload.problem.origin.sourceRevision ||
          candidate.upstreamUrl !== payload.upstream.upstreamUrl
        ) {
          persistedIssues.push({
            code: 'invalid_origin',
            message:
              'Persisted candidate provenance does not match its payload.',
            path: 'normalizedProblem',
          });
        }
        const staticValidation = mergeCatalogValidationResults(
          batch.get(payload.problem.slug)!,
          validateCandidatePayload(
            payload.problem,
            payload.upstream,
            candidate.contentHash
          ),
          {
            valid: persistedIssues.length === 0,
            issues: persistedIssues,
          }
        );
        const validation = staticValidation.valid
          ? mergeCatalogValidationResults(
              staticValidation,
              await validateRunnerCompatibility(payload.problem)
            )
          : staticValidation;
        if (!validation.valid) {
          invalid.push({ candidateId: candidate.id, validation });
        }
      }
      if (invalid.length > 0) {
        for (const item of invalid) {
          const issueCodes = [
            ...new Set(item.validation.issues.map((issue) => issue.code)),
          ];
          const targetState = candidateStateForValidation(item.validation);
          await tx
            .update(coachProblemCandidate)
            .set({
              validation: item.validation,
              status: targetState,
              rejectionReason:
                targetState === 'rejected' ? issueCodes.join(',') : null,
              approvedByUserId: null,
              approvedAt: null,
              approvedContentHash: null,
              approvedSourceRevision: null,
              approvedDraftHash: null,
              approvedDraftRevision: null,
              approvedPolicyVersion: null,
              publishedByUserId: null,
              publishedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(coachProblemCandidate.id, item.candidateId));
          await tx.insert(coachCatalogReviewAudit).values({
            id: `catalog_audit_${randomUUID()}`,
            candidateId: item.candidateId,
            reviewerUserId: publisherUserId,
            action: targetState === 'rejected' ? 'rejected' : 'submitted',
            metadata: {
              stage: 'publish',
              status: targetState,
              issueCodes,
            },
          });
        }
        return { kind: 'invalid', invalid } as const;
      }

      const problemSlugs: string[] = [];
      const revisionIds: string[] = [];
      const publishedEvents: Array<{
        outcome: 'published' | 'already_published';
        problemSlug: string;
        revisionId: string;
      }> = [];
      let published = 0;
      let alreadyPublished = 0;
      for (const candidate of candidates) {
        const { problem, upstream } = candidatePayload(
          candidate.normalizedProblem
        );
        const sourceId = candidate.sourceId;
        const sourceEvidence = candidateSourceEvidence(candidate);
        const derivedProblemId = stableId(
          'external_problem',
          sourceId,
          problem.origin.externalId
        );
        const problemId = candidate.targetProblemId ?? derivedProblemId;
        const [existingProblem] = await tx
          .select()
          .from(coachProblem)
          .where(
            candidate.targetProblemId
              ? and(
                  eq(coachProblem.id, candidate.targetProblemId),
                  isNull(coachProblem.ownerUserId)
                )
              : and(
                  eq(coachProblem.slug, problem.slug),
                  isNull(coachProblem.ownerUserId)
                )
          )
          .limit(1)
          .for('update');
        if (
          candidate.targetProblemId &&
          (!existingProblem || existingProblem.source !== 'external')
        ) {
          throw new Error('Catalog association target is no longer valid.');
        }
        if (
          !candidate.targetProblemId &&
          existingProblem &&
          existingProblem.id !== problemId
        ) {
          throw new Error(`Catalog slug is already owned: ${problem.slug}`);
        }
        const publishedSlug = existingProblem?.slug ?? problem.slug;
        const [externalOrigin] = await tx
          .select({ problemId: coachProblemOrigin.problemId })
          .from(coachProblemOrigin)
          .where(
            and(
              eq(coachProblemOrigin.sourceId, sourceId),
              eq(coachProblemOrigin.externalId, candidate.externalId)
            )
          )
          .limit(1);
        if (externalOrigin && externalOrigin.problemId !== problemId) {
          throw new Error(
            'Catalog external origin is already associated with another problem.'
          );
        }
        const [publishedRevision] = await tx
          .select()
          .from(coachProblemRevision)
          .where(
            and(
              eq(coachProblemRevision.problemId, problemId),
              eq(coachProblemRevision.contentHash, candidate.contentHash)
            )
          )
          .limit(1);
        if (candidate.status === 'published') {
          if (!existingProblem || !publishedRevision) {
            throw new Error(
              `Published candidate integrity check failed: ${candidate.id}`
            );
          }
          alreadyPublished += 1;
          problemSlugs.push(publishedSlug);
          revisionIds.push(publishedRevision.id);
          publishedEvents.push({
            outcome: 'already_published',
            problemSlug: publishedSlug,
            revisionId: publishedRevision.id,
          });
          continue;
        }

        if (!existingProblem) {
          await tx.insert(coachProblem).values({
            id: problemId,
            slug: problem.slug,
            source: 'external',
            title: problem.title,
            description: problem.description,
            difficulty: problem.difficulty,
            topics: problem.topics,
            entryPoint: legacyEntryPoint(problem),
            templates: templatesFrom(problem),
            languageConfigs: problem.languageConfigs,
            signature: problem.languageConfigs.javascript.signature,
            examples: [],
            constraints: problem.constraints,
            hints: problem.hints,
            reviewPoints: problem.reviewPoints,
            estimatedMinutes: problem.estimatedMinutes,
            status: 'published',
            sourceStatement: upstream.statementMarkdown,
            sourceUrl: problem.origin.upstreamUrl,
            contentVersion: 1,
          });
        }

        let revision = publishedRevision;
        if (!revision) {
          const [latest] = await tx
            .select({ value: max(coachProblemRevision.version) })
            .from(coachProblemRevision)
            .where(eq(coachProblemRevision.problemId, problemId));
          const version = (latest?.value ?? 0) + 1;
          const revisionId = stableId(
            'problem_revision',
            problemId,
            String(version)
          );
          [revision] = await tx
            .insert(coachProblemRevision)
            .values({
              id: revisionId,
              problemId,
              version,
              title: problem.title,
              description: problem.description,
              difficulty: problem.difficulty,
              topics: problem.topics,
              entryPoint: legacyEntryPoint(problem),
              templates: templatesFrom(problem),
              languageConfigs: problem.languageConfigs,
              signature: problem.languageConfigs.javascript.signature,
              examples: [],
              constraints: problem.constraints,
              hints: problem.hints,
              reviewPoints: problem.reviewPoints,
              learningObjectives: problem.learningObjectives ?? [],
              prerequisiteTopics: problem.prerequisiteTopics ?? [],
              solutionPatterns: problem.solutionPatterns ?? [],
              estimatedMinutes: problem.estimatedMinutes,
              sourceStatement: upstream.statementMarkdown,
              sourceUrl: problem.origin.upstreamUrl,
              sourceRevision: problem.origin.sourceRevision,
              candidateId: candidate.id,
              catalogSourceId: candidate.sourceId,
              sourceExternalId: candidate.externalId,
              sourceStatementPath: problem.origin.statementPath,
              sourceLicenseSpdx: candidate.licenseSpdx,
              sourceLicenseHash:
                typeof sourceEvidence.licenseContentHash === 'string'
                  ? sourceEvidence.licenseContentHash
                  : null,
              sourceAttribution: candidate.attribution,
              sourceFetchedAt: candidate.createdAt,
              policyVersion: candidate.policyVersion,
              draftRevision: candidate.draftRevision,
              draftHash: candidate.draftHash,
              provenance: {
                candidateId: candidate.id,
                sourceId: candidate.sourceId,
                externalId: candidate.externalId,
                upstreamUrl: candidate.upstreamUrl,
                sourceRevision: candidate.sourceRevision,
                licenseSpdx: candidate.licenseSpdx,
                attribution: candidate.attribution,
                policyVersion: candidate.policyVersion,
                draftRevision: candidate.draftRevision,
                draftHash: candidate.draftHash,
                rawContentHash: candidate.rawContentHash,
                ...(typeof sourceEvidence.licenseText === 'string'
                  ? { licenseText: sourceEvidence.licenseText }
                  : {}),
                ...(typeof sourceEvidence.licenseContentHash === 'string'
                  ? { licenseContentHash: sourceEvidence.licenseContentHash }
                  : {}),
                ...(typeof sourceEvidence.licenseGitBlobSha === 'string'
                  ? { licenseGitBlobSha: sourceEvidence.licenseGitBlobSha }
                  : {}),
              },
              catalogVersion: `exercism@${problem.origin.sourceRevision.slice(
                0,
                12
              )}+${candidate.contentHash.slice(7, 15)}`,
              contentHash: candidate.contentHash,
              status: 'published',
              publishedAt: new Date(),
            })
            .returning();
          await tx.insert(coachTestCase).values(
            problem.tests.map((test, ordinal) => ({
              id: stableId('revision_test', revisionId, test.id),
              problemId,
              revisionId,
              ordinal,
              args: test.args,
              expected: test.expected,
              isSample: test.isSample,
              sourceKind: test.sourceKind ?? 'manual',
              sourceTestUuid:
                test.sourceKind === 'canonical'
                  ? test.sourceTestUuid?.trim()
                  : null,
              reviewNote:
                test.sourceKind === 'manual'
                  ? test.reviewNote?.trim()
                  : test.sourceKind === 'canonical'
                    ? null
                    : `Curated adapter test ${test.id} approved in candidate ${candidate.id} by reviewer ${candidate.approvedByUserId}.`,
            }))
          );
        }
        if (!revision) throw new Error(`Unable to publish ${problem.slug}.`);

        if (
          existingProblem?.currentRevisionId &&
          existingProblem.currentRevisionId !== revision.id
        ) {
          await tx
            .update(coachProblemRevision)
            .set({ status: 'archived' })
            .where(
              eq(coachProblemRevision.id, existingProblem.currentRevisionId)
            );
        }
        await tx
          .update(coachProblemRevision)
          .set({
            status: 'published',
            publishedAt: revision.publishedAt ?? new Date(),
          })
          .where(eq(coachProblemRevision.id, revision.id));
        await tx
          .update(coachProblem)
          .set({
            title: revision.title,
            description: revision.description,
            difficulty: revision.difficulty,
            topics: revision.topics,
            entryPoint: revision.entryPoint,
            templates: revision.templates,
            languageConfigs: revision.languageConfigs,
            signature: revision.signature,
            examples: revision.examples,
            constraints: revision.constraints,
            hints: revision.hints,
            reviewPoints: revision.reviewPoints,
            estimatedMinutes: revision.estimatedMinutes,
            status: 'published',
            sourceStatement: revision.sourceStatement,
            sourceUrl: revision.sourceUrl,
            contentVersion: revision.version,
            currentRevisionId: revision.id,
            updatedAt: new Date(),
          })
          .where(eq(coachProblem.id, problemId));
        const [problemOrigin] = await tx
          .select({ id: coachProblemOrigin.id })
          .from(coachProblemOrigin)
          .where(eq(coachProblemOrigin.problemId, problemId))
          .limit(1);
        if (problemOrigin) {
          await tx
            .update(coachProblemOrigin)
            .set({
              sourceId,
              externalId: problem.origin.externalId,
              upstreamUrl: problem.origin.upstreamUrl,
              licenseSpdx: problem.origin.licenseSpdx,
              attribution: problem.origin.attribution,
              sourceRevision: problem.origin.sourceRevision,
              contentHash: candidate.contentHash,
              fetchedAt: candidate.createdAt,
              updatedAt: new Date(),
            })
            .where(eq(coachProblemOrigin.id, problemOrigin.id));
        } else {
          await tx.insert(coachProblemOrigin).values({
            id: stableId('problem_origin', sourceId, problem.origin.externalId),
            problemId,
            sourceId,
            externalId: problem.origin.externalId,
            upstreamUrl: problem.origin.upstreamUrl,
            licenseSpdx: problem.origin.licenseSpdx,
            attribution: problem.origin.attribution,
            sourceRevision: problem.origin.sourceRevision,
            contentHash: candidate.contentHash,
            fetchedAt: candidate.createdAt,
          });
        }
        await tx
          .update(coachProblemCandidate)
          .set({
            status: 'published',
            publishedByUserId: publisherUserId,
            publishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(coachProblemCandidate.id, candidate.id));
        await tx.insert(coachCatalogReviewAudit).values({
          id: `catalog_audit_${randomUUID()}`,
          candidateId: candidate.id,
          problemId,
          revisionId: revision.id,
          reviewerUserId: publisherUserId,
          action: 'published',
          notes:
            notes?.trim().slice(0, 2000) ||
            `Published by user ${publisherUserId}`,
          contentHash: candidate.contentHash,
          sourceRevision: candidate.sourceRevision,
          draftHash: candidate.draftHash,
          draftRevision: candidate.draftRevision,
          policyVersion: candidate.policyVersion,
          metadata: {
            publisherUserId,
            approverUserId: candidate.approvedByUserId,
          },
        });
        problemSlugs.push(publishedSlug);
        revisionIds.push(revision.id);
        published += 1;
        publishedEvents.push({
          outcome: 'published',
          problemSlug: publishedSlug,
          revisionId: revision.id,
        });
      }
      return {
        kind: 'published',
        summary: {
          published,
          alreadyPublished,
          problemSlugs,
          revisionIds,
        },
        publishedEvents,
      } as const;
    });
    if (committed.kind === 'invalid') {
      const rejected = committed.invalid;
      for (const item of rejected) {
        emitCatalogOperationalEvent('catalog_candidate_rejected', {
          mode: 'database',
          outcome: 'rejected',
          candidateId: item.candidateId,
          issueCodes: [
            ...new Set(item.validation.issues.map((issue) => issue.code)),
          ],
        });
      }
      throw new Error(
        `Catalog publish-time validation rejected ${rejected.length} candidate(s).`
      );
    }
    for (const item of committed.publishedEvents) {
      emitCatalogOperationalEvent('catalog_revision_published', {
        mode: 'database',
        outcome: item.outcome,
        problemSlug: item.problemSlug,
        revisionId: item.revisionId,
      });
    }
    return committed.summary;
  }

  async rollbackProblem(
    problemSlug: string,
    targetVersion: number,
    reviewer: string,
    notes?: string
  ): Promise<{ problemSlug: string; fromVersion: number; toVersion: number }> {
    const publisherUserId = actorUserId(reviewer);
    const result = await this.database.transaction(async (tx) => {
      await setLocalCapabilityRole(tx, PUBLISHER_ROLE);
      const [problem] = await tx
        .select()
        .from(coachProblem)
        .where(
          and(
            eq(coachProblem.slug, problemSlug),
            isNull(coachProblem.ownerUserId)
          )
        )
        .limit(1)
        .for('update');
      if (!problem?.currentRevisionId) {
        throw new Error(`Versioned catalog problem not found: ${problemSlug}`);
      }
      if (problem.source !== 'external') {
        throw new Error(
          'Only external catalog problems can be rolled back here.'
        );
      }
      const [current] = await tx
        .select()
        .from(coachProblemRevision)
        .where(eq(coachProblemRevision.id, problem.currentRevisionId))
        .limit(1);
      const [target] = await tx
        .select()
        .from(coachProblemRevision)
        .where(
          and(
            eq(coachProblemRevision.problemId, problem.id),
            eq(coachProblemRevision.version, targetVersion)
          )
        )
        .limit(1);
      if (!current || !target)
        throw new Error('Rollback revision was not found.');
      if (!['published', 'archived'].includes(target.status)) {
        throw new Error(
          'Only a previously published revision can be restored.'
        );
      }
      if (current.id === target.id)
        throw new Error('Target revision is already active.');

      await tx
        .update(coachProblemRevision)
        .set({ status: 'archived' })
        .where(eq(coachProblemRevision.id, current.id));
      await tx
        .update(coachProblemRevision)
        .set({ status: 'published' })
        .where(eq(coachProblemRevision.id, target.id));
      await tx
        .update(coachProblem)
        .set({
          title: target.title,
          description: target.description,
          difficulty: target.difficulty,
          topics: target.topics,
          entryPoint: target.entryPoint,
          templates: target.templates,
          languageConfigs: target.languageConfigs,
          signature: target.signature,
          examples: target.examples,
          constraints: target.constraints,
          hints: target.hints,
          reviewPoints: target.reviewPoints,
          estimatedMinutes: target.estimatedMinutes,
          sourceStatement: target.sourceStatement,
          sourceUrl: target.sourceUrl,
          contentVersion: target.version,
          currentRevisionId: target.id,
          updatedAt: new Date(),
        })
        .where(eq(coachProblem.id, problem.id));
      await tx
        .update(coachProblemOrigin)
        .set({
          upstreamUrl: target.sourceUrl ?? '',
          licenseSpdx: target.sourceLicenseSpdx ?? 'MIT',
          attribution: target.sourceAttribution ?? '',
          sourceRevision: target.sourceRevision ?? '',
          contentHash: target.contentHash,
          fetchedAt: target.sourceFetchedAt ?? target.createdAt,
          updatedAt: new Date(),
        })
        .where(eq(coachProblemOrigin.problemId, problem.id));
      await tx.insert(coachCatalogReviewAudit).values({
        id: `catalog_audit_${randomUUID()}`,
        problemId: problem.id,
        revisionId: target.id,
        reviewerUserId: publisherUserId,
        action: 'rolled_back',
        notes:
          notes?.trim().slice(0, 2000) ||
          `Rolled back by user ${publisherUserId}`,
        contentHash: target.contentHash,
        sourceRevision: target.sourceRevision,
        draftHash: target.draftHash,
        draftRevision: target.draftRevision,
        policyVersion: target.policyVersion,
        metadata: {
          publisherUserId,
          fromVersion: current.version,
          toVersion: target.version,
        },
      });
      return {
        problemSlug,
        fromVersion: current.version,
        toVersion: target.version,
      };
    });
    emitCatalogOperationalEvent('catalog_revision_rolled_back', {
      mode: 'database',
      outcome: 'rolled_back',
      problemSlug: result.problemSlug,
      fromVersion: result.fromVersion,
      toVersion: result.toVersion,
    });
    return result;
  }
}
