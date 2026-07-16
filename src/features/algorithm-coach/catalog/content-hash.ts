import { createHash } from 'node:crypto';

import type {
  CatalogJsonValue,
  ExercismUpstreamProblem,
  RawCatalogProblem,
  RawCatalogProblemInput,
} from './raw-types';

export function stableStringify(value: CatalogJsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(',')}}`;
}

export function calculateCatalogContentFingerprint(
  problems: RawCatalogProblem[]
): string {
  const entries = problems
    .map((problem) => ({
      externalId: problem.origin.externalId,
      contentHash: problem.origin.contentHash,
    }))
    .sort((left, right) => left.externalId.localeCompare(right.externalId));
  return sha256(stableStringify(entries as unknown as CatalogJsonValue));
}

export function calculateCanonicalDataHash(value: CatalogJsonValue): string {
  return sha256(stableStringify(value));
}

export interface CatalogRawEvidence {
  externalId: string;
  statementHash: string;
  statementBlobSha: string;
  canonicalDataHash: string;
  canonicalBlobSha?: string;
  licenseGitBlobSha: string;
  licenseContentHash: string;
}

/**
 * Identifies immutable upstream content without tying it to a repository
 * commit. Unrelated upstream commits must not create another candidate.
 */
export function calculateCatalogRawEvidenceHash(
  evidence: CatalogRawEvidence
): string {
  return sha256(
    stableStringify({
      externalId: evidence.externalId,
      statementHash: evidence.statementHash,
      statementBlobSha: evidence.statementBlobSha,
      canonicalDataHash: evidence.canonicalDataHash,
      canonicalBlobSha: evidence.canonicalBlobSha ?? '',
      licenseGitBlobSha: evidence.licenseGitBlobSha,
      licenseContentHash: evidence.licenseContentHash,
    })
  );
}

export function calculateCandidateContentHash(
  problem: RawCatalogProblem,
  upstream: ExercismUpstreamProblem
): string {
  return sha256(
    stableStringify({
      localContentHash: problem.origin.contentHash,
      statementHash: upstream.statementHash,
      canonicalDataHash: upstream.canonicalDataHash,
    })
  );
}

export function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function calculateProblemContentHash(
  problem: Omit<RawCatalogProblem, 'origin'>
): string {
  return sha256(stableStringify(problem as unknown as CatalogJsonValue));
}

export function withContentHash(
  problem: RawCatalogProblemInput
): RawCatalogProblem {
  const { origin, ...content } = problem;
  return {
    ...content,
    origin: {
      ...origin,
      contentHash: calculateProblemContentHash(content),
    },
  };
}
