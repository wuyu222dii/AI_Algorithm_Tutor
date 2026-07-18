import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  enforceCoachRateLimits: vi.fn(),
  ingestAnonymousProductEvents: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/algorithm-coach/rate-limit.server', () => ({
  enforceCoachRateLimits: mocks.enforceCoachRateLimits,
}));
vi.mock('@/features/algorithm-coach/anonymous-event-ingestion.server', () => ({
  ingestAnonymousProductEvents: mocks.ingestAnonymousProductEvents,
}));

function request(body: unknown, cookie = 'algocoach_guest_id=guest_test_123') {
  return new Request('http://localhost/api/coach/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

describe('POST /api/coach/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceCoachRateLimits.mockResolvedValue(null);
    mocks.ingestAnonymousProductEvents.mockImplementation(
      async (incoming: Request) =>
        new Response(null, {
          status: incoming.headers.get('cookie') ? 202 : 400,
        })
    );
  });

  it('records a whitelisted event with hashed identifiers only', async () => {
    const response = await POST(
      request({
        id: 'event_12345678',
        name: 'visitor_started',
        timestamp: new Date().toISOString(),
      })
    );

    expect(response.status).toBe(202);
    expect(mocks.ingestAnonymousProductEvents).toHaveBeenCalledWith(
      expect.any(Request),
      [expect.objectContaining({ name: 'visitor_started' })]
    );
    expect(
      JSON.stringify(mocks.ingestAnonymousProductEvents.mock.calls)
    ).not.toContain('guest_test_123');
  });

  it.each(['language_selected', 'typescript_transpile_failed'] as const)(
    'accepts the %s language funnel event',
    async (name) => {
      const response = await POST(
        request({
          id: `event_${name}`,
          name,
          timestamp: new Date().toISOString(),
          problemSlug: 'first-unique-position',
        })
      );

      expect(response.status).toBe(202);
      expect(mocks.ingestAnonymousProductEvents).toHaveBeenCalledWith(
        expect.any(Request),
        [expect.objectContaining({ name })]
      );
    }
  );

  it('rejects missing identities and non-whitelisted event names', async () => {
    const missingIdentity = await POST(
      request(
        {
          id: 'event_12345678',
          name: 'visitor_started',
          timestamp: new Date().toISOString(),
        },
        ''
      )
    );
    const invalidName = await POST(
      request({
        id: 'event_12345678',
        name: 'email_captured',
        timestamp: new Date().toISOString(),
        email: 'private@example.com',
      })
    );

    expect(missingIdentity.status).toBe(400);
    expect(invalidName.status).toBe(400);
    expect(mocks.ingestAnonymousProductEvents).toHaveBeenCalledTimes(1);
  });
});
