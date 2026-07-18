import { AnonymousIdentityConfigurationError } from '@/features/algorithm-coach/anonymous-events.server';
import { createInitialReviewProgress } from '@/features/algorithm-coach/learning-progress';
import { CoachGuestAlreadyClaimed } from '@/features/algorithm-coach/persistence.server';
import { createInitialCoachState } from '@/features/algorithm-coach/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  enforceCoachRateLimits: vi.fn(),
  claimGuestCoachDataOnServer: vi.fn(),
  readGuestIdentity: vi.fn(),
  deriveGuestSubject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/core/auth', () => ({
  getAuth: vi.fn(async () => ({ api: { getSession: mocks.getSession } })),
}));
vi.mock('@/features/algorithm-coach/rate-limit.server', () => ({
  enforceCoachRateLimits: mocks.enforceCoachRateLimits,
}));
vi.mock('@/features/algorithm-coach/anonymous-events.server', () => ({
  readGuestIdentity: mocks.readGuestIdentity,
  deriveGuestSubject: mocks.deriveGuestSubject,
  AnonymousIdentityConfigurationError: class extends Error {},
}));
vi.mock('@/features/algorithm-coach/persistence.server', async () => {
  class CoachGuestAlreadyClaimed extends Error {}
  return {
    claimGuestCoachDataOnServer: mocks.claimGuestCoachDataOnServer,
    CoachGuestAlreadyClaimed,
  };
});

function claimRequest(
  targetUserId = 'user-1',
  snapshot: unknown = {
    state: createInitialCoachState(),
    importedProblem: null,
    importedDrafts: [],
    reviewProgress: createInitialReviewProgress(),
  }
) {
  return new Request('http://localhost/api/coach/state/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 2,
      claimId: 'guest_claim_12345678',
      targetUserId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      snapshot,
    }),
  });
}

describe('POST /api/coach/state/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DURABLE_GUEST_CLAIM_ENABLED', 'true');
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.enforceCoachRateLimits.mockResolvedValue(null);
    mocks.readGuestIdentity.mockReturnValue('guest_identity_123');
    mocks.deriveGuestSubject.mockReturnValue('subject-hmac');
    mocks.claimGuestCoachDataOnServer.mockResolvedValue({
      claimId: 'guest_claim_12345678',
      status: 'acknowledged',
      revision: 3,
      replayed: false,
    });
  });

  it('persists an authenticated, validated claim', async () => {
    const response = await POST(claimRequest());

    expect(response.status).toBe(200);
    expect(mocks.claimGuestCoachDataOnServer).toHaveBeenCalledWith(
      'user-1',
      'subject-hmac',
      expect.objectContaining({
        claimId: 'guest_claim_12345678',
        targetUserId: 'user-1',
      })
    );
  });

  it('rejects unauthenticated and cross-account claims', async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const unauthenticated = await POST(claimRequest());
    const mismatch = await POST(claimRequest('user-2'));

    expect(unauthenticated.status).toBe(401);
    expect(mismatch.status).toBe(403);
    expect(mocks.claimGuestCoachDataOnServer).not.toHaveBeenCalled();
  });

  it('requires the rollout flag, limiter allowance, and guest cookie', async () => {
    vi.stubEnv('DURABLE_GUEST_CLAIM_ENABLED', 'false');
    const disabled = await POST(claimRequest());
    expect(disabled.status).toBe(404);

    vi.stubEnv('DURABLE_GUEST_CLAIM_ENABLED', 'true');
    mocks.enforceCoachRateLimits.mockResolvedValueOnce(
      Response.json({ error: 'rate_limited' }, { status: 429 })
    );
    const limited = await POST(claimRequest());
    expect(limited.status).toBe(429);

    mocks.readGuestIdentity.mockReturnValueOnce(null);
    const noIdentity = await POST(claimRequest());
    expect(noIdentity.status).toBe(400);
  });

  it('rejects malformed envelopes and snapshots', async () => {
    const malformed = new Request('http://localhost/api/coach/state/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect((await POST(malformed)).status).toBe(400);
    expect(
      (
        await POST(
          claimRequest('user-1', {
            state: {},
            importedProblem: null,
            reviewProgress: createInitialReviewProgress(),
          })
        )
      ).status
    ).toBe(400);
  });

  it('maps ownership, identity configuration, and internal errors safely', async () => {
    mocks.claimGuestCoachDataOnServer.mockRejectedValueOnce(
      new CoachGuestAlreadyClaimed()
    );
    expect((await POST(claimRequest())).status).toBe(409);

    mocks.deriveGuestSubject.mockImplementationOnce(() => {
      throw new AnonymousIdentityConfigurationError();
    });
    expect((await POST(claimRequest())).status).toBe(503);

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.claimGuestCoachDataOnServer.mockRejectedValueOnce(
      new Error('database params: private code')
    );
    const failure = await POST(claimRequest());
    expect(failure.status).toBe(500);
    expect(JSON.stringify(await failure.json())).not.toContain('private code');
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain('private code');
  });
});
