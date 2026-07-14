import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  enforceCoachRateLimits: vi.fn(),
  exportCoachLearningData: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/core/auth', () => ({
  getAuth: async () => ({
    api: { getSession: mocks.getSession },
  }),
}));

vi.mock('@/features/algorithm-coach/export.server', () => ({
  exportCoachLearningData: mocks.exportCoachLearningData,
}));

vi.mock('@/features/algorithm-coach/rate-limit.server', () => ({
  enforceCoachRateLimits: mocks.enforceCoachRateLimits,
}));

function exportRequest(userId = 'another-account') {
  return new Request(
    `http://localhost/api/coach/export?userId=${encodeURIComponent(userId)}`,
    {
      headers: {
        accept: 'application/json',
        'x-user-id': userId,
      },
    }
  );
}

describe('GET /api/coach/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceCoachRateLimits.mockResolvedValue(null);
    mocks.exportCoachLearningData.mockImplementation(
      async (userId: string) => ({
        exportVersion: 3,
        exportedAt: '2026-07-14T00:00:00.000Z',
        accountId: userId,
        learningData: {
          profiles: [],
          practiceSessions: [],
          codeRuns: [],
          learningArtifacts: [],
          assessments: [],
          productEvents: [],
          reviewItems: [],
          privateProblems: [],
          privateProblemTestCases: [],
          syncStates: [],
          syncMutations: [],
        },
        counts: {},
      })
    );
  });

  it('rejects unauthenticated exports before querying learning data', async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(exportRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(mocks.enforceCoachRateLimits).not.toHaveBeenCalled();
    expect(mocks.exportCoachLearningData).not.toHaveBeenCalled();
  });

  it('ignores requested identities and exports only the session account', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'session-account', email: 'owner@example.test' },
    });

    const response = await GET(exportRequest('target-account'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.enforceCoachRateLimits).toHaveBeenCalledWith(
      expect.any(Request),
      'state',
      'session-account'
    );
    expect(mocks.exportCoachLearningData).toHaveBeenCalledTimes(1);
    expect(mocks.exportCoachLearningData).toHaveBeenCalledWith(
      'session-account'
    );
    expect(body.data.accountId).toBe('session-account');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toContain(
      'algocoach-learning-data-2026-07-14.json'
    );
  });

  it('honors the authenticated state rate limit before reading the database', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'session-account' } });
    mocks.enforceCoachRateLimits.mockResolvedValue(
      Response.json({ error: { code: 'rate_limited' } }, { status: 429 })
    );

    const response = await GET(exportRequest());

    expect(response.status).toBe(429);
    expect(mocks.exportCoachLearningData).not.toHaveBeenCalled();
  });

  it('does not expose database errors', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'session-account' } });
    mocks.exportCoachLearningData.mockRejectedValue(
      new Error('relation secret_schema.coach_review_item does not exist')
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await GET(exportRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({
      code: 'export_failed',
      message: 'Learning data could not be exported.',
    });
    expect(JSON.stringify(body)).not.toContain('secret_schema');
    consoleError.mockRestore();
  });
});
