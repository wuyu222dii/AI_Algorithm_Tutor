import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';

import { dbPostgres } from '@/core/db';
import {
  coachCatalogReviewAudit,
  coachCatalogSource,
  coachCatalogSyncRun,
  coachProblem,
  coachProblemCandidate,
  coachProblemOrigin,
  coachProblemRevision,
  coachTestCase,
} from '@/config/db/schema.postgres';

import {
  calculateCandidateContentHash,
  calculateCatalogContentFingerprint,
} from './content-hash';
import { ExercismCatalogAdapter } from './exercism-adapter';
import { emitCatalogOperationalEvent } from './operational-events';
import type {
  CatalogValidationResult,
  ExercismSnapshot,
  ExercismUpstreamProblem,
  RawCatalogProblem,
} from './raw-types';
import {
  candidateStateForValidation,
  mergeCatalogValidationResults,
  validateCandidatePayload,
  validateCatalogBatch,
} from './validation';

const EXERCISM_SOURCE_ID = 'catalog_source_exercism';
const EXERCISM_SOURCE_KEY = 'exercism-problem-specifications';

type Database = ReturnType<typeof dbPostgres>;
type CatalogTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

interface CandidatePayload {
  problem: RawCatalogProblem;
  upstream: ExercismUpstreamProblem;
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

export interface DatabaseValidationSummary {
  checked: number;
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
              discovered: candidateIds.length,
              notModified: fetched.notModified,
              localContentFingerprint: fetched.localContentFingerprint,
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
    if (snapshot.licenseSpdx !== 'MIT') {
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
          normalizedProblem: payload,
          validation: {},
          status: 'discovered',
        })
        .onConflictDoNothing({
          target: [
            coachProblemCandidate.sourceId,
            coachProblemCandidate.externalId,
            coachProblemCandidate.contentHash,
          ],
        })
        .returning({ id: coachProblemCandidate.id });
      if (inserted.length > 0) candidateIds.push(id);
    }
    return candidateIds;
  }

  async validateCandidates(
    candidateIds?: string[]
  ): Promise<DatabaseValidationSummary> {
    const filters = [
      inArray(coachProblemCandidate.status, ['discovered', 'quarantined']),
    ];
    if (candidateIds && candidateIds.length > 0) {
      filters.push(inArray(coachProblemCandidate.id, candidateIds));
    }
    const rows = await this.database
      .select()
      .from(coachProblemCandidate)
      .where(and(...filters));
    const payloads = rows.map((row) => ({
      row,
      payload: candidatePayload(row.normalizedProblem),
    }));
    const batch = validateCatalogBatch(
      payloads.map(({ payload }) => payload.problem)
    );
    let validated = 0;
    let quarantined = 0;
    let rejected = 0;
    const rejectedCandidates: Array<{
      candidateId: string;
      issueCodes: string[];
    }> = [];

    await this.database.transaction(async (tx) => {
      for (const { row, payload } of payloads) {
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
        const validation = mergeCatalogValidationResults(
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
        const status = candidateStateForValidation(validation);
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
          action: status === 'rejected' ? 'rejected' : 'submitted',
          metadata: { status, validation },
        });
      }
    });
    for (const item of rejectedCandidates) {
      emitCatalogOperationalEvent('catalog_candidate_rejected', {
        mode: 'database',
        outcome: 'rejected',
        candidateId: item.candidateId,
        issueCodes: item.issueCodes,
      });
    }
    return {
      checked: rows.length,
      validated,
      quarantined,
      rejected,
      candidateIds: rows.map((row) => row.id),
    };
  }

  async approveCandidates(
    candidateIds: string[],
    reviewer: string
  ): Promise<DatabaseApprovalSummary> {
    const reviewerIdentity = reviewer.trim();
    if (!reviewerIdentity) {
      throw new Error('Approving requires a reviewer identity.');
    }
    const ids = [...new Set(candidateIds)];
    if (ids.length === 0) throw new Error('No candidate ids were supplied.');

    return this.database.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(coachProblemCandidate)
        .where(inArray(coachProblemCandidate.id, ids))
        .for('update');
      if (candidates.length !== ids.length) {
        throw new Error('One or more catalog candidates do not exist.');
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
          .set({ status: 'approved', updatedAt: new Date() })
          .where(eq(coachProblemCandidate.id, candidate.id));
        await tx.insert(coachCatalogReviewAudit).values({
          id: `catalog_audit_${randomUUID()}`,
          candidateId: candidate.id,
          action: 'approved',
          notes: `Reviewed by ${reviewerIdentity}`,
          metadata: { reviewer: reviewerIdentity },
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
    reviewer: string
  ): Promise<DatabasePublishSummary> {
    if (!reviewer.trim())
      throw new Error('Publishing requires a reviewer identity.');
    const ids = [...new Set(candidateIds)];
    if (ids.length === 0) throw new Error('No candidate ids were supplied.');

    const committed = await this.database.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(coachProblemCandidate)
        .where(inArray(coachProblemCandidate.id, ids))
        .for('update');
      if (candidates.length !== ids.length) {
        throw new Error('One or more catalog candidates do not exist.');
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
        const validation = mergeCatalogValidationResults(
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
              updatedAt: new Date(),
            })
            .where(eq(coachProblemCandidate.id, item.candidateId));
          await tx.insert(coachCatalogReviewAudit).values({
            id: `catalog_audit_${randomUUID()}`,
            candidateId: item.candidateId,
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
        const problemId = stableId(
          'external_problem',
          sourceId,
          problem.origin.externalId
        );
        const [existingProblem] = await tx
          .select()
          .from(coachProblem)
          .where(
            and(
              eq(coachProblem.slug, problem.slug),
              isNull(coachProblem.ownerUserId)
            )
          )
          .limit(1);
        if (existingProblem && existingProblem.id !== problemId) {
          throw new Error(`Catalog slug is already owned: ${problem.slug}`);
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
          problemSlugs.push(problem.slug);
          revisionIds.push(publishedRevision.id);
          publishedEvents.push({
            outcome: 'already_published',
            problemSlug: problem.slug,
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
              estimatedMinutes: problem.estimatedMinutes,
              sourceStatement: upstream.statementMarkdown,
              sourceUrl: problem.origin.upstreamUrl,
              sourceRevision: problem.origin.sourceRevision,
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
        await tx
          .insert(coachProblemOrigin)
          .values({
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
          })
          .onConflictDoUpdate({
            target: [
              coachProblemOrigin.sourceId,
              coachProblemOrigin.externalId,
            ],
            set: {
              problemId,
              upstreamUrl: problem.origin.upstreamUrl,
              licenseSpdx: problem.origin.licenseSpdx,
              attribution: problem.origin.attribution,
              sourceRevision: problem.origin.sourceRevision,
              contentHash: candidate.contentHash,
              fetchedAt: candidate.createdAt,
              updatedAt: new Date(),
            },
          });
        await tx
          .update(coachProblemCandidate)
          .set({ status: 'published', updatedAt: new Date() })
          .where(eq(coachProblemCandidate.id, candidate.id));
        await tx.insert(coachCatalogReviewAudit).values({
          id: `catalog_audit_${randomUUID()}`,
          candidateId: candidate.id,
          problemId,
          revisionId: revision.id,
          action: 'published',
          notes: `Published by ${reviewer}`,
          metadata: { reviewer },
        });
        problemSlugs.push(problem.slug);
        revisionIds.push(revision.id);
        published += 1;
        publishedEvents.push({
          outcome: 'published',
          problemSlug: problem.slug,
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
    reviewer: string
  ): Promise<{ problemSlug: string; fromVersion: number; toVersion: number }> {
    if (!reviewer.trim())
      throw new Error('Rollback requires a reviewer identity.');
    const result = await this.database.transaction(async (tx) => {
      const [problem] = await tx
        .select()
        .from(coachProblem)
        .where(
          and(
            eq(coachProblem.slug, problemSlug),
            isNull(coachProblem.ownerUserId)
          )
        )
        .limit(1);
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
          sourceRevision: target.sourceRevision ?? '',
          contentHash: target.contentHash,
          updatedAt: new Date(),
        })
        .where(eq(coachProblemOrigin.problemId, problem.id));
      await tx.insert(coachCatalogReviewAudit).values({
        id: `catalog_audit_${randomUUID()}`,
        problemId: problem.id,
        revisionId: target.id,
        action: 'rolled_back',
        notes: `Rolled back by ${reviewer}`,
        metadata: {
          reviewer,
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
