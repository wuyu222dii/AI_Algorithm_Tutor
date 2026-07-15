import 'server-only';

import { and, asc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import { dbPostgres } from '@/core/db';
import {
  coachCatalogSource,
  coachProblem,
  coachProblemOrigin,
  coachProblemRevision,
  coachTestCase,
} from '@/config/db/schema.postgres';

import type {
  Difficulty,
  Language,
  Problem,
  ProblemExample,
  ProblemFunctionSignature,
  ProblemLanguageConfig,
  ProblemTemplates,
  TestCase,
} from './types';

export interface ProblemOriginMetadata {
  provider: string;
  externalId: string;
  upstreamUrl: string;
  licenseSpdx: string;
  attribution: string;
  sourceRevision: string;
  contentHash: string;
  fetchedAt: string;
  statementPath?: string;
  licenseHash?: string;
}

export interface PublishedProblem extends Problem {
  origin?: ProblemOriginMetadata;
}

export interface PublishedProblemQuery {
  difficulty?: Difficulty;
  topic?: string;
  language?: Language;
  afterSlug?: string;
  limit?: number;
}

type ProblemRow = Awaited<ReturnType<typeof selectProblemRows>>[number];

function selectProblemRows(
  options: PublishedProblemQuery = {},
  slug?: string,
  version?: number
) {
  const conditions: SQL[] = [isNull(coachProblem.ownerUserId)];
  if (version === undefined) {
    conditions.push(
      eq(coachProblem.status, 'published'),
      eq(coachProblemRevision.id, coachProblem.currentRevisionId),
      eq(coachProblemRevision.status, 'published')
    );
  } else {
    conditions.push(
      eq(coachProblemRevision.version, version),
      inArray(coachProblemRevision.status, ['published', 'archived'])
    );
  }
  if (slug) conditions.push(eq(coachProblem.slug, slug));
  if (options.difficulty) {
    conditions.push(eq(coachProblemRevision.difficulty, options.difficulty));
  }
  if (options.topic) {
    conditions.push(
      sql`${options.topic} = any(${coachProblemRevision.topics})`
    );
  }
  if (options.language) {
    conditions.push(
      sql`${coachProblemRevision.languageConfigs} ? ${options.language}`
    );
  }
  if (options.afterSlug) {
    conditions.push(gt(coachProblem.slug, options.afterSlug));
  }

  let query = dbPostgres()
    .select({
      id: coachProblem.id,
      slug: coachProblem.slug,
      source: coachProblem.source,
      version: coachProblemRevision.version,
      title: coachProblemRevision.title,
      description: coachProblemRevision.description,
      difficulty: coachProblemRevision.difficulty,
      topics: coachProblemRevision.topics,
      entryPoint: coachProblemRevision.entryPoint,
      templates: coachProblemRevision.templates,
      languageConfigs: coachProblemRevision.languageConfigs,
      signature: coachProblemRevision.signature,
      examples: coachProblemRevision.examples,
      constraints: coachProblemRevision.constraints,
      hints: coachProblemRevision.hints,
      reviewPoints: coachProblemRevision.reviewPoints,
      learningObjectives: coachProblemRevision.learningObjectives,
      prerequisiteTopics: coachProblemRevision.prerequisiteTopics,
      solutionPatterns: coachProblemRevision.solutionPatterns,
      estimatedMinutes: coachProblemRevision.estimatedMinutes,
      sourceStatement: coachProblemRevision.sourceStatement,
      sourceUrl: coachProblemRevision.sourceUrl,
      sourceRevision: coachProblemRevision.sourceRevision,
      revisionSourceExternalId: coachProblemRevision.sourceExternalId,
      revisionSourceStatementPath: coachProblemRevision.sourceStatementPath,
      revisionSourceLicenseSpdx: coachProblemRevision.sourceLicenseSpdx,
      revisionSourceLicenseHash: coachProblemRevision.sourceLicenseHash,
      revisionSourceAttribution: coachProblemRevision.sourceAttribution,
      revisionSourceFetchedAt: coachProblemRevision.sourceFetchedAt,
      catalogVersion: coachProblemRevision.catalogVersion,
      revisionContentHash: coachProblemRevision.contentHash,
      revisionId: coachProblemRevision.id,
      originExternalId: coachProblemOrigin.externalId,
      originUpstreamUrl: coachProblemOrigin.upstreamUrl,
      originLicenseSpdx: coachProblemOrigin.licenseSpdx,
      originAttribution: coachProblemOrigin.attribution,
      originSourceRevision: coachProblemOrigin.sourceRevision,
      originContentHash: coachProblemOrigin.contentHash,
      originFetchedAt: coachProblemOrigin.fetchedAt,
      originProvider: coachCatalogSource.key,
    })
    .from(coachProblem)
    .innerJoin(
      coachProblemRevision,
      eq(coachProblemRevision.problemId, coachProblem.id)
    )
    .leftJoin(
      coachProblemOrigin,
      eq(coachProblemOrigin.problemId, coachProblem.id)
    )
    .leftJoin(
      coachCatalogSource,
      eq(coachCatalogSource.id, coachProblemOrigin.sourceId)
    )
    .where(and(...conditions))
    .orderBy(asc(coachProblem.slug));

  if (options.limit !== undefined) {
    query = query.limit(
      Math.max(1, Math.min(100, options.limit))
    ) as typeof query;
  }
  return query;
}

async function testsByRevision(
  revisionIds: string[]
): Promise<Map<string, TestCase[]>> {
  if (!revisionIds.length) return new Map();
  const rows = await dbPostgres()
    .select({
      revisionId: coachTestCase.revisionId,
      id: coachTestCase.id,
      args: coachTestCase.args,
      expected: coachTestCase.expected,
      isSample: coachTestCase.isSample,
      label: coachTestCase.label,
    })
    .from(coachTestCase)
    .where(inArray(coachTestCase.revisionId, revisionIds))
    .orderBy(asc(coachTestCase.revisionId), asc(coachTestCase.ordinal));

  const grouped = new Map<string, TestCase[]>();
  for (const row of rows) {
    if (!row.revisionId) continue;
    const tests = grouped.get(row.revisionId) ?? [];
    tests.push({
      id: row.id,
      args: row.args as TestCase['args'],
      expected: row.expected as TestCase['expected'],
      isSample: row.isSample,
      label: (row.label ?? undefined) as TestCase['label'],
    });
    grouped.set(row.revisionId, tests);
  }
  return grouped;
}

function hydrateProblem(row: ProblemRow, tests: TestCase[]): PublishedProblem {
  const languageConfigs = row.languageConfigs as Partial<
    Record<Language, ProblemLanguageConfig>
  >;
  const runtimeVersions = Object.fromEntries(
    Object.entries(languageConfigs).flatMap(([language, config]) =>
      config?.runtimeVersion ? [[language, config.runtimeVersion] as const] : []
    )
  ) as Partial<Record<Language, string>>;
  const originSourceRevision =
    row.sourceRevision ?? row.originSourceRevision ?? undefined;
  const originExternalId =
    row.revisionSourceExternalId ?? row.originExternalId ?? undefined;
  const originUpstreamUrl = row.sourceUrl ?? row.originUpstreamUrl ?? undefined;
  const originLicenseSpdx =
    row.revisionSourceLicenseSpdx ?? row.originLicenseSpdx ?? undefined;
  const originAttribution =
    row.revisionSourceAttribution ?? row.originAttribution ?? undefined;
  const originFetchedAt =
    row.revisionSourceFetchedAt ?? row.originFetchedAt ?? undefined;
  const origin =
    originExternalId &&
    originUpstreamUrl &&
    originLicenseSpdx &&
    originAttribution &&
    originSourceRevision &&
    originFetchedAt
      ? {
          provider: row.originProvider ?? 'external',
          externalId: originExternalId,
          upstreamUrl: originUpstreamUrl,
          licenseSpdx: originLicenseSpdx,
          attribution: originAttribution,
          sourceRevision: originSourceRevision,
          contentHash: row.revisionContentHash,
          fetchedAt: originFetchedAt.toISOString(),
          statementPath: row.revisionSourceStatementPath ?? undefined,
          licenseHash: row.revisionSourceLicenseHash ?? undefined,
        }
      : undefined;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title as Problem['title'],
    description: row.description as Problem['description'],
    difficulty: row.difficulty as Difficulty,
    topics: row.topics,
    entryPoint: row.entryPoint,
    templates: row.templates as ProblemTemplates,
    languageConfigs,
    signature: (row.signature ?? undefined) as
      | ProblemFunctionSignature
      | undefined,
    version: {
      contentVersion: row.version,
      catalogVersion: row.catalogVersion ?? undefined,
      sourceRevision: row.sourceRevision ?? undefined,
      runtimeVersions,
    },
    tests,
    examples: row.examples as ProblemExample[],
    constraints: row.constraints as Problem['constraints'],
    hints: row.hints as Problem['hints'],
    reviewPoints: row.reviewPoints as Problem['reviewPoints'],
    learningObjectives: row.learningObjectives as Problem['learningObjectives'],
    prerequisiteTopics: row.prerequisiteTopics as Problem['prerequisiteTopics'],
    solutionPatterns: row.solutionPatterns as Problem['solutionPatterns'],
    estimatedMinutes: row.estimatedMinutes,
    sourceStatement: row.sourceStatement ?? undefined,
    sourceUrl: row.sourceUrl ?? origin?.upstreamUrl,
    origin,
  };
}

async function hydrateRows(rows: ProblemRow[]): Promise<PublishedProblem[]> {
  const tests = await testsByRevision(rows.map((row) => row.revisionId));
  return rows.map((row) =>
    hydrateProblem(row, tests.get(row.revisionId) ?? [])
  );
}

export async function listPublishedProblems(
  options: PublishedProblemQuery = {}
): Promise<PublishedProblem[]> {
  return hydrateRows(await selectProblemRows(options));
}

export async function getPublishedProblemBySlug(
  slug: string,
  version?: number
): Promise<PublishedProblem | undefined> {
  const normalizedSlug = slug.trim();
  if (!normalizedSlug) return undefined;
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    return undefined;
  }
  const rows = await selectProblemRows({ limit: 1 }, normalizedSlug, version);
  return (await hydrateRows(rows))[0];
}
