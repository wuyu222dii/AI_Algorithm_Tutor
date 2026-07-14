import { describe, expect, it } from 'vitest';

import { CatalogDatabaseStore } from './catalog-store.server';

function createApprovalDatabase(status: string) {
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const candidate = { id: 'candidate-1', status };
  const transaction = {
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
        metadata: { reviewer: 'reviewer@example.test' },
      }),
    ]);
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
