import { CoachHttpError } from '@/features/algorithm-coach/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  health: vi.fn(),
}));

vi.mock('@/core/rbac/permission', () => ({
  PERMISSIONS: { CATALOG_READ: 'admin.catalog.read' },
}));
vi.mock('@/features/algorithm-coach/catalog/admin-auth.server', () => ({
  authorizeCatalogAdmin: mocks.authorize,
}));
vi.mock('@/features/algorithm-coach/catalog/admin-service.server', () => ({
  getCatalogAdminSyncHealth: mocks.health,
}));
vi.mock(
  '@/features/algorithm-coach/catalog/admin-observability.server',
  () => ({
    recordCatalogAdminFailure: vi.fn(),
  })
);

describe('catalog sync health API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ userId: 'admin-1' });
    mocks.health.mockResolvedValue({
      source: {
        key: 'exercism-problem-specifications',
        name: 'Exercism Problem Specifications',
        status: 'active',
        syncEnabled: true,
        lastSuccessfulRevision: 'abc123',
        updatedAt: '2026-08-24T00:00:00.000Z',
      },
      scheduledSyncReady: true,
      consecutiveFailures: 0,
      pendingCandidateCount: 3,
      recentRuns: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns uncached sync health for catalog readers', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/admin/catalog/sync-health?limit=5')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.read'
    );
    expect(mocks.health).toHaveBeenCalledWith(5);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        scheduledSyncReady: true,
        pendingCandidateCount: 3,
      },
    });
  });

  it('rejects invalid limits', async () => {
    const response = await GET(
      new Request(
        'http://localhost:3000/api/admin/catalog/sync-health?limit=999'
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it('maps unexpected failures to unavailable', async () => {
    mocks.health.mockRejectedValue(new Error('db down'));
    const response = await GET(
      new Request('http://localhost:3000/api/admin/catalog/sync-health')
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'catalog_admin_unavailable' },
    });
  });

  it('forwards authorization failures', async () => {
    mocks.authorize.mockRejectedValue(
      new CoachHttpError(403, 'forbidden', 'Forbidden')
    );
    const response = await GET(
      new Request('http://localhost:3000/api/admin/catalog/sync-health')
    );
    expect(response.status).toBe(403);
  });
});
