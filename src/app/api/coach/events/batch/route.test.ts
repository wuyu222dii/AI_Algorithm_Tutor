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

function request(events: unknown[], checkpoint?: unknown) {
  return new Request('http://localhost/api/coach/events/batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'algocoach_guest_id=guest_test_123',
    },
    body: JSON.stringify({ events, ...(checkpoint ? { checkpoint } : {}) }),
  });
}

describe('POST /api/coach/events/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceCoachRateLimits.mockResolvedValue(null);
    mocks.ingestAnonymousProductEvents.mockResolvedValue(
      Response.json({ data: { accepted: 1, duplicates: 0 } }, { status: 202 })
    );
  });

  it('accepts up to 50 strictly shaped anonymous events', async () => {
    const events = Array.from({ length: 50 }, (_, index) => ({
      id: `event_${String(index).padStart(8, '0')}`,
      name: index ? 'code_run' : 'visitor_started',
      timestamp: new Date().toISOString(),
      problemSlug: 'two-value-target',
    }));
    const response = await POST(request(events));

    expect(response.status).toBe(202);
    expect(mocks.ingestAnonymousProductEvents).toHaveBeenCalledWith(
      expect.any(Request),
      events,
      undefined
    );
  });

  it('forwards a monotonic delivery checkpoint', async () => {
    const events = [
      {
        id: 'event_12345678',
        name: 'visitor_started',
        timestamp: new Date().toISOString(),
      },
    ];
    const checkpoint = {
      sequence: 3,
      generatedTotal: 5,
      deliveredTotal: 4,
    };

    const response = await POST(request(events, checkpoint));

    expect(response.status).toBe(202);
    expect(mocks.ingestAnonymousProductEvents).toHaveBeenCalledWith(
      expect.any(Request),
      events,
      checkpoint
    );
  });

  it('rejects oversized batches and sensitive properties', async () => {
    const base = {
      id: 'event_12345678',
      name: 'code_run',
      timestamp: new Date().toISOString(),
    };
    const oversized = await POST(
      request(
        Array.from({ length: 51 }, (_, index) => ({
          ...base,
          id: `event_${index}_12345678`,
        }))
      )
    );
    const sensitive = await POST(
      request([{ ...base, code: 'return privateSolution' }])
    );

    expect(oversized.status).toBe(400);
    expect(sensitive.status).toBe(400);
    expect(mocks.ingestAnonymousProductEvents).not.toHaveBeenCalled();
  });
});
