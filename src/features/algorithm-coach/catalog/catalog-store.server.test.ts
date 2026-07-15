import { describe, expect, it } from 'vitest';

import {
  calculateCatalogCandidateDelta,
  CatalogDatabaseStore,
  countConsecutiveDiscoveryFailures,
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
  it('reports the absolute candidate delta between discovery runs', () => {
    expect(
      calculateCatalogCandidateDelta(
        { discovered: 12 },
        { selectedExercises: 7 },
        80
      )
    ).toBe(5);
    expect(calculateCatalogCandidateDelta({ discovered: 4 }, {}, 80)).toBe(4);
    expect(calculateCatalogCandidateDelta({}, {}, 80)).toBe(80);
    expect(
      calculateCatalogCandidateDelta(
        { candidateBacklog: 40, discovered: 10 },
        { candidateBacklog: 10, discovered: 10 },
        80
      )
    ).toBe(30);
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
