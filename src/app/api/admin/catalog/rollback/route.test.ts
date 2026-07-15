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
  PERMISSIONS: { CATALOG_ROLLBACK: 'admin.catalog.rollback' },
}));
vi.mock('@/features/algorithm-coach/catalog/admin-auth.server', () => ({
  authorizeCatalogAdmin: mocks.authorize,
}));
vi.mock('@/features/algorithm-coach/catalog/admin-actions.server', () => ({
  CatalogAdminActionError: mocks.ActionError,
  executeCatalogRollback: mocks.execute,
}));

function request(body: unknown) {
  return new Request('http://localhost:3000/api/admin/catalog/rollback', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      'idempotency-key': 'catalog-rollback-key-0001',
    },
    body: JSON.stringify(body),
  });
}

describe('catalog rollback API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      userId: 'publisher-1',
      idempotencyKey: 'catalog-rollback-key-0001',
    });
    mocks.execute.mockResolvedValue({
      problemSlug: 'two-fer',
      fromVersion: 3,
      toVersion: 1,
    });
  });

  it('requires rollback permission, same origin, and idempotency', async () => {
    const response = await POST(
      request({
        slug: 'two-fer',
        targetVersion: 1,
        notes: 'Regression in revision 3.',
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.rollback',
      { mutation: true, idempotent: true }
    );
    expect(mocks.execute).toHaveBeenCalledWith({
      problemSlug: 'two-fer',
      targetVersion: 1,
      notes: 'Regression in revision 3.',
      actorUserId: 'publisher-1',
      idempotencyKey: 'catalog-rollback-key-0001',
    });
  });

  it('requires a canonical slug, target version, and explicit notes', async () => {
    const response = await POST(
      request({ slug: '../two-fer', targetVersion: 0, notes: '  ' })
    );

    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_catalog_rollback' },
    });
  });

  it('preserves authorization and rollback conflict errors', async () => {
    mocks.authorize.mockRejectedValueOnce(
      new CoachHttpError(403, 'invalid_origin', 'Same-origin required.')
    );
    const forbidden = await POST(
      request({ slug: 'two-fer', targetVersion: 1, notes: 'Regression.' })
    );
    expect(forbidden.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();

    mocks.authorize.mockResolvedValueOnce({
      userId: 'publisher-1',
      idempotencyKey: 'catalog-rollback-key-0001',
    });
    mocks.execute.mockRejectedValueOnce(
      new mocks.ActionError(
        'invalid_candidate_state',
        'The target revision is already active.',
        409
      )
    );
    const conflict = await POST(
      request({ slug: 'two-fer', targetVersion: 1, notes: 'Regression.' })
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: 'invalid_candidate_state' },
    });
  });
});
