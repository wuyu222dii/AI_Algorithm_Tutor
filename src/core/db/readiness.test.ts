import { describe, expect, it, vi } from 'vitest';

import migrationJournal from '@/config/db/migrations/meta/_journal.json';

import {
  checkAiConfiguration,
  checkAuthenticationConfiguration,
  checkMigrationVersions,
  checkRedisReadiness,
  checkRequiredConfiguration,
  liveHealthStatus,
  readyHealthStatus,
} from './readiness';

const validProductionEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_PROVIDER: 'postgresql',
  DATABASE_URL: 'postgresql://app:secret@localhost:5432/algocoach',
  DATABASE_APPLICATION_ROLE: 'app',
  AUTH_URL: 'https://algocoach.example',
  AUTH_SECRET: 'a-secure-auth-secret-with-at-least-32-characters',
  OPENROUTER_API_KEY: 'test-openrouter-key',
  REDIS_URL: 'https://redis.example.test',
  REDIS_TOKEN: 'test-redis-token',
  TRUSTED_PROXY_HEADERS: 'x-forwarded-for',
  GOOGLE_AUTH_ENABLED: 'true',
  GOOGLE_ONE_TAP_ENABLED: 'false',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
};

describe('health checks', () => {
  it('returns a dependency-free liveness response', () => {
    const now = new Date('2026-07-13T00:00:00.000Z');
    expect(liveHealthStatus(now)).toMatchObject({
      status: 'ok',
      kind: 'live',
      service: 'algocoach',
      timestamp: now.toISOString(),
    });
  });

  it('accepts complete production configuration', () => {
    expect(checkRequiredConfiguration(validProductionEnv)).toEqual({
      status: 'ok',
    });
  });

  it('rejects proxy header names that the rate limiter cannot trust', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        TRUSTED_PROXY_HEADERS: 'forwarded, x-client-ip',
      })
    ).toMatchObject({
      status: 'error',
      details: { invalid: ['TRUSTED_PROXY_HEADERS'] },
    });
  });

  it('reports configuration names without exposing their values', () => {
    const result = checkRequiredConfiguration({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://secret-value',
      GOOGLE_AUTH_ENABLED: 'true',
      GOOGLE_ONE_TAP_ENABLED: 'true',
      COACH_DEMO_FALLBACK_ENABLED: 'true',
    });

    expect(result).toMatchObject({
      status: 'error',
      code: 'invalid_configuration',
      details: {
        missing: [
          'DATABASE_APPLICATION_ROLE',
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
          'AUTH_URL',
          'REDIS_URL',
          'REDIS_TOKEN',
          'TRUSTED_PROXY_HEADERS',
          'OPENROUTER_API_KEY',
        ],
        invalid: ['GOOGLE_ONE_TAP_ENABLED', 'AUTH_SECRET'],
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('allows demo fallback only outside production', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        NODE_ENV: 'development',
        OPENROUTER_API_KEY: '',
        COACH_DEMO_FALLBACK_ENABLED: 'true',
      })
    ).toEqual({ status: 'ok' });
    expect(
      checkAiConfiguration({
        NODE_ENV: 'development',
        OPENROUTER_API_KEY: '',
        COACH_DEMO_FALLBACK_ENABLED: 'true',
      })
    ).toMatchObject({ status: 'ok', details: { mode: 'demo' } });
    expect(
      checkAiConfiguration({
        NODE_ENV: 'production',
        OPENROUTER_API_KEY: '',
        COACH_DEMO_FALLBACK_ENABLED: 'true',
      })
    ).toMatchObject({
      status: 'error',
      code: 'ai_not_configured',
      details: { liveRequired: true },
    });
  });

  it('rejects malformed auth and AI configuration without returning values', () => {
    const auth = checkAuthenticationConfiguration({
      NODE_ENV: 'production',
      AUTH_URL: 'not-a-url',
      AUTH_SECRET: 'short',
      GOOGLE_AUTH_ENABLED: 'true',
    });
    const ai = checkAiConfiguration({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: 'private-key',
      OPENROUTER_BASE_URL: 'not-a-url',
      ALGO_COACH_MODEL: 'unapproved/model',
      ALGO_COACH_HINT_FALLBACK_MODEL: 'also-unapproved/model',
    });

    expect(auth.status).toBe('error');
    expect(ai).toMatchObject({
      status: 'error',
      details: {
        invalidModelSettings: [
          'ALGO_COACH_MODEL',
          'ALGO_COACH_HINT_FALLBACK_MODEL',
        ],
      },
    });
    expect(JSON.stringify({ auth, ai })).not.toContain('private-key');
  });

  it('uses process-local rate limiting outside production when Redis is absent', async () => {
    await expect(
      checkRedisReadiness({ NODE_ENV: 'development' })
    ).resolves.toMatchObject({
      status: 'ok',
      details: { mode: 'process-local', required: false },
    });
  });

  it('probes configured Redis without exposing credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ result: 'PONG' }));
    const result = await checkRedisReadiness(validProductionEnv, fetcher);

    expect(result).toMatchObject({
      status: 'ok',
      details: { mode: 'distributed' },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify(['PING']));
    expect(JSON.stringify(result)).not.toContain('test-redis-token');
  });

  it('fails the Redis dependency check in production when it is unavailable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      checkRedisReadiness(validProductionEnv, fetcher)
    ).resolves.toMatchObject({
      status: 'error',
      code: 'redis_unavailable',
    });
    await expect(
      checkRedisReadiness({ NODE_ENV: 'production' }, fetcher)
    ).resolves.toMatchObject({
      status: 'error',
      code: 'redis_not_configured',
    });
  });

  it('detects missing, extra, and out-of-order migrations', () => {
    const expected = migrationJournal.entries.map((entry) => entry.when);
    expect(checkMigrationVersions(expected).status).toBe('ok');
    expect(checkMigrationVersions(expected.slice(0, -1)).status).toBe('error');
    expect(checkMigrationVersions([...expected, 999]).status).toBe('error');
    expect(checkMigrationVersions([...expected].reverse()).status).toBe(
      'error'
    );
  });

  it('fails readiness without attempting a connection when URL is absent', async () => {
    const status = await readyHealthStatus(
      {
        ...validProductionEnv,
        DATABASE_URL: '',
      },
      undefined,
      {
        fetch: vi.fn().mockResolvedValue(Response.json({ result: 'PONG' })),
      }
    );

    expect(status.status).toBe('error');
    expect(status.checks?.database.code).toBe('database_url_missing');
    expect(status.checks?.migrations.code).toBe('database_unavailable');
    expect(status.checks?.redis.status).toBe('ok');
  });
});
