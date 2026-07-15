import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CatalogAdminActionError,
  executeCatalogCandidateAction,
  executeCatalogRollback,
} from './admin-actions.server';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  updateDraft: vi.fn(),
  associateTarget: vi.fn(),
  validate: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  publish: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('./admin-db.server', () => ({
  catalogAdminDatabase: () => ({ database: true }),
}));
vi.mock('./catalog-store.server', () => ({
  CatalogDatabaseStore: class CatalogDatabaseStore {
    claimAdminMutation = mocks.claim;
    completeAdminMutation = mocks.complete;
    updateCandidateDraft = mocks.updateDraft;
    associateCandidateTarget = mocks.associateTarget;
    validateCandidates = mocks.validate;
    approveCandidates = mocks.approve;
    rejectCandidate = mocks.reject;
    publishCandidates = mocks.publish;
    rollbackProblem = mocks.rollback;
  },
}));

const mutation = {
  id: 'mutation-1',
  status: 'claimed',
  result: {},
  errorCode: null,
};

describe('catalog admin action execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ claimed: true, mutation });
    mocks.complete.mockResolvedValue({ ...mutation, status: 'completed' });
  });

  it('records approval notes and completes the idempotent mutation', async () => {
    mocks.approve.mockResolvedValue({ approved: 1, candidateIds: ['c-1'] });

    await expect(
      executeCatalogCandidateAction({
        action: 'approve',
        candidateId: 'c-1',
        actorUserId: 'reviewer-1',
        idempotencyKey: 'catalog-test-key-0001',
        payload: { notes: 'Tests and attribution checked.' },
      })
    ).resolves.toEqual({ approved: 1, candidateIds: ['c-1'] });

    expect(mocks.approve).toHaveBeenCalledWith(
      ['c-1'],
      'reviewer-1',
      'Tests and attribution checked.'
    );
    expect(mocks.complete).toHaveBeenCalledWith('mutation-1', 'reviewer-1', {
      status: 'completed',
      result: { approved: 1, candidateIds: ['c-1'] },
    });
  });

  it('associates a renamed exercise through the reviewed draft mutation lane', async () => {
    mocks.associateTarget.mockResolvedValue({
      id: 'c-1',
      status: 'quarantined',
      draftRevision: 3,
      targetProblemId: 'problem-1',
    });

    await expect(
      executeCatalogCandidateAction({
        action: 'associate_target',
        candidateId: 'c-1',
        actorUserId: 'reviewer-1',
        idempotencyKey: 'catalog-associate-key-0001',
        payload: {
          targetProblemSlug: 'exercism-two-fer',
          expectedDraftRevision: 2,
        },
      })
    ).resolves.toMatchObject({
      candidateId: 'c-1',
      draftRevision: 3,
      targetProblemId: 'problem-1',
    });

    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update_draft' })
    );
    expect(mocks.associateTarget).toHaveBeenCalledWith(
      'c-1',
      'exercism-two-fer',
      'reviewer-1',
      2
    );
  });

  it('returns a completed mutation without executing the action again', async () => {
    mocks.claim.mockResolvedValue({
      claimed: false,
      mutation: {
        ...mutation,
        status: 'completed',
        result: { published: 1 },
      },
    });

    await expect(
      executeCatalogCandidateAction({
        action: 'publish',
        candidateId: 'c-1',
        actorUserId: 'publisher-1',
        idempotencyKey: 'catalog-test-key-0002',
        payload: { notes: 'Release approved.' },
      })
    ).resolves.toEqual({ published: 1 });

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('maps an in-progress replay to a stable conflict', async () => {
    mocks.claim.mockResolvedValue({ claimed: false, mutation });

    await expect(
      executeCatalogCandidateAction({
        action: 'validate',
        candidateId: 'c-1',
        actorUserId: 'reviewer-1',
        idempotencyKey: 'catalog-test-key-0003',
        payload: {},
      })
    ).rejects.toMatchObject({
      code: 'mutation_in_progress',
      status: 409,
      message: 'The catalog mutation is already in progress.',
    });
  });

  it('maps missing candidates to 404 and records the failed mutation', async () => {
    mocks.approve.mockRejectedValue(
      new Error('One or more catalog candidates do not exist.')
    );

    const error = await executeCatalogCandidateAction({
      action: 'approve',
      candidateId: 'missing',
      actorUserId: 'reviewer-1',
      idempotencyKey: 'catalog-test-key-0004',
      payload: {},
    }).catch((cause) => cause as CatalogAdminActionError);

    expect(error).toMatchObject({
      code: 'candidate_not_found',
      status: 404,
      message: 'Catalog candidate not found.',
    });
    expect(mocks.complete).toHaveBeenCalledWith('mutation-1', 'reviewer-1', {
      status: 'failed',
      errorCode: 'candidate_not_found',
    });
  });

  it('does not expose database error text to API callers', async () => {
    mocks.claim.mockRejectedValue(
      new Error('SQLSTATE 08006 password authentication failed for db.internal')
    );

    const error = await executeCatalogCandidateAction({
      action: 'validate',
      candidateId: 'c-1',
      actorUserId: 'reviewer-1',
      idempotencyKey: 'catalog-test-key-0005',
      payload: {},
    }).catch((cause) => cause as CatalogAdminActionError);

    expect(error).toMatchObject({
      code: 'catalog_mutation_failed',
      status: 503,
    });
    expect(error.message).not.toContain('SQLSTATE');
    expect(error.message).not.toContain('db.internal');
  });

  it('claims and completes rollback mutations idempotently', async () => {
    mocks.rollback.mockResolvedValue({
      problemSlug: 'two-fer',
      fromVersion: 3,
      toVersion: 1,
    });

    await expect(
      executeCatalogRollback({
        problemSlug: 'two-fer',
        targetVersion: 1,
        notes: 'Revision 3 regressed edge cases.',
        actorUserId: 'publisher-1',
        idempotencyKey: 'catalog-rollback-key-0001',
      })
    ).resolves.toEqual({
      problemSlug: 'two-fer',
      fromVersion: 3,
      toVersion: 1,
    });

    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'publisher-1',
        action: 'rollback',
        targetType: 'problem',
        targetId: 'two-fer',
      })
    );
    expect(mocks.rollback).toHaveBeenCalledWith(
      'two-fer',
      1,
      'publisher-1',
      'Revision 3 regressed edge cases.'
    );
    expect(mocks.complete).toHaveBeenCalledWith('mutation-1', 'publisher-1', {
      status: 'completed',
      result: {
        problemSlug: 'two-fer',
        fromVersion: 3,
        toVersion: 1,
      },
    });
  });

  it('replays a completed v2 to v1 rollback without running it twice', async () => {
    mocks.claim.mockResolvedValue({
      claimed: false,
      mutation: {
        ...mutation,
        status: 'completed',
        result: {
          problemSlug: 'two-fer',
          fromVersion: 2,
          toVersion: 1,
        },
      },
    });

    await expect(
      executeCatalogRollback({
        problemSlug: 'two-fer',
        targetVersion: 1,
        notes: 'Restore the stable v1 revision.',
        actorUserId: 'publisher-1',
        idempotencyKey: 'catalog-rollback-key-0002',
      })
    ).resolves.toEqual({
      problemSlug: 'two-fer',
      fromVersion: 2,
      toVersion: 1,
    });

    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
