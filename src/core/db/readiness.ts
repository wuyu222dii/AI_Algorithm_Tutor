import postgres from 'postgres';

import migrationJournal from '@/config/db/migrations/meta/_journal.json';
import type { HealthCheckResult, HealthStatus } from '@/shared/types/health';

import packageJson from '../../../package.json';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXPECTED_MIGRATIONS = migrationJournal.entries.map((entry) => ({
  timestamp: entry.when,
  tag: entry.tag,
}));

function quotedIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error('invalid_identifier');
  }
  return `"${value}"`;
}

function boundedTimeout(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 500 && parsed <= 30_000
    ? parsed
    : 5_000;
}

function ok(
  latencyMs?: number,
  details?: HealthCheckResult['details']
): HealthCheckResult {
  return {
    status: 'ok',
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(details ? { details } : {}),
  };
}

function error(
  code: string,
  latencyMs?: number,
  details?: HealthCheckResult['details']
): HealthCheckResult {
  return {
    status: 'error',
    code,
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(details ? { details } : {}),
  };
}

export function checkRequiredConfiguration(
  env: NodeJS.ProcessEnv = process.env
): HealthCheckResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const production = env.NODE_ENV === 'production';

  if (!env.DATABASE_URL?.trim()) missing.push('DATABASE_URL');
  if (production && !env.DATABASE_APPLICATION_ROLE?.trim()) {
    missing.push('DATABASE_APPLICATION_ROLE');
  }

  if (env.GOOGLE_AUTH_ENABLED === 'true') {
    if (!env.GOOGLE_CLIENT_ID?.trim()) missing.push('GOOGLE_CLIENT_ID');
    if (!env.GOOGLE_CLIENT_SECRET?.trim()) missing.push('GOOGLE_CLIENT_SECRET');
  }

  if (env.GOOGLE_ONE_TAP_ENABLED === 'true') {
    invalid.push('GOOGLE_ONE_TAP_ENABLED');
  }

  if (production) {
    if (!env.AUTH_SECRET?.trim() || env.AUTH_SECRET.trim().length < 32) {
      invalid.push('AUTH_SECRET');
    }
    if (!env.OPENROUTER_API_KEY?.trim()) {
      missing.push('OPENROUTER_API_KEY');
    }
    if (env.COACH_DEMO_FALLBACK_ENABLED === 'true') {
      invalid.push('COACH_DEMO_FALLBACK_ENABLED');
    }
  }

  if (missing.length || invalid.length) {
    return error('invalid_configuration', undefined, {
      ...(missing.length ? { missing } : {}),
      ...(invalid.length ? { invalid } : {}),
    });
  }

  return ok();
}

export function checkMigrationVersions(
  appliedTimestamps: Array<number | string>
): HealthCheckResult {
  const applied = appliedTimestamps.map(Number);
  const expected = EXPECTED_MIGRATIONS.map((migration) => migration.timestamp);
  const current =
    applied.length === expected.length &&
    applied.every((timestamp, index) => timestamp === expected[index]);
  const expectedMigration = EXPECTED_MIGRATIONS.at(-1)?.tag ?? 'none';
  const appliedMigration =
    EXPECTED_MIGRATIONS.find(
      (migration) => migration.timestamp === applied.at(-1)
    )?.tag ?? (applied.length ? String(applied.at(-1)) : 'none');

  return current
    ? ok(undefined, { expectedMigration, appliedMigration })
    : error('migration_version_mismatch', undefined, {
        expectedMigration,
        appliedMigration,
      });
}

export function liveHealthStatus(now = new Date()): HealthStatus {
  return {
    status: 'ok',
    kind: 'live',
    service: 'algocoach',
    version: packageJson.version,
    timestamp: now.toISOString(),
  };
}

export async function readyHealthStatus(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date()
): Promise<HealthStatus> {
  const configuration = checkRequiredConfiguration(env);
  let database: HealthCheckResult;
  let migrations: HealthCheckResult;
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    database = error('database_url_missing');
    migrations = error('database_unavailable');
  } else if ((env.DATABASE_PROVIDER ?? 'postgresql') !== 'postgresql') {
    database = error('unsupported_database_provider');
    migrations = error('unsupported_database_provider');
  } else {
    const timeoutMs = boundedTimeout(env.HEALTH_DATABASE_TIMEOUT_MS);
    const startedAt = Date.now();
    const client = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: Math.ceil(timeoutMs / 1_000),
      idle_timeout: 1,
      onnotice: () => undefined,
    });

    try {
      const [role] = await client<
        {
          current_role: string;
          owns_schema: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolsuper: boolean;
        }[]
      >`
        select
          current_user as current_role,
          coalesce((select rolsuper from pg_roles where rolname = current_user), false) as rolsuper,
          coalesce((select rolcreatedb from pg_roles where rolname = current_user), false) as rolcreatedb,
          coalesce((select rolcreaterole from pg_roles where rolname = current_user), false) as rolcreaterole,
          exists(
            select 1
            from pg_namespace
            where nspname = ${env.DB_SCHEMA ?? 'algocoach'}
              and pg_get_userbyid(nspowner) = current_user
          ) as owns_schema
      `;
      const expectedRole = env.DATABASE_APPLICATION_ROLE?.trim();
      if (expectedRole && role?.current_role !== expectedRole) {
        database = error('unexpected_database_role', Date.now() - startedAt);
      } else if (
        env.NODE_ENV === 'production' &&
        (role?.owns_schema ||
          role?.rolsuper ||
          role?.rolcreatedb ||
          role?.rolcreaterole)
      ) {
        database = error('unrestricted_database_role', Date.now() - startedAt);
      } else {
        database = ok(Date.now() - startedAt);
      }

      try {
        const migrationSchema = quotedIdentifier(
          env.DB_MIGRATIONS_SCHEMA ?? 'drizzle'
        );
        const migrationTable = quotedIdentifier(
          env.DB_MIGRATIONS_TABLE ?? '__drizzle_migrations'
        );
        const rows = await client.unsafe<{ created_at: string | number }[]>(`
          SELECT created_at
          FROM ${migrationSchema}.${migrationTable}
          ORDER BY created_at ASC
        `);
        migrations = checkMigrationVersions(rows.map((row) => row.created_at));
      } catch {
        migrations = error('migration_history_unavailable');
      }
    } catch {
      const latencyMs = Date.now() - startedAt;
      database = error('database_unavailable', latencyMs);
      migrations = error('database_unavailable');
    } finally {
      await client.end({ timeout: 1 }).catch(() => undefined);
    }
  }

  const checks = { configuration, database, migrations };
  const status = Object.values(checks).every((check) => check.status === 'ok')
    ? 'ok'
    : 'error';

  return {
    status,
    kind: 'ready',
    service: 'algocoach',
    version: packageJson.version,
    timestamp: now.toISOString(),
    checks,
  };
}
