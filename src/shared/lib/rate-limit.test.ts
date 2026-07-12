import { beforeEach, describe, expect, it } from 'vitest';

import { enforceWindowRateLimit } from './rate-limit';

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
});
