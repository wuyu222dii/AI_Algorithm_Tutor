import { describe, expect, it } from 'vitest';

import {
  calculateCatalogCandidateDelta,
  calculateCatalogValidationFingerprint,
  CatalogDatabaseStore,
  countConsecutiveDiscoveryFailures,
  isSuccessfulCatalogDiscoveryRun,
} from './catalog-store.server';

function createApprovalDatabase(status: string) {
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const candidate = { id: 'candidate-1', status, draftRevision: 2 };
  const transaction = {
    execute: async () => [],
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [candidate],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        audits.push(values);
      },
    }),
  };
  const database = {
    transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  };
  return {
    store: new CatalogDatabaseStore(database as never),
    updates,
    audits,
  };
}

describe('PostgreSQL catalog approval gate', () => {
  it('fingerprints validation by draft, policy, and runner contract', () => {
    const baseline = calculateCatalogValidationFingerprint({
      draftHash: 'sha256:draft',
      policyVersion: 'catalog-policy-v1',
      runnerVersion: 'runner-v1',
    });
    expect(
      calculateCatalogValidationFingerprint({
        draftHash: 'sha256:draft',
        policyVersion: 'catalog-policy-v1',
        runnerVersion: 'runner-v1',
      })
    ).toBe(baseline);
    expect(
      calculateCatalogValidationFingerprint({
        draftHash: 'sha256:draft',
        policyVersion: 'catalog-policy-v1',
        runnerVersion: 'runner-v2',
      })
    ).not.toBe(baseline);
  });

  it('reports only unexpected candidate growth after the previous batch', () => {
    expect(calculateCatalogCandidateDelta({ candidateBacklog: 111 }, {})).toBe(
      undefined
    );
    expect(
      calculateCatalogCandidateDelta(
        { candidateBacklog: 111 },
        { candidateBacklog: 121, discovered: 10 }
      )
    ).toBe(0);
    expect(
      calculateCatalogCandidateDelta(
        { candidateBacklog: 141 },
        { candidateBacklog: 121, discovered: 10 }
      )
    ).toBe(30);
    expect(
      calculateCatalogCandidateDelta(
        { candidateBacklog: 90 },
        { candidateBacklog: 121, discovered: 10 }
      )
    ).toBe(0);
  });

  it('uses successful discovery snapshots instead of failure records for deltas', () => {
    const runs = [
      { status: 'partial', statistics: { kind: 'discovery' } },
      { status: 'failed', statistics: { kind: 'discovery' } },
      { status: 'succeeded', statistics: { kind: 'discovery' } },
    ];

    expect(
      runs.filter(isSuccessfulCatalogDiscoveryRun).map((run) => run.status)
    ).toEqual(['partial', 'succeeded']);
  });

  it('counts discovery failures across unrelated successful sync runs', () => {
    expect(
      countConsecutiveDiscoveryFailures([
        { status: 'failed', statistics: { kind: 'discovery' } },
        { status: 'succeeded', statistics: { kind: 'sync' } },
        { status: 'failed', statistics: { kind: 'discovery' } },
        { status: 'succeeded', statistics: { kind: 'discovery' } },
      ])
    ).toBe(2);
  });

  it('rejects an invalid target-association revision before touching the database', async () => {
    const store = new CatalogDatabaseStore({} as never);
    await expect(
      store.associateCandidateTarget(
        'candidate-1',
        'target-problem',
        'reviewer@example.test',
        0
      )
    ).rejects.toThrow(/positive integer/);
  });

  it('does not reopen a rejected candidate through target association', async () => {
    const { store } = createApprovalDatabase('rejected');
    await expect(
      store.associateCandidateTarget(
        'candidate-1',
        null,
        'reviewer@example.test',
        2
      )
    ).rejects.toThrow(/rejected/i);
  });

  it('rejects invalid structured review mutations before touching the database', async () => {
    const store = new CatalogDatabaseStore({} as never);
    await expect(
      store.normalizeCandidateReviewDraft(
        'candidate-1',
        {},
        'reviewer@example.test',
        0
      )
    ).rejects.toThrow(/positive integer/);
    await expect(
      store.saveCandidateReviewDraft(
        'candidate-1',
        { schemaVersion: 2 },
        'reviewer@example.test',
        1
      )
    ).rejects.toThrow(/structured review draft is invalid/);
  });

  it('approves a validated candidate and writes one dedicated audit', async () => {
    const { store, updates, audits } = createApprovalDatabase('validated');

    await expect(
      store.approveCandidates(
        ['candidate-1', 'candidate-1'],
        ' reviewer@example.test '
      )
    ).resolves.toEqual({
      approved: 1,
      alreadyApproved: 0,
      alreadyPublished: 0,
      candidateIds: ['candidate-1'],
    });
    expect(updates).toEqual([expect.objectContaining({ status: 'approved' })]);
    expect(audits).toEqual([
      expect.objectContaining({
        candidateId: 'candidate-1',
        action: 'approved',
        reviewerUserId: 'reviewer@example.test',
        metadata: { reviewerUserId: 'reviewer@example.test' },
      }),
    ]);
  });

  it('rejects approval from a stale review page', async () => {
    const { store, updates } = createApprovalDatabase('validated');

    await expect(
      store.approveCandidates(
        ['candidate-1'],
        'reviewer@example.test',
        'Reviewed revision 1',
        1
      )
    ).rejects.toThrow(/stale/i);
    expect(updates).toEqual([]);
  });

  it.each([
    ['approved', 1, 0],
    ['published', 0, 1],
  ])(
    'keeps an already %s candidate idempotent',
    async (status, alreadyApproved, alreadyPublished) => {
      const { store, updates, audits } = createApprovalDatabase(status);

      await expect(
        store.approveCandidates(['candidate-1'], 'reviewer@example.test')
      ).resolves.toEqual({
        approved: 0,
        alreadyApproved,
        alreadyPublished,
        candidateIds: ['candidate-1'],
      });
      expect(updates).toEqual([]);
      expect(audits).toEqual([]);
    }
  );

  it('rejects candidates that have not passed validation', async () => {
    const { store } = createApprovalDatabase('quarantined');

    await expect(
      store.approveCandidates(['candidate-1'], 'reviewer@example.test')
    ).rejects.toThrow(/must be validated before approval/);
  });

  it('prevents publish from replacing the approval stage', async () => {
    const { store } = createApprovalDatabase('validated');

    await expect(
      store.publishCandidates(['candidate-1'], 'publisher@example.test')
    ).rejects.toThrow(/must be approved before publishing/);
  });
});
