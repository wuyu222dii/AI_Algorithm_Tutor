import 'server-only';

import {
  getPublishedCoachProblemBySlug,
  getPublishedProblemBySlug,
  listPublishedProblems,
  listPublishedProblemSummaries,
  type PublishedProblem,
  type PublishedProblemQuery,
  type PublishedProblemSummary,
} from './catalog-repository.server';
import {
  getEnabledLanguageIds,
  normalizeProblemLanguageConfigs,
  problemSupportsLanguage,
  type EnabledLanguage,
} from './languages';
import { toProblemSummary } from './problem-contracts';
import type { Problem } from './types';

const MAX_CACHED_REVISIONS = 512;

declare global {
  var __algocoachRuntimeRevisionCache:
    | Map<string, PublishedProblem>
    | undefined;
  var __algocoachCoachContextCache: Map<string, PublishedProblem> | undefined;
}

function revisionCache() {
  if (!globalThis.__algocoachRuntimeRevisionCache) {
    globalThis.__algocoachRuntimeRevisionCache = new Map();
  }
  return globalThis.__algocoachRuntimeRevisionCache;
}

function coachContextCache() {
  if (!globalThis.__algocoachCoachContextCache) {
    globalThis.__algocoachCoachContextCache = new Map();
  }
  return globalThis.__algocoachCoachContextCache;
}

function revisionCacheKey(
  namespace: 'database' | 'fixture',
  slug: string,
  contentVersion: number
) {
  return `${namespace}:${slug}:${contentVersion}`;
}

function rememberRevision(
  namespace: 'database' | 'fixture',
  problem: PublishedProblem
) {
  const contentVersion = problem.version?.contentVersion;
  if (!Number.isInteger(contentVersion) || !contentVersion) return;
  const cache = revisionCache();
  const key = revisionCacheKey(namespace, problem.slug, contentVersion);
  cache.delete(key);
  cache.set(key, problem);
  coachContextCache().delete(key);
  while (cache.size > MAX_CACHED_REVISIONS) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') break;
    cache.delete(oldest);
  }
}

function rememberCoachContext(
  namespace: 'database' | 'fixture',
  problem: PublishedProblem
) {
  const contentVersion = problem.version?.contentVersion;
  if (!Number.isInteger(contentVersion) || !contentVersion) return;
  const cache = coachContextCache();
  const key = revisionCacheKey(namespace, problem.slug, contentVersion);
  cache.delete(key);
  cache.set(key, problem);
  while (cache.size > MAX_CACHED_REVISIONS) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') break;
    cache.delete(oldest);
  }
}

export function resetRuntimeProblemCacheForTests() {
  revisionCache().clear();
  coachContextCache().clear();
}

function databaseCatalogEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.DB_CATALOG_ENABLED === 'true') return true;
  if (env.DB_CATALOG_ENABLED === 'false') return false;
  return env.NODE_ENV !== 'test' && env.VITEST !== 'true';
}

export function runtimeEnabledLanguages(
  env: NodeJS.ProcessEnv = process.env
): EnabledLanguage[] {
  return getEnabledLanguageIds(env.TYPESCRIPT_ENABLED !== 'false');
}

export function normalizeCatalogProblem<T extends Problem>(problem: T): T {
  const languageConfigs = normalizeProblemLanguageConfigs(problem);
  return {
    ...problem,
    languageConfigs,
    version: problem.version ?? { contentVersion: 1 },
  } as T;
}

async function loadFixtureCatalog(): Promise<PublishedProblem[]> {
  if (process.env.NODE_ENV === 'production' && process.env.VITEST !== 'true') {
    throw new Error(
      'DB_CATALOG_ENABLED=false is not allowed in production; publish the versioned catalog first.'
    );
  }
  const [
    { problems },
    { curatedExercismProblems },
    { p1LearningProblems },
    { p1ProblemOrigin, p1ProblemSourceUrl },
  ] = await Promise.all([
    import('./data/problems'),
    import('./catalog/curated-exercism-problems'),
    import('./data/p1-learning-problems'),
    import('./data/p1-learning-catalog'),
  ]);
  const external = curatedExercismProblems.map(
    (problem): PublishedProblem => ({
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      topics: problem.topics,
      languageConfigs: problem.languageConfigs,
      signature: problem.languageConfigs.javascript.signature,
      version: {
        contentVersion: 1,
        catalogVersion: 'exercism-p0-v1',
        sourceRevision: problem.origin.sourceRevision,
      },
      tests: problem.tests,
      examples: [],
      constraints: problem.constraints,
      hints: problem.hints,
      reviewPoints: problem.reviewPoints,
      estimatedMinutes: problem.estimatedMinutes,
      sourceStatement: problem.description.en,
      sourceUrl: problem.origin.upstreamUrl,
      origin: {
        provider: problem.origin.provider,
        externalId: problem.origin.externalId,
        upstreamUrl: problem.origin.upstreamUrl,
        licenseSpdx: problem.origin.licenseSpdx,
        attribution: problem.origin.attribution,
        sourceRevision: problem.origin.sourceRevision,
        contentHash: problem.origin.contentHash,
        fetchedAt: '2026-07-14T00:00:00.000Z',
      },
    })
  );
  const p1 = p1LearningProblems.map(
    (problem): PublishedProblem => ({
      ...problem,
      sourceStatement: problem.description.en,
      sourceUrl: p1ProblemSourceUrl(problem.slug),
      origin: p1ProblemOrigin(problem),
    })
  );
  return [...problems, ...external, ...p1].map(normalizeCatalogProblem);
}

function filterFixtureCatalog(
  catalog: PublishedProblem[],
  options: PublishedProblemQuery
) {
  const filtered = catalog
    .filter(
      (problem) =>
        (!options.difficulty || problem.difficulty === options.difficulty) &&
        (!options.topic || problem.topics.includes(options.topic)) &&
        (!options.language ||
          problemSupportsLanguage(problem, options.language)) &&
        (!options.afterSlug || problem.slug > options.afterSlug)
    )
    .sort((left, right) => left.slug.localeCompare(right.slug));
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}

export async function listRuntimeProblems(
  options: PublishedProblemQuery = {}
): Promise<PublishedProblem[]> {
  if (!databaseCatalogEnabled()) {
    const catalog = filterFixtureCatalog(await loadFixtureCatalog(), options);
    catalog.forEach((problem) => rememberRevision('fixture', problem));
    return catalog;
  }
  const catalog = (await listPublishedProblems(options)).map(
    normalizeCatalogProblem
  );
  if (!catalog.length) {
    throw new Error('The published PostgreSQL problem catalog is empty.');
  }
  catalog.forEach((problem) => rememberRevision('database', problem));
  return catalog;
}

export async function listRuntimeProblemSummaries(
  options: PublishedProblemQuery = {}
): Promise<PublishedProblemSummary[]> {
  const enabledLanguages = runtimeEnabledLanguages();
  if (!databaseCatalogEnabled()) {
    return filterFixtureCatalog(await loadFixtureCatalog(), options).map(
      (problem) => toProblemSummary(problem, enabledLanguages)
    );
  }

  const summaries = await listPublishedProblemSummaries(options);
  const unfilteredFirstPage =
    !options.difficulty &&
    !options.topic &&
    !options.language &&
    !options.afterSlug;
  if (!summaries.length && unfilteredFirstPage) {
    throw new Error('The published PostgreSQL problem catalog is empty.');
  }
  return summaries.map((summary) => ({
    ...summary,
    supportedLanguages: enabledLanguages.filter((language) =>
      summary.supportedLanguages.includes(language)
    ),
  }));
}

/**
 * Keeps the browser contract summary-only while allowing a staged database
 * query rollout. The legacy branch may read full rows, but never serializes
 * templates, tests, hints, or source evidence into the coach layout.
 */
export async function listCoachShellProblemSummaries(
  options: PublishedProblemQuery = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<PublishedProblemSummary[]> {
  if (env.SUMMARY_CATALOG_ENABLED !== 'true') {
    const enabledLanguages = runtimeEnabledLanguages(env);
    return (await listRuntimeProblems(options)).map((problem) =>
      toProblemSummary(problem, enabledLanguages)
    );
  }
  return listRuntimeProblemSummaries(options);
}

export async function getRuntimeProblem(
  slug: string,
  contentVersion?: number
): Promise<PublishedProblem | undefined> {
  const databaseEnabled = databaseCatalogEnabled();
  const namespace = databaseEnabled ? 'database' : 'fixture';
  if (contentVersion !== undefined) {
    const cached = revisionCache().get(
      revisionCacheKey(namespace, slug, contentVersion)
    );
    if (cached) return cached;
  }
  if (!databaseEnabled) {
    const problem = (await loadFixtureCatalog()).find(
      (problem) =>
        problem.slug === slug &&
        (contentVersion === undefined ||
          problem.version?.contentVersion === contentVersion)
    );
    if (problem) rememberRevision('fixture', problem);
    return problem;
  }
  const problem = await getPublishedProblemBySlug(slug, contentVersion);
  if (!problem) return undefined;
  const normalized = normalizeCatalogProblem(problem);
  rememberRevision('database', normalized);
  return normalized;
}

export async function getRuntimeCoachProblem(
  slug: string,
  contentVersion?: number
): Promise<PublishedProblem | undefined> {
  const databaseEnabled = databaseCatalogEnabled();
  const namespace = databaseEnabled ? 'database' : 'fixture';
  if (contentVersion !== undefined) {
    const key = revisionCacheKey(namespace, slug, contentVersion);
    const fullRevision = revisionCache().get(key);
    if (fullRevision) return fullRevision;
    const cachedContext = coachContextCache().get(key);
    if (cachedContext) return cachedContext;
  }
  if (!databaseEnabled) return getRuntimeProblem(slug, contentVersion);

  const problem = await getPublishedCoachProblemBySlug(slug, contentVersion);
  if (!problem) return undefined;
  const normalized = normalizeCatalogProblem(problem);
  rememberCoachContext('database', normalized);
  return normalized;
}
