import { CoachHttpError } from '@/features/algorithm-coach/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

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
    execute: vi.fn(),
    ActionError,
  };
});

vi.mock('@/core/rbac/permission', () => ({
  PERMISSIONS: {
    CATALOG_REVIEW: 'admin.catalog.review',
    CATALOG_PUBLISH: 'admin.catalog.publish',
  },
}));
vi.mock('@/features/algorithm-coach/catalog/admin-auth.server', () => ({
  authorizeCatalogAdmin: mocks.authorize,
}));
vi.mock('@/features/algorithm-coach/catalog/admin-actions.server', () => ({
  CatalogAdminActionError: mocks.ActionError,
  executeCatalogCandidateAction: mocks.execute,
}));

function request(body: unknown) {
  return new Request(
    'http://localhost:3000/api/admin/catalog/candidates/candidate-1/action',
    {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'idempotency-key': 'catalog-test-key-0001',
      },
      body: JSON.stringify(body),
    }
  );
}

describe('catalog candidate actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      userId: 'reviewer-1',
      idempotencyKey: 'catalog-test-key-0001',
    });
    mocks.execute.mockResolvedValue({ completed: true });
  });

  it('uses review permission for deterministic validation', async () => {
    const response = await POST(request({}), {
      params: Promise.resolve({
        candidateId: 'candidate-1',
        action: 'validate',
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.review',
      { mutation: true, idempotent: true }
    );
    expect(mocks.execute).toHaveBeenCalledWith({
      action: 'validate',
      candidateId: 'candidate-1',
      actorUserId: 'reviewer-1',
      idempotencyKey: 'catalog-test-key-0001',
      payload: { notes: '' },
    });
  });

  it('requires publish permission for publication', async () => {
    const response = await POST(request({ notes: 'Independent release.' }), {
      params: Promise.resolve({
        candidateId: 'candidate-1',
        action: 'publish',
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.publish',
      { mutation: true, idempotent: true }
    );
  });

  it('rejects a candidate only with an explicit reason', async () => {
    const response = await POST(request({}), {
      params: Promise.resolve({ candidateId: 'candidate-1', action: 'reject' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('authorizes before rejecting invalid actions', async () => {
    const response = await POST(request({}), {
      params: Promise.resolve({ candidateId: 'candidate-1', action: 'delete' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.review',
      { mutation: true, idempotent: true }
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('preserves authorization and action error status codes', async () => {
    mocks.authorize.mockRejectedValueOnce(
      new CoachHttpError(403, 'invalid_origin', 'Same-origin required.')
    );
    const forbidden = await POST(request({}), {
      params: Promise.resolve({
        candidateId: 'candidate-1',
        action: 'validate',
      }),
    });
    expect(forbidden.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();

    mocks.authorize.mockResolvedValueOnce({
      userId: 'reviewer-1',
      idempotencyKey: 'catalog-test-key-0001',
    });
    mocks.execute.mockRejectedValueOnce(
      new mocks.ActionError(
        'candidate_not_found',
        'Catalog candidate not found.',
        404
      )
    );
    const missing = await POST(request({}), {
      params: Promise.resolve({
        candidateId: 'candidate-1',
        action: 'validate',
      }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'candidate_not_found' },
    });
  });
});
