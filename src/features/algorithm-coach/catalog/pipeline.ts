import {
  calculateCandidateContentHash,
  sha256,
  withContentHash,
} from './content-hash';
import type {
  CatalogAuditEntry,
  CatalogCandidate,
  CatalogJsonValue,
  CatalogRelease,
  CatalogSyncResult,
  CatalogWorkspace,
  ExercismSnapshot,
  RawCatalogProblem,
} from './raw-types';
import {
  assertCandidateTransition,
  candidateStateForValidation,
  mergeCatalogValidationResults,
  validateCandidatePayload,
  validateCatalogBatch,
} from './validation';

export function createCatalogWorkspace(): CatalogWorkspace {
  return {
    schemaVersion: 1,
    source: {},
    candidates: [],
    releases: [],
    audit: [],
  };
}

function audit(
  action: CatalogAuditEntry['action'],
  actor: string,
  at: string,
  details: Record<string, CatalogJsonValue>
): CatalogAuditEntry {
  return { action, actor, at, details };
}

function problemAtRevision(
  problem: RawCatalogProblem,
  revision: string,
  upstreamUrl: string
): RawCatalogProblem {
  const content = Object.fromEntries(
    Object.entries(problem).filter(([key]) => key !== 'origin')
  ) as Omit<RawCatalogProblem, 'origin'>;
  return withContentHash({
    ...content,
    origin: {
      ...problem.origin,
      upstreamUrl,
      sourceRevision: revision,
    },
  });
}

export function applyExercismSnapshot(
  workspace: CatalogWorkspace,
  curatedProblems: RawCatalogProblem[],
  snapshot: ExercismSnapshot,
  actor = 'catalog-sync'
): CatalogSyncResult {
  if (snapshot.licenseSpdx !== 'MIT') {
    throw new Error(
      'Only MIT-licensed Exercism snapshots may be synchronized.'
    );
  }

  const next = structuredClone(workspace);
  const curatedByExternalId = new Map(
    curatedProblems.map((problem) => [problem.origin.externalId, problem])
  );
  const discoveredCandidateIds: string[] = [];

  for (const upstream of snapshot.problems) {
    const problem = curatedByExternalId.get(upstream.externalId);
    if (!problem) continue;
    const versionedProblem = problemAtRevision(
      problem,
      snapshot.revision,
      upstream.upstreamUrl
    );
    const contentHash = calculateCandidateContentHash(
      versionedProblem,
      upstream
    );
    const unchanged = next.candidates.some(
      (candidate) =>
        candidate.upstream.externalId === upstream.externalId &&
        candidate.contentHash === contentHash
    );
    if (unchanged) continue;

    const candidateId = `${problem.slug}@${snapshot.revision}-${contentHash.slice(
      7,
      15
    )}`;
    if (next.candidates.some((candidate) => candidate.id === candidateId)) {
      continue;
    }
    const candidate: CatalogCandidate = {
      id: candidateId,
      state: 'discovered',
      problem: versionedProblem,
      upstream,
      contentHash,
      createdAt: snapshot.fetchedAt,
      updatedAt: snapshot.fetchedAt,
    };
    next.candidates.push(candidate);
    discoveredCandidateIds.push(candidateId);
  }

  next.source = {
    etag: snapshot.etag,
    revision: snapshot.revision,
    localContentFingerprint: snapshot.localContentFingerprint,
    lastCheckedAt: snapshot.fetchedAt,
  };
  next.audit.push(
    audit('sync', actor, snapshot.fetchedAt, {
      revision: snapshot.revision,
      discovered: discoveredCandidateIds.length,
    })
  );

  return {
    notModified: false,
    snapshot,
    workspace: next,
    discoveredCandidateIds,
  };
}

export function markCatalogNotModified(
  workspace: CatalogWorkspace,
  checkedAt: string,
  actor = 'catalog-sync',
  localContentFingerprint?: string
): CatalogSyncResult {
  const next = structuredClone(workspace);
  next.source.lastCheckedAt = checkedAt;
  if (localContentFingerprint) {
    next.source.localContentFingerprint = localContentFingerprint;
  }
  next.audit.push(
    audit('sync', actor, checkedAt, {
      revision: next.source.revision ?? '',
      discovered: 0,
    })
  );
  return {
    notModified: true,
    workspace: next,
    discoveredCandidateIds: [],
  };
}

export function validateCatalogCandidates(
  workspace: CatalogWorkspace,
  candidateIds?: string[],
  options: { actor?: string; now?: string } = {}
): CatalogWorkspace {
  const actor = options.actor ?? 'catalog-validator';
  const now = options.now ?? new Date().toISOString();
  const selected = workspace.candidates.filter(
    (candidate) =>
      (candidateIds === undefined || candidateIds.includes(candidate.id)) &&
      ['discovered', 'quarantined'].includes(candidate.state)
  );
  const batch = validateCatalogBatch(
    selected.map((candidate) => candidate.problem)
  );
  const next = structuredClone(workspace);
  const selectedById = new Map(
    selected.map((candidate) => [candidate.id, candidate])
  );

  for (const candidate of next.candidates) {
    const original = selectedById.get(candidate.id);
    if (!original) continue;
    const result = mergeCatalogValidationResults(
      batch.get(candidate.problem.slug)!,
      validateCandidatePayload(
        candidate.problem,
        candidate.upstream,
        candidate.contentHash
      )
    );
    const targetState = candidateStateForValidation(result);
    if (candidate.state !== targetState) {
      assertCandidateTransition(candidate.state, targetState);
      candidate.state = targetState;
    }
    candidate.validation = result;
    candidate.updatedAt = now;
  }

  next.audit.push(
    audit('validate', actor, now, {
      checked: selected.length,
      valid: next.candidates.filter(
        (candidate) =>
          selectedById.has(candidate.id) && candidate.state === 'validated'
      ).length,
    })
  );
  return next;
}

function releaseId(now: string, candidateIds: string[]): string {
  return `release-${now.replace(/\D/g, '').slice(0, 14)}-${sha256(
    [...candidateIds].sort().join('\n')
  ).slice(7, 15)}`;
}

export function approveCatalogCandidates(
  workspace: CatalogWorkspace,
  candidateIds: string[],
  reviewer: string,
  now = new Date().toISOString()
): CatalogWorkspace {
  if (!reviewer.trim()) {
    throw new Error('Approving requires a non-empty reviewer identity.');
  }
  if (candidateIds.length === 0) {
    throw new Error('Approving requires at least one candidate id.');
  }
  const uniqueCandidateIds = [...new Set(candidateIds)];
  const selected = uniqueCandidateIds.map((candidateId) => {
    const candidate = workspace.candidates.find(
      (item) => item.id === candidateId
    );
    if (!candidate) {
      throw new Error(`Unknown catalog candidate: ${candidateId}`);
    }
    if (!['validated', 'approved', 'published'].includes(candidate.state)) {
      throw new Error(
        `Catalog candidate ${candidateId} must be validated before approval.`
      );
    }
    return candidate;
  });
  const pendingIds = selected
    .filter((candidate) => candidate.state === 'validated')
    .map((candidate) => candidate.id);
  if (pendingIds.length === 0) return structuredClone(workspace);

  const pendingIdSet = new Set(pendingIds);
  const next = structuredClone(workspace);
  for (const candidate of next.candidates) {
    if (!pendingIdSet.has(candidate.id)) continue;
    assertCandidateTransition(candidate.state, 'approved');
    candidate.state = 'approved';
    candidate.reviewedBy = reviewer;
    candidate.updatedAt = now;
  }
  next.audit.push(
    audit('approve', reviewer, now, {
      candidates: pendingIds,
    })
  );
  return next;
}

export function publishCatalogCandidates(
  workspace: CatalogWorkspace,
  candidateIds: string[],
  reviewer: string,
  now = new Date().toISOString()
): CatalogWorkspace {
  if (!reviewer.trim()) {
    throw new Error('Publishing requires a non-empty reviewer identity.');
  }
  if (candidateIds.length === 0) {
    throw new Error('Publishing requires at least one candidate id.');
  }
  const uniqueCandidateIds = [...new Set(candidateIds)];
  const selected = uniqueCandidateIds.map((candidateId) => {
    const candidate = workspace.candidates.find(
      (item) => item.id === candidateId
    );
    if (!candidate)
      throw new Error(`Unknown catalog candidate: ${candidateId}`);
    if (!['approved', 'published'].includes(candidate.state)) {
      throw new Error(
        `Catalog candidate ${candidateId} must be approved before publishing.`
      );
    }
    return candidate;
  });

  const batch = validateCatalogBatch(
    selected.map((candidate) => candidate.problem)
  );
  for (const candidate of selected) {
    const validation = mergeCatalogValidationResults(
      batch.get(candidate.problem.slug)!,
      validateCandidatePayload(
        candidate.problem,
        candidate.upstream,
        candidate.contentHash
      )
    );
    if (!validation.valid) {
      throw new Error(
        `Catalog candidate ${candidate.id} failed publish-time validation: ${validation.issues
          .map((item) => item.code)
          .join(', ')}`
      );
    }
    if (
      candidate.state === 'published' &&
      !workspace.releases.some((release) =>
        release.candidateIds.includes(candidate.id)
      )
    ) {
      throw new Error(
        `Published catalog candidate ${candidate.id} has no immutable release.`
      );
    }
  }
  const pending = selected.filter(
    (candidate) => candidate.state === 'approved'
  );
  if (pending.length === 0) return structuredClone(workspace);

  const next = structuredClone(workspace);
  const previousRelease = next.releases.find(
    (release) => release.id === next.activeReleaseId
  );
  const problemBySlug = new Map(
    (previousRelease?.problems ?? []).map((problem) => [problem.slug, problem])
  );
  for (const selectedCandidate of pending) {
    problemBySlug.set(
      selectedCandidate.problem.slug,
      selectedCandidate.problem
    );
    const candidate = next.candidates.find(
      (item) => item.id === selectedCandidate.id
    )!;
    assertCandidateTransition(candidate.state, 'published');
    candidate.state = 'published';
    candidate.updatedAt = now;
  }

  const release: CatalogRelease = {
    id: releaseId(
      now,
      pending.map((candidate) => candidate.id)
    ),
    createdAt: now,
    reviewer,
    previousReleaseId: previousRelease?.id,
    sourceRevision:
      next.source.revision ?? pending[0].problem.origin.sourceRevision,
    candidateIds: pending.map((candidate) => candidate.id),
    problems: [...problemBySlug.values()].sort((left, right) =>
      left.slug.localeCompare(right.slug)
    ),
  };
  if (next.releases.some((item) => item.id === release.id)) {
    throw new Error(`Catalog release already exists: ${release.id}`);
  }
  next.releases.push(release);
  next.activeReleaseId = release.id;
  next.audit.push(
    audit('publish', reviewer, now, {
      releaseId: release.id,
      candidates: pending.map((candidate) => candidate.id),
    })
  );
  return next;
}

export function rollbackCatalogRelease(
  workspace: CatalogWorkspace,
  actor: string,
  targetReleaseId?: string,
  now = new Date().toISOString()
): CatalogWorkspace {
  if (!workspace.activeReleaseId) {
    throw new Error('There is no active catalog release to roll back.');
  }
  const activeRelease = workspace.releases.find(
    (release) => release.id === workspace.activeReleaseId
  );
  const target =
    targetReleaseId ?? activeRelease?.previousReleaseId ?? undefined;
  if (!target || !workspace.releases.some((release) => release.id === target)) {
    throw new Error('The requested rollback release does not exist.');
  }
  const next = structuredClone(workspace);
  const from = next.activeReleaseId!;
  next.activeReleaseId = target;
  next.audit.push(
    audit('rollback', actor, now, { fromReleaseId: from, toReleaseId: target })
  );
  return next;
}
