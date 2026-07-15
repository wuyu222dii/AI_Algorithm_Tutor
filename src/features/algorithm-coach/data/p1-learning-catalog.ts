import type { ProblemOriginMetadata } from '../catalog-repository.server';
import { sha256, stableStringify } from '../catalog/content-hash';
import type { CatalogJsonValue } from '../catalog/raw-types';
import type { P1LearningProblem } from './p1-learning-problems';

export const P1_CATALOG_VERSION = 'p1-learning-v1';
export const P1_CATALOG_SOURCE_KEY = 'algocoach-original';
export const P1_CATALOG_LICENSE = 'LicenseRef-AlgoCoach-Original';
export const P1_CATALOG_ATTRIBUTION =
  'Copyright (c) 2026 AlgoCoach. Original educational content.';
export const P1_CATALOG_PUBLISHED_AT = '2026-07-15T00:00:00.000Z';

export function p1ProblemSourceUrl(slug: string): string {
  return `https://algocoach.example/problems/${slug}`;
}

export function calculateP1ProblemContentHash(
  problem: P1LearningProblem
): string {
  const serialized = JSON.parse(JSON.stringify(problem)) as CatalogJsonValue;
  return sha256(stableStringify(serialized));
}

export function p1ProblemOrigin(
  problem: P1LearningProblem
): ProblemOriginMetadata {
  return {
    provider: P1_CATALOG_SOURCE_KEY,
    externalId: problem.slug,
    upstreamUrl: p1ProblemSourceUrl(problem.slug),
    licenseSpdx: P1_CATALOG_LICENSE,
    attribution: P1_CATALOG_ATTRIBUTION,
    sourceRevision: P1_CATALOG_VERSION,
    contentHash: calculateP1ProblemContentHash(problem),
    fetchedAt: P1_CATALOG_PUBLISHED_AT,
  };
}
