import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('@/core/rbac/permission', () => ({
  PERMISSIONS: { CATALOG_READ: 'admin.catalog.read' },
}));
vi.mock('@/features/algorithm-coach/catalog/admin-auth.server', () => ({
  authorizeCatalogAdmin: mocks.authorize,
}));
vi.mock('@/features/algorithm-coach/catalog/admin-service.server', () => ({
  getCatalogAdminCandidatePreview: mocks.preview,
}));

describe('catalog candidate read-only preview API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ userId: 'reviewer-1' });
    mocks.preview.mockResolvedValue({ schemaVersion: 2 });
  });

  it('loads compiled JSON lazily with read permission', async () => {
    const response = await GET(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates/candidate-1/preview?kind=compiled'
      ),
      { params: Promise.resolve({ candidateId: 'candidate-1' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.preview).toHaveBeenCalledWith('candidate-1', 'compiled');
    await expect(response.json()).resolves.toEqual({
      data: { kind: 'compiled', payload: { schemaVersion: 2 } },
    });
  });

  it('returns 404 when the candidate does not exist', async () => {
    mocks.preview.mockResolvedValueOnce(undefined);
    const response = await GET(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates/candidate-2/preview?kind=upstream'
      ),
      { params: Promise.resolve({ candidateId: 'candidate-2' }) }
    );
    expect(response.status).toBe(404);
  });
});
