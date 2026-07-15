import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  list: vi.fn(),
}));

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
  listCatalogAdminCanonicalCases: mocks.list,
}));

const context = {
  params: Promise.resolve({ candidateId: 'candidate-1' }),
};

describe('catalog canonical case API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ userId: 'reviewer-1' });
    mocks.list.mockResolvedValue({
      items: [{ sourceTestUuid: 'uuid-1', status: 'mapped' }],
      total: 1,
      mapped: 1,
      selected: [],
    });
  });

  it('paginates mappings for the saved signature with read permission', async () => {
    const response = await GET(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates/candidate-1/canonical-cases?cursor=5&limit=25'
      ),
      context
    );

    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.read'
    );
    expect(mocks.list).toHaveBeenCalledWith('candidate-1', {
      cursor: 5,
      limit: 25,
    });
  });

  it('previews an unsaved signature without persisting it', async () => {
    const signature = {
      parameters: [{ name: 'phrase', type: { kind: 'string' } }],
      returns: { kind: 'string' },
    };
    const entryPoints = {
      javascript: 'acronym',
      python: 'acronym',
      typescript: 'acronym',
    };
    const response = await POST(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates/candidate-1/canonical-cases',
        {
          method: 'POST',
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            signature,
            entryPoints,
            cursor: 0,
            limit: 50,
          }),
        }
      ),
      context
    );

    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request),
      'admin.catalog.review',
      { mutation: true }
    );
    expect(mocks.list).toHaveBeenCalledWith('candidate-1', {
      signature,
      entryPoints,
      cursor: 0,
      limit: 50,
    });
  });

  it('rejects malformed preview signatures before loading source data', async () => {
    const response = await POST(
      new Request(
        'http://localhost:3000/api/admin/catalog/candidates/candidate-1/canonical-cases',
        {
          method: 'POST',
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ signature: { parameters: 'bad' } }),
        }
      ),
      context
    );

    expect(response.status).toBe(422);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
