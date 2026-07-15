import { CoachHttpError } from '@/features/algorithm-coach/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  QueryError: class QueryError extends Error {},
  authorize: vi.fn(),
  list: vi.fn(),
  capabilities: vi.fn(),
}));

vi.mock('@/core/rbac/permission', () => ({
  PERMISSIONS: { CATALOG_READ: 'admin.catalog.read' },
}));
vi.mock('@/features/algorithm-coach/catalog/admin-auth.server', () => ({
  authorizeCatalogAdmin: mocks.authorize,
}));
vi.mock('@/features/algorithm-coach/catalog/admin-service.server', () => ({
  CatalogAdminQueryError: mocks.QueryError,
  listCatalogAdminCandidates: mocks.list,
  catalogAdminCapabilities: mocks.capabilities,
}));

describe('catalog candidate list API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ userId: 'admin-1' });
    mocks.list.mockResolvedValue({
      items: [{ id: 'candidate-1' }],
      nextCursor: undefined,
    });
    mocks.capabilities.mockResolvedValue({
      review: true,
      publish: false,
      rollback: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires read permission and returns uncached candidate data', async () => {
    const response = await GET(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates?status=validated&limit=25'
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.read'
    );
    expect(mocks.list).toHaveBeenCalledWith({
      status: 'validated',
      limit: 25,
    });
    await expect(response.json()).resolves.toEqual({
      data: {
        items: [{ id: 'candidate-1' }],
        capabilities: { review: true, publish: false, rollback: false },
      },
    });
  });

  it('rejects invalid filters before querying the catalog', async () => {
    const response = await GET(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates?status=unknown&limit=200'
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.capabilities).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_query' },
    });
  });

  it('preserves authorization errors and hides service failures', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.authorize.mockRejectedValueOnce(
      new CoachHttpError(403, 'forbidden', 'Permission denied.')
    );
    const forbidden = await GET(
      new Request('http://localhost:3000/api/admin/catalog/candidates')
    );
    expect(forbidden.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();

    mocks.authorize.mockResolvedValueOnce({ userId: 'admin-1' });
    mocks.list.mockRejectedValueOnce(
      new Error('database.internal connection string leaked')
    );
    const unavailable = await GET(
      new Request('http://localhost:3000/api/admin/catalog/candidates')
    );
    expect(unavailable.status).toBe(503);
    const payload = await unavailable.json();
    expect(payload).toMatchObject({
      error: { code: 'catalog_admin_unavailable' },
    });
    expect(JSON.stringify(payload)).not.toContain('database.internal');
    expect(errorLog).toHaveBeenCalledOnce();
    const serializedLog = String(errorLog.mock.calls[0]?.[0]);
    expect(serializedLog).not.toContain('database.internal');
    expect(serializedLog).not.toContain('connection string leaked');
  });
});
