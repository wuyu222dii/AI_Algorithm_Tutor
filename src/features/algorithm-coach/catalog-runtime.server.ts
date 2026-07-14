import 'server-only';

import {
  getPublishedProblemBySlug,
  listPublishedProblems,
  type PublishedProblem,
  type PublishedProblemQuery,
} from './catalog-repository.server';
import {
  getEnabledLanguageIds,
  normalizeProblemLanguageConfigs,
  problemSupportsLanguage,
  type EnabledLanguage,
} from './languages';
import type { Problem } from './types';

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
  const [{ problems }, { curatedExercismProblems }] = await Promise.all([
    import('./data/problems'),
    import('./catalog/curated-exercism-problems'),
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
  return [...problems, ...external].map(normalizeCatalogProblem);
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
    return filterFixtureCatalog(await loadFixtureCatalog(), options);
  }
  const catalog = (await listPublishedProblems(options)).map(
    normalizeCatalogProblem
  );
  if (!catalog.length) {
    throw new Error('The published PostgreSQL problem catalog is empty.');
  }
  return catalog;
}

export async function getRuntimeProblem(
  slug: string,
  contentVersion?: number
): Promise<PublishedProblem | undefined> {
  if (!databaseCatalogEnabled()) {
    return (await loadFixtureCatalog()).find(
      (problem) =>
        problem.slug === slug &&
        (contentVersion === undefined ||
          problem.version?.contentVersion === contentVersion)
    );
  }
  const problem = await getPublishedProblemBySlug(slug, contentVersion);
  return problem ? normalizeCatalogProblem(problem) : undefined;
}
