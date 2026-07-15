import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authorizeCatalogAdmin } from './admin-auth.server';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/core/auth', () => ({
  getAuth: vi.fn(async () => ({ api: { getSession: mocks.getSession } })),
}));
vi.mock('@/core/rbac/permission', () => ({
  PERMISSIONS: {
    CATALOG_READ: 'admin.catalog.read',
    CATALOG_REVIEW: 'admin.catalog.review',
    CATALOG_PUBLISH: 'admin.catalog.publish',
    CATALOG_ROLLBACK: 'admin.catalog.rollback',
  },
}));
vi.mock('@/shared/services/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

describe('catalog admin authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 'user-admin' } });
    mocks.hasPermission.mockResolvedValue(true);
  });

  it('requires an authenticated user with the requested permission', async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    await expect(
      authorizeCatalogAdmin(
        new Request('http://localhost:3000/api/admin/catalog/candidates'),
        'admin.catalog.read'
      )
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });

    mocks.getSession.mockResolvedValueOnce({ user: { id: 'user-admin' } });
    mocks.hasPermission.mockResolvedValueOnce(false);
    await expect(
      authorizeCatalogAdmin(
        new Request('http://localhost:3000/api/admin/catalog/candidates'),
        'admin.catalog.read'
      )
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('requires same-origin mutations and an idempotency key', async () => {
    const request = new Request(
      'http://localhost:3000/api/admin/catalog/candidates/candidate-1/approve',
      {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'idempotency-key': 'catalog-test-key-0001',
        },
      }
    );
    await expect(
      authorizeCatalogAdmin(request, 'admin.catalog.review', {
        mutation: true,
        idempotent: true,
      })
    ).resolves.toEqual({
      userId: 'user-admin',
      idempotencyKey: 'catalog-test-key-0001',
    });

    await expect(
      authorizeCatalogAdmin(
        new Request(request.url, {
          method: 'POST',
          headers: { origin: 'https://attacker.example' },
        }),
        'admin.catalog.review',
        { mutation: true, idempotent: true }
      )
    ).rejects.toMatchObject({ status: 403, code: 'invalid_origin' });
  });

  it('rejects mutation requests with a missing origin or malformed key', async () => {
    await expect(
      authorizeCatalogAdmin(
        new Request(
          'http://localhost:3000/api/admin/catalog/candidates/candidate-1/approve',
          {
            method: 'POST',
            headers: { 'idempotency-key': 'catalog-test-key-0001' },
          }
        ),
        'admin.catalog.review',
        { mutation: true, idempotent: true }
      )
    ).rejects.toMatchObject({ status: 403, code: 'invalid_origin' });

    await expect(
      authorizeCatalogAdmin(
        new Request(
          'http://localhost:3000/api/admin/catalog/candidates/candidate-1/approve',
          {
            method: 'POST',
            headers: {
              origin: 'http://localhost:3000',
              'idempotency-key': 'short',
            },
          }
        ),
        'admin.catalog.review',
        { mutation: true, idempotent: true }
      )
    ).rejects.toMatchObject({
      status: 400,
      code: 'invalid_idempotency_key',
    });
  });

  it('does not require mutation headers for read access', async () => {
    await expect(
      authorizeCatalogAdmin(
        new Request('http://localhost:3000/api/admin/catalog/candidates'),
        'admin.catalog.read'
      )
    ).resolves.toEqual({
      userId: 'user-admin',
      idempotencyKey: undefined,
    });
  });
});
