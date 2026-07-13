import { describe, expect, it } from 'vitest';

import migrationJournal from '@/config/db/migrations/meta/_journal.json';

import {
  checkMigrationVersions,
  checkRequiredConfiguration,
  liveHealthStatus,
  readyHealthStatus,
} from './readiness';

const validProductionEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_PROVIDER: 'postgresql',
  DATABASE_URL: 'postgresql://app:secret@localhost:5432/algocoach',
  DATABASE_APPLICATION_ROLE: 'app',
  AUTH_SECRET: 'a-secure-auth-secret-with-at-least-32-characters',
  OPENROUTER_API_KEY: 'test-openrouter-key',
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
          'OPENROUTER_API_KEY',
        ],
        invalid: [
          'GOOGLE_ONE_TAP_ENABLED',
          'AUTH_SECRET',
          'COACH_DEMO_FALLBACK_ENABLED',
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
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
    const status = await readyHealthStatus({
      ...validProductionEnv,
      DATABASE_URL: '',
    });

    expect(status.status).toBe('error');
    expect(status.checks?.database.code).toBe('database_url_missing');
    expect(status.checks?.migrations.code).toBe('database_unavailable');
  });
});
