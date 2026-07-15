import { createEmptyCatalogReviewDraftV2 } from '@/features/algorithm-coach/catalog/review-draft';
import { CoachHttpError } from '@/features/algorithm-coach/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH } from './route';

const mocks = vi.hoisted(() => {
  class ActionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status = 409
    ) {
      super(message);
    }
  }
  return {
    authorize: vi.fn(),
    getCandidate: vi.fn(),
    execute: vi.fn(),
    ActionError,
  };
});

vi.mock('@/core/rbac/permission', () => ({
  PERMISSIONS: {
    CATALOG_READ: 'admin.catalog.read',
    CATALOG_REVIEW: 'admin.catalog.review',
  },
}));
vi.mock('@/features/algorithm-coach/catalog/admin-auth.server', () => ({
  authorizeCatalogAdmin: mocks.authorize,
}));
vi.mock('@/features/algorithm-coach/catalog/admin-service.server', () => ({
  getCatalogAdminCandidate: mocks.getCandidate,
}));
vi.mock('@/features/algorithm-coach/catalog/admin-actions.server', () => ({
  CatalogAdminActionError: mocks.ActionError,
  executeCatalogCandidateAction: mocks.execute,
}));

function context(candidateId = 'candidate-1') {
  return { params: Promise.resolve({ candidateId }) };
}

function patchRequest(body: unknown) {
  return new Request(
    'http://localhost:3000/api/admin/catalog/candidates/candidate-1',
    {
      method: 'PATCH',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'idempotency-key': 'catalog-test-key-0001',
      },
      body: JSON.stringify(body),
    }
  );
}

function structuredDraftBody(expectedDraftRevision = 2) {
  return {
    schemaVersion: 2 as const,
    expectedDraftRevision,
    draft: createEmptyCatalogReviewDraftV2(),
  };
}

describe('catalog candidate detail API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      userId: 'reviewer-1',
      idempotencyKey: 'catalog-test-key-0001',
    });
    mocks.getCandidate.mockResolvedValue({
      id: 'candidate-1',
      status: 'validated',
    });
    mocks.execute.mockResolvedValue({
      candidateId: 'candidate-1',
      draftRevision: 3,
    });
  });

  it('requires read permission and returns a candidate detail', async () => {
    const response = await GET(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates/candidate-1'
      ),
      context()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.read'
    );
    expect(mocks.getCandidate).toHaveBeenCalledWith('candidate-1');
  });

  it('returns stable validation and not-found errors', async () => {
    const invalid = await GET(
      new Request('http://localhost:3000/api/admin/catalog/candidates/%24bad'),
      context('$bad')
    );
    expect(invalid.status).toBe(400);
    expect(mocks.getCandidate).not.toHaveBeenCalled();

    mocks.getCandidate.mockResolvedValueOnce(undefined);
    const missing = await GET(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates/candidate-2'
      ),
      context('candidate-2')
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'candidate_not_found' },
    });
  });

  it('updates a draft with review permission and optimistic revision', async () => {
    const response = await PATCH(
      patchRequest(structuredDraftBody()),
      context()
    );

    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.review',
      { mutation: true, idempotent: true }
    );
    expect(mocks.execute).toHaveBeenCalledWith({
      action: 'update_draft',
      candidateId: 'candidate-1',
      actorUserId: 'reviewer-1',
      idempotencyKey: 'catalog-test-key-0001',
      payload: {
        schemaVersion: 2,
        draft: createEmptyCatalogReviewDraftV2(),
        expectedDraftRevision: 2,
      },
    });
  });

  it('associates a renamed exercise with an existing published slug', async () => {
    const response = await PATCH(
      patchRequest({
        targetProblemSlug: 'exercism-two-fer',
        expectedDraftRevision: 2,
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith({
      action: 'associate_target',
      candidateId: 'candidate-1',
      actorUserId: 'reviewer-1',
      idempotencyKey: 'catalog-test-key-0001',
      payload: {
        targetProblemSlug: 'exercism-two-fer',
        expectedDraftRevision: 2,
      },
    });
  });

  it('does not execute malformed or unauthorized draft updates', async () => {
    const invalid = await PATCH(
      patchRequest({
        schemaVersion: 2,
        draft: {},
        expectedDraftRevision: 0,
      }),
      context()
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: {
        details: expect.arrayContaining([
          expect.objectContaining({ path: 'expectedDraftRevision' }),
          expect.objectContaining({ path: 'draft.schemaVersion' }),
        ]),
      },
    });
    expect(mocks.execute).not.toHaveBeenCalled();

    mocks.authorize.mockRejectedValueOnce(
      new CoachHttpError(403, 'invalid_origin', 'Same-origin required.')
    );
    const forbidden = await PATCH(
      patchRequest(structuredDraftBody()),
      context()
    );
    expect(forbidden.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('maps action conflicts without turning them into availability errors', async () => {
    mocks.execute.mockRejectedValueOnce(
      new mocks.ActionError('revision_conflict', 'Refresh and try again.', 409)
    );
    const response = await PATCH(
      patchRequest(structuredDraftBody()),
      context()
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'revision_conflict',
        message: 'Refresh and try again.',
      },
    });
  });
});
