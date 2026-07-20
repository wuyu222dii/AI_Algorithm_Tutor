import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enforceDistributedWindowRateLimit,
  enforceWindowRateLimit,
} from './rate-limit';

function createRequest(ip = '203.0.113.10') {
  return new Request('https://algocoach.test/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('window rate limiting', () => {
  beforeEach(() => {
    globalThis.__windowRateLimitStore = new Map();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.TRUSTED_PROXY_HEADERS;
  });

  it('allows consecutive requests within the configured threshold', () => {
    const options = {
      windowMs: 60_000,
      max: 2,
      keyPrefix: 'test-auth-account',
      identity: 'extra' as const,
      extraKey: 'learner@example.test',
    };

    expect(enforceWindowRateLimit(createRequest(), options)).toBeNull();
    expect(enforceWindowRateLimit(createRequest(), options)).toBeNull();
  });

  it('returns 429 after the threshold is exceeded', async () => {
    const options = {
      windowMs: 60_000,
      max: 2,
      keyPrefix: 'test-auth-account',
      identity: 'extra' as const,
      extraKey: 'learner@example.test',
    };

    enforceWindowRateLimit(createRequest(), options);
    enforceWindowRateLimit(createRequest(), options);
    const limited = enforceWindowRateLimit(createRequest(), options);

    expect(limited?.status).toBe(429);
    expect(limited?.headers.get('cache-control')).toBe('no-store');
    expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0);
    await expect(limited?.json()).resolves.toMatchObject({
      error: 'too_many_requests',
    });
  });

  it('isolates account keys even when requests share the same source', () => {
    const baseOptions = {
      windowMs: 60_000,
      max: 1,
      keyPrefix: 'test-auth-account-isolation',
      identity: 'extra' as const,
    };
    const request = createRequest('198.51.100.20');

    expect(
      enforceWindowRateLimit(request, {
        ...baseOptions,
        extraKey: 'first@example.test',
      })
    ).toBeNull();
    expect(
      enforceWindowRateLimit(request, {
        ...baseOptions,
        extraKey: 'first@example.test',
      })?.status
    ).toBe(429);
    expect(
      enforceWindowRateLimit(request, {
        ...baseOptions,
        extraKey: 'second@example.test',
      })
    ).toBeNull();
  });

  it('uses the shared Redis counter when REST credentials are configured', async () => {
    process.env.REDIS_URL = 'https://redis.example.test';
    process.env.REDIS_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: [3, 45_000] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await enforceDistributedWindowRateLimit(createRequest(), {
      windowMs: 60_000,
      max: 2,
      keyPrefix: 'shared-test',
      identity: 'source',
    });

    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toBe('45');
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).not.toContain('203.0.113.10');
  });

  it('ignores forwarded addresses in production until a trusted header is configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const options = {
      windowMs: 60_000,
      max: 1,
      keyPrefix: 'trusted-proxy-test',
      identity: 'source' as const,
    };

    expect(
      enforceWindowRateLimit(createRequest('198.51.100.1'), options)
    ).toBeNull();
    expect(
      enforceWindowRateLimit(createRequest('198.51.100.2'), options)?.status
    ).toBe(429);

    process.env.TRUSTED_PROXY_HEADERS = 'x-forwarded-for';
    globalThis.__windowRateLimitStore = new Map();
    expect(
      enforceWindowRateLimit(createRequest('198.51.100.1'), options)
    ).toBeNull();
    expect(
      enforceWindowRateLimit(createRequest('198.51.100.2'), options)
    ).toBeNull();
  });

  it('fails closed when the configured Redis backend is unavailable', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.REDIS_URL = 'https://redis.example.test';
    process.env.REDIS_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const response = await enforceDistributedWindowRateLimit(createRequest(), {
      windowMs: 60_000,
      max: 2,
      keyPrefix: 'shared-test',
      identity: 'source',
      failClosed: true,
    });

    expect(response?.status).toBe(503);
    expect(errorLog).toHaveBeenCalledOnce();
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
      event: 'rate_limit_backend_failed',
      level: 'error',
      error: { name: 'Error' },
    });
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain('offline');
  });

  it('fails closed without Redis instead of accumulating local counters', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await enforceDistributedWindowRateLimit(createRequest(), {
      windowMs: 60_000,
      max: 2,
      keyPrefix: 'shared-test',
      identity: 'source',
      failClosed: true,
    });

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: 'rate_limit_unavailable',
    });
    expect(errorLog).toHaveBeenCalledOnce();
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
      event: 'rate_limit_backend_failed',
      reason: 'not_configured',
    });
  });
});
