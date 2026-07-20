import { describe, expect, it, vi } from 'vitest';

import migrationJournal from '@/config/db/migrations/meta/_journal.json';

import {
  checkAiConfiguration,
  checkAuthenticationConfiguration,
  checkCatalogReadiness,
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
  NEXT_PUBLIC_APP_URL: 'https://algocoach.example',
  NEXT_PUBLIC_SUPPORT_EMAIL: 'support@example.test',
  AUTH_URL: 'https://algocoach.example',
  AUTH_SECRET: 'a-secure-auth-secret-with-at-least-32-characters',
  EMAIL_AUTH_ENABLED: 'false',
  GITHUB_AUTH_ENABLED: 'false',
  AI_RELAY_API_KEY: 'test-relay-key',
  AI_RELAY_BASE_URL: 'https://relay.example.test/v1',
  AI_RELAY_PRIMARY_MODEL: 'relay-primary',
  AI_RELAY_FALLBACK_MODEL: 'relay-fallback',
  AI_RELAY_PRICING_JSON: JSON.stringify({
    'relay-primary': {
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 2,
    },
    'relay-fallback': {
      inputPerMillionUsd: 0.5,
      outputPerMillionUsd: 1,
    },
  }),
  AI_RELAY_CANARY_TOKEN: 'test-canary-token-with-at-least-32-characters',
  SENTRY_DSN: 'https://public@example.test/1',
  NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.test/1',
  REDIS_URL: 'https://redis.example.test',
  REDIS_TOKEN: 'test-redis-token',
  TRUSTED_PROXY_HEADERS: 'x-forwarded-for',
  GOOGLE_AUTH_ENABLED: 'true',
  GOOGLE_ONE_TAP_ENABLED: 'false',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  DURABLE_GUEST_CLAIM_ENABLED: 'false',
  NEXT_PUBLIC_DURABLE_GUEST_CLAIM_ENABLED: 'false',
  ANONYMOUS_METRICS_ENABLED: 'false',
  SUMMARY_CATALOG_ENABLED: 'false',
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

  it('requires HTTPS for the production relay', () => {
    const env = {
      ...validProductionEnv,
      AI_RELAY_BASE_URL: 'http://relay.example.test/v1',
    };
    expect(checkRequiredConfiguration(env)).toMatchObject({
      status: 'error',
      details: { invalid: ['AI_RELAY_BASE_URL'] },
    });
    expect(checkAiConfiguration(env)).toMatchObject({
      status: 'error',
      details: { baseUrlReady: false },
    });
  });

  it('rejects production action routes outside the preflighted model pair', () => {
    const env = {
      ...validProductionEnv,
      ALGO_COACH_HINT_MODEL: 'relay-unchecked',
    };
    expect(checkRequiredConfiguration(env)).toMatchObject({
      status: 'error',
      details: { invalid: ['ALGO_COACH_HINT_MODEL'] },
    });
    expect(checkAiConfiguration(env)).toMatchObject({
      status: 'error',
      details: { invalidModelSettings: ['ALGO_COACH_HINT_MODEL'] },
    });
  });

  it('rejects an unsupported structured output mode', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        AI_RELAY_STRUCTURED_OUTPUT_MODE: 'auto',
      })
    ).toMatchObject({
      status: 'error',
      details: { invalid: ['AI_RELAY_STRUCTURED_OUTPUT_MODE'] },
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

  it('requires one trusted proxy header in production', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        TRUSTED_PROXY_HEADERS: 'x-forwarded-for,x-real-ip',
      })
    ).toMatchObject({
      status: 'error',
      details: { invalid: ['TRUSTED_PROXY_HEADERS'] },
    });
  });

  it('requires verified delivery when production email auth is enabled', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        EMAIL_AUTH_ENABLED: 'true',
        EMAIL_VERIFICATION_ENABLED: 'false',
      })
    ).toMatchObject({
      status: 'error',
      details: {
        missing: expect.arrayContaining(['RESEND_API_KEY']),
        invalid: expect.arrayContaining([
          'EMAIL_AUTH_ENABLED',
          'EMAIL_VERIFICATION_ENABLED',
        ]),
      },
    });
  });

  it('requires explicit rollout flags and Google-only authentication', () => {
    const env = { ...validProductionEnv };
    delete env.SUMMARY_CATALOG_ENABLED;
    expect(
      checkRequiredConfiguration({
        ...env,
        GITHUB_AUTH_ENABLED: 'true',
        GOOGLE_ONE_TAP_ENABLED: 'true',
      })
    ).toMatchObject({
      status: 'error',
      details: {
        missing: expect.arrayContaining(['SUMMARY_CATALOG_ENABLED']),
        invalid: expect.arrayContaining([
          'GOOGLE_ONE_TAP_ENABLED',
          'GITHUB_AUTH_ENABLED',
        ]),
      },
    });
  });

  it('requires the public app and authentication URLs to share an origin', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        AUTH_URL: 'https://stale-auth.example.test',
      })
    ).toMatchObject({
      status: 'error',
      details: { invalid: expect.arrayContaining(['AUTH_URL']) },
    });
  });

  it('rejects pathful authentication origins', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        AUTH_URL: 'https://algocoach.example/auth',
      })
    ).toMatchObject({
      status: 'error',
      details: { invalid: expect.arrayContaining(['AUTH_URL']) },
    });
  });

  it('rejects placeholder support email in production', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        NEXT_PUBLIC_SUPPORT_EMAIL: 'support@algocoach.example',
      })
    ).toMatchObject({
      status: 'error',
      details: { invalid: ['NEXT_PUBLIC_SUPPORT_EMAIL'] },
    });
  });

  it('validates catalog rollout feature flags', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        DB_CATALOG_ENABLED: 'false',
        CATALOG_SYNC_ENABLED: 'true',
        TYPESCRIPT_ENABLED: 'sometimes',
      })
    ).toMatchObject({
      status: 'error',
      details: {
        invalid: [
          'TYPESCRIPT_ENABLED',
          'CATALOG_SYNC_ENABLED',
          'DB_CATALOG_ENABLED',
        ],
      },
    });
  });

  it('requires matching durable-claim flags and a strong optional HMAC key', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        DURABLE_GUEST_CLAIM_ENABLED: 'true',
        NEXT_PUBLIC_DURABLE_GUEST_CLAIM_ENABLED: 'false',
        ANONYMOUS_METRICS_HMAC_SECRET: 'short',
      })
    ).toMatchObject({
      status: 'error',
      details: {
        invalid: [
          'NEXT_PUBLIC_DURABLE_GUEST_CLAIM_ENABLED',
          'ANONYMOUS_METRICS_HMAC_SECRET',
        ],
      },
    });
  });

  it('rejects an invalid catalog readiness floor', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        CATALOG_MIN_PUBLISHED_PROBLEMS: '0',
      })
    ).toMatchObject({
      status: 'error',
      details: { invalid: ['CATALOG_MIN_PUBLISHED_PROBLEMS'] },
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
        missing: expect.arrayContaining([
          'DATABASE_APPLICATION_ROLE',
          'GOOGLE_CLIENT_ID',
          'GOOGLE_CLIENT_SECRET',
          'AUTH_URL',
          'REDIS_URL',
          'REDIS_TOKEN',
          'TRUSTED_PROXY_HEADERS',
          'SENTRY_DSN',
          'AI_RELAY_BASE_URL',
          'AI_RELAY_PRIMARY_MODEL',
          'AI_RELAY_FALLBACK_MODEL',
          'AI_RELAY_PRICING_JSON',
          'AI_RELAY_API_KEY',
        ]),
        invalid: expect.arrayContaining([
          'GOOGLE_ONE_TAP_ENABLED',
          'AUTH_SECRET',
          'AI_RELAY_CANARY_TOKEN',
          'COACH_DEMO_FALLBACK_ENABLED',
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('allows demo fallback only outside production', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        NODE_ENV: 'development',
        AI_RELAY_API_KEY: '',
        COACH_DEMO_FALLBACK_ENABLED: 'true',
      })
    ).toEqual({ status: 'ok' });
    expect(
      checkAiConfiguration({
        NODE_ENV: 'development',
        AI_RELAY_API_KEY: '',
        COACH_DEMO_FALLBACK_ENABLED: 'true',
      })
    ).toMatchObject({ status: 'ok', details: { mode: 'demo' } });
    expect(
      checkAiConfiguration({
        NODE_ENV: 'production',
        AI_RELAY_API_KEY: '',
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
      AI_RELAY_API_KEY: 'private-key',
      AI_RELAY_BASE_URL: 'not-a-url',
      AI_RELAY_PRIMARY_MODEL: 'invalid model',
      AI_RELAY_FALLBACK_MODEL: 'also invalid',
    });

    expect(auth.status).toBe('error');
    expect(ai).toMatchObject({
      status: 'error',
      details: {
        invalidModelSettings: [
          'AI_RELAY_PRIMARY_MODEL',
          'AI_RELAY_FALLBACK_MODEL',
        ],
      },
    });
    expect(JSON.stringify({ auth, ai })).not.toContain('private-key');
  });

  it('validates review grading model configuration', () => {
    expect(
      checkAiConfiguration({
        NODE_ENV: 'development',
        AI_RELAY_API_KEY: 'private-key',
        AI_RELAY_BASE_URL: 'https://relay.example/v1',
        ALGO_COACH_REVIEW_GRADE_MODEL: 'invalid model id',
      })
    ).toMatchObject({
      status: 'error',
      details: {
        invalidModelSettings: ['ALGO_COACH_REVIEW_GRADE_MODEL'],
      },
    });
  });

  it('requires relay pricing for both production models', () => {
    expect(
      checkRequiredConfiguration({
        ...validProductionEnv,
        AI_RELAY_PRICING_JSON: JSON.stringify({
          'relay-primary': {
            inputPerMillionUsd: 1,
            outputPerMillionUsd: 2,
          },
        }),
      })
    ).toMatchObject({
      status: 'error',
      details: { invalid: ['AI_RELAY_PRICING_JSON'] },
    });
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
      .mockResolvedValueOnce(Response.json({ result: 'PONG' }))
      .mockResolvedValueOnce(Response.json({ result: 1 }));
    const result = await checkRedisReadiness(validProductionEnv, fetcher);

    expect(result).toMatchObject({
      status: 'ok',
      details: { mode: 'distributed', evalReady: true, source: 'redis' },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, pingInit] = fetcher.mock.calls[0] as [string, RequestInit];
    const [, evalInit] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(pingInit.body).toBe(JSON.stringify(['PING']));
    expect(evalInit.body).toBe(JSON.stringify(['EVAL', 'return 1', '0']));
    expect(JSON.stringify(result)).not.toContain('test-redis-token');
  });

  it('accepts provider-managed Redis REST aliases', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: 'PONG' }))
      .mockResolvedValueOnce(Response.json({ result: 1 }));
    const result = await checkRedisReadiness(
      {
        ...validProductionEnv,
        REDIS_URL: '',
        REDIS_TOKEN: '',
        UPSTASH_REDIS_REST_URL: 'https://upstash.example.test',
        UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
      },
      fetcher
    );

    expect(result).toMatchObject({
      status: 'ok',
      details: { source: 'upstash', evalReady: true },
    });
  });

  it('fails readiness when Redis cannot execute Lua', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: 'PONG' }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(
      checkRedisReadiness(validProductionEnv, fetcher)
    ).resolves.toMatchObject({
      status: 'error',
      code: 'redis_eval_unavailable',
      details: { httpStatus: 403 },
    });
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

  it('rejects a plaintext remote Redis URL in production', async () => {
    await expect(
      checkRedisReadiness({
        ...validProductionEnv,
        REDIS_URL: 'http://redis.example.test',
      })
    ).resolves.toMatchObject({
      status: 'error',
      code: 'redis_not_configured',
    });
  });

  it('rejects missing or out-of-order history and tolerates an append-only database lead', () => {
    const expected = migrationJournal.entries.map((entry) => entry.when);
    const nextMigration = expected.at(-1)! + 1;
    expect(checkMigrationVersions(expected).status).toBe('ok');
    expect(checkMigrationVersions(expected.slice(0, -1)).status).toBe('error');
    expect(checkMigrationVersions([...expected, nextMigration])).toMatchObject({
      status: 'ok',
      details: {
        databaseAhead: true,
        appliedMigration: String(nextMigration),
      },
    });
    expect(checkMigrationVersions([...expected, expected[0]!]).status).toBe(
      'error'
    );
    expect(checkMigrationVersions([...expected, Number.NaN]).status).toBe(
      'error'
    );
    expect(checkMigrationVersions([...expected].reverse()).status).toBe(
      'error'
    );
  });

  it('requires every published catalog problem to have a valid current revision', () => {
    expect(
      checkCatalogReadiness({ publishedCount: 73, readyCount: 73 })
    ).toMatchObject({
      status: 'ok',
      details: { publishedCount: 73, readyCount: 73 },
    });
    expect(
      checkCatalogReadiness({ publishedCount: 73, readyCount: 72 })
    ).toMatchObject({
      status: 'error',
      code: 'catalog_invalid',
      details: { publishedCount: 73, readyCount: 72 },
    });
    expect(
      checkCatalogReadiness({ publishedCount: 0, readyCount: 0 })
    ).toMatchObject({ status: 'error', code: 'catalog_empty' });
    expect(
      checkCatalogReadiness({ publishedCount: 72, readyCount: 72 })
    ).toMatchObject({ status: 'error', code: 'catalog_below_minimum' });
    expect(
      checkCatalogReadiness({
        publishedCount: 20,
        readyCount: 20,
        minimumPublishedCount: 20,
      })
    ).toMatchObject({ status: 'ok' });
  });

  it('fails readiness without attempting a connection when URL is absent', async () => {
    const status = await readyHealthStatus(
      {
        ...validProductionEnv,
        DATABASE_URL: '',
      },
      undefined,
      {
        fetch: vi.fn().mockImplementation(async (_url, init) => {
          const command = JSON.parse(String(init?.body)) as string[];
          return Response.json({ result: command[0] === 'PING' ? 'PONG' : 1 });
        }),
      }
    );

    expect(status.status).toBe('error');
    expect(status.checks?.database.code).toBe('database_url_missing');
    expect(status.checks?.migrations.code).toBe('database_unavailable');
    expect(status.checks?.catalog.code).toBe('database_unavailable');
    expect(status.checks?.redis.status).toBe('ok');
  });
});
