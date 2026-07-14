import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireCoachCapacity,
  commitCoachFailedUsage,
  commitCoachUsage,
  releaseCoachCapacity,
  type CoachCapacityLease,
} from './rate-limit.server';

vi.mock('server-only', () => ({}));
vi.mock('@/core/auth', () => ({
  getAuth: vi.fn().mockRejectedValue(new Error('auth unavailable')),
}));
vi.mock('@/shared/lib/observability', () => ({
  recordOperationalEvent: vi.fn(),
}));

function request() {
  return new Request('http://localhost/api/coach', {
    method: 'POST',
    headers: { cookie: 'coach_visitor=test-visitor' },
  });
}

function expectLease(value: CoachCapacityLease | Response) {
  expect(value).not.toBeInstanceOf(Response);
  return value as CoachCapacityLease;
}

describe('coach generation capacity', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('REDIS_TOKEN', '');
    vi.stubEnv('COACH_MAX_CONCURRENCY', '1');
    globalThis.__coachCapacityStore = new Map();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses a real lease and releases the concurrent slot', async () => {
    const first = expectLease(
      await acquireCoachCapacity(request(), 'artifact')
    );
    const blocked = await acquireCoachCapacity(request(), 'artifact');
    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(429);
    expect(await (blocked as Response).json()).toMatchObject({
      error: 'coach_concurrency_limit',
    });

    await releaseCoachCapacity(first);
    await releaseCoachCapacity(first);
    const next = expectLease(await acquireCoachCapacity(request(), 'artifact'));
    await releaseCoachCapacity(next);
  });

  it('applies an independent trusted-IP budget across rotated guest cookies', async () => {
    vi.stubEnv('COACH_IP_DAILY_TOKENS', '1000');
    vi.stubEnv('COACH_ARTIFACT_RESERVED_TOKENS', '800');
    const firstRequest = new Request('http://localhost/api/coach', {
      method: 'POST',
      headers: {
        cookie: 'coach_visitor=first',
        'x-forwarded-for': '203.0.113.8',
      },
    });
    const first = expectLease(
      await acquireCoachCapacity(firstRequest, 'artifact')
    );
    await commitCoachUsage(
      first,
      { inputTokens: 700, outputTokens: 200, totalTokens: 900 },
      0.001
    );

    const rotatedCookie = new Request('http://localhost/api/coach', {
      method: 'POST',
      headers: {
        cookie: 'coach_visitor=rotated',
        'x-forwarded-for': '203.0.113.8',
      },
    });
    const blocked = await acquireCoachCapacity(rotatedCookie, 'artifact');
    expect(blocked).toBeInstanceOf(Response);
    expect(await (blocked as Response).json()).toMatchObject({
      error: 'coach_daily_budget_exceeded',
    });
  });

  it('settles real usage and blocks a request over the daily token budget', async () => {
    vi.stubEnv('COACH_GUEST_DAILY_TOKENS', '1000');
    vi.stubEnv('COACH_ARTIFACT_RESERVED_TOKENS', '800');
    const lease = expectLease(
      await acquireCoachCapacity(request(), 'artifact')
    );
    await commitCoachUsage(
      lease,
      { inputTokens: 700, outputTokens: 200, totalTokens: 900 },
      0.001
    );

    const blocked = await acquireCoachCapacity(request(), 'artifact');
    expect(blocked).toBeInstanceOf(Response);
    expect(await (blocked as Response).json()).toMatchObject({
      error: 'coach_daily_budget_exceeded',
    });
  });

  it('charges conservative budget for failed and repaired model attempts', async () => {
    vi.stubEnv('COACH_GUEST_DAILY_TOKENS', '2500');
    vi.stubEnv('COACH_ARTIFACT_RESERVED_TOKENS', '800');
    const failed = expectLease(
      await acquireCoachCapacity(request(), 'artifact')
    );
    await commitCoachFailedUsage(failed, 2);

    const repaired = expectLease(
      await acquireCoachCapacity(request(), 'artifact')
    );
    await commitCoachUsage(
      repaired,
      { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
      0.001,
      2
    );

    const blocked = await acquireCoachCapacity(request(), 'artifact');
    expect(blocked).toBeInstanceOf(Response);
    expect(await (blocked as Response).json()).toMatchObject({
      error: 'coach_daily_budget_exceeded',
    });
  });

  it('rejects one model request whose conservative reservation exceeds the daily cost cap', async () => {
    vi.stubEnv('COACH_GUEST_DAILY_COST_USD', '0.05');
    vi.stubEnv('COACH_INPUT_COST_PER_MILLION_USD', '');
    vi.stubEnv('COACH_OUTPUT_COST_PER_MILLION_USD', '');
    const blocked = await acquireCoachCapacity(
      request(),
      'artifact',
      undefined,
      {
        models: ['openai/gpt-5.5'],
        input: { code: 'x'.repeat(2_000) },
        maxOutputTokens: 900,
        maxAttempts: 3,
      }
    );

    expect(blocked).toBeInstanceOf(Response);
    expect(await (blocked as Response).json()).toMatchObject({
      error: 'coach_daily_budget_exceeded',
    });
  });

  it('reserves fallback and repair attempts before admitting the request', async () => {
    vi.stubEnv('COACH_GUEST_DAILY_COST_USD', '0.05');
    vi.stubEnv('COACH_INPUT_COST_PER_MILLION_USD', '');
    vi.stubEnv('COACH_OUTPUT_COST_PER_MILLION_USD', '');
    const blocked = await acquireCoachCapacity(
      request(),
      'artifact',
      undefined,
      {
        models: ['openai/gpt-5.5'],
        input: { code: 'return value;' },
        maxOutputTokens: 100,
        maxAttempts: 3,
      }
    );

    expect(blocked).toBeInstanceOf(Response);
    expect(await (blocked as Response).json()).toMatchObject({
      error: 'coach_daily_budget_exceeded',
    });
  });

  it('fails closed without Redis in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const blocked = await acquireCoachCapacity(request(), 'chat');
    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(503);
  });

  it('uses authenticated Redis Lua reservations and settlement in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('REDIS_URL', 'https://redis.example.test');
    vi.stubEnv('REDIS_TOKEN', 'redis-secret');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: [0, 30_000] }))
      .mockResolvedValueOnce(Response.json({ result: 1 }));
    vi.stubGlobal('fetch', fetcher);

    const lease = expectLease(
      await acquireCoachCapacity(request(), 'artifact')
    );
    await commitCoachUsage(
      lease,
      { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      0.0002
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls as Array<[string, RequestInit]>) {
      expect(init.headers).toMatchObject({
        authorization: 'Bearer redis-secret',
      });
      expect(JSON.parse(String(init.body))[0]).toBe('EVAL');
    }
  });
});
