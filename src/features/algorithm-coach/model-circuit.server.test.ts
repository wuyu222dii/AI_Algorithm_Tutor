import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetCoachModelCircuits } from './model';
import {
  isDistributedCoachCircuitOpen,
  recordDistributedCoachModelFailure,
  recordDistributedCoachModelSuccess,
} from './model-circuit.server';

const originalEnv = { ...process.env };

describe('distributed relay circuit breaker', () => {
  beforeEach(() => {
    resetCoachModelCircuits();
    process.env.REDIS_URL = 'https://redis.example.test';
    process.env.REDIS_TOKEN = 'redis-test-token';
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
    resetCoachModelCircuits();
  });

  it('checks a relay-origin-and-model circuit through Redis', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ result: 1 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(
      isDistributedCoachCircuitOpen('https://relay.example:primary-model')
    ).resolves.toBe(true);
    const command = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(command[0]).toBe('EXISTS');
    expect(command[1]).toMatch(/^algocoach:relay-circuit:/);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('primary-model');
  });

  it('records eligible failures atomically and clears state on success', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ result: 0 }));
    vi.stubGlobal('fetch', fetcher);
    const key = 'https://relay.example:primary-model';

    await recordDistributedCoachModelFailure(key, 'channel_unavailable');
    await recordDistributedCoachModelSuccess(key);

    const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(first[0]).toBe('EVAL');
    expect(second[0]).toBe('DEL');
  });

  it('fails closed in production when Redis cannot be checked', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(
      isDistributedCoachCircuitOpen('https://relay.example:primary-model')
    ).resolves.toBe(true);
  });

  it('fails closed on a malformed successful Redis response', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'backend failure' }))
    );

    await expect(
      isDistributedCoachCircuitOpen('https://relay.example:primary-model')
    ).resolves.toBe(true);
  });

  it('fails closed on an invalid Redis EXISTS result', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ result: 'garbage' }))
    );

    await expect(
      isDistributedCoachCircuitOpen('https://relay.example:primary-model')
    ).resolves.toBe(true);
  });

  it('does not send a production Redis token over plaintext HTTP', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('REDIS_URL', 'http://redis.example.test');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    await expect(
      isDistributedCoachCircuitOpen('https://relay.example:primary-model')
    ).resolves.toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
