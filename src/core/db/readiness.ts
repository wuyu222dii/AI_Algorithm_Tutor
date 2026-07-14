import { COACH_MODEL_WHITELIST } from '@/features/algorithm-coach/model';
import postgres from 'postgres';

import migrationJournal from '@/config/db/migrations/meta/_journal.json';
import type { HealthCheckResult, HealthStatus } from '@/shared/types/health';

import packageJson from '../../../package.json';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TRUSTED_PROXY_HEADER_ALLOWLIST = new Set([
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-real-ip',
]);
const EXPECTED_MIGRATIONS = migrationJournal.entries.map((entry) => ({
  timestamp: entry.when,
  tag: entry.tag,
}));
const COACH_MODEL_ENV_NAMES = [
  'ALGO_COACH_MODEL',
  'ALGO_COACH_FALLBACK_MODEL',
  ...[
    'PARSE',
    'DIAGNOSE',
    'HINT',
    'COUNTEREXAMPLE',
    'REVIEW_CARD',
    'CHAT',
  ].flatMap((action) => [
    `ALGO_COACH_${action}_MODEL`,
    `ALGO_COACH_${action}_FALLBACK_MODEL`,
  ]),
] as const;
const BOOLEAN_FEATURE_FLAGS = [
  'DB_CATALOG_ENABLED',
  'CATALOG_SYNC_ENABLED',
  'TYPESCRIPT_ENABLED',
] as const;

type ReadinessFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface ReadinessDependencies {
  fetch?: ReadinessFetch;
}

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

function catalogMinimumPublishedProblems(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 58;
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function invalidCoachModelSettings(env: NodeJS.ProcessEnv): string[] {
  return COACH_MODEL_ENV_NAMES.filter((name) => {
    const model = env[name]?.trim();
    return (
      Boolean(model) &&
      !COACH_MODEL_WHITELIST.includes(
        model as (typeof COACH_MODEL_WHITELIST)[number]
      )
    );
  });
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

  for (const name of BOOLEAN_FEATURE_FLAGS) {
    const value = env[name]?.trim();
    if (value && value !== 'true' && value !== 'false') invalid.push(name);
  }
  if (
    env.CATALOG_MIN_PUBLISHED_PROBLEMS?.trim() &&
    (!Number.isInteger(Number(env.CATALOG_MIN_PUBLISHED_PROBLEMS)) ||
      Number(env.CATALOG_MIN_PUBLISHED_PROBLEMS) < 1)
  ) {
    invalid.push('CATALOG_MIN_PUBLISHED_PROBLEMS');
  }
  if (
    env.CATALOG_SYNC_ENABLED === 'true' &&
    env.DB_CATALOG_ENABLED === 'false'
  ) {
    invalid.push('CATALOG_SYNC_ENABLED');
  }
  if (production && env.DB_CATALOG_ENABLED === 'false') {
    invalid.push('DB_CATALOG_ENABLED');
  }

  if (production) {
    if (!env.AUTH_URL?.trim()) missing.push('AUTH_URL');
    if (!env.AUTH_SECRET?.trim() || env.AUTH_SECRET.trim().length < 32) {
      invalid.push('AUTH_SECRET');
    }
    if (!env.REDIS_URL?.trim()) missing.push('REDIS_URL');
    if (!env.REDIS_TOKEN?.trim()) missing.push('REDIS_TOKEN');
    const trustedProxyHeaders = (env.TRUSTED_PROXY_HEADERS ?? '')
      .split(',')
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (!trustedProxyHeaders.length) {
      missing.push('TRUSTED_PROXY_HEADERS');
    } else if (
      !trustedProxyHeaders.some((header) =>
        TRUSTED_PROXY_HEADER_ALLOWLIST.has(header)
      )
    ) {
      invalid.push('TRUSTED_PROXY_HEADERS');
    }
    if (env.DB_AUTO_MIGRATE === 'true') invalid.push('DB_AUTO_MIGRATE');
  }

  const authRequired =
    production ||
    env.EMAIL_AUTH_ENABLED === 'true' ||
    env.GOOGLE_AUTH_ENABLED === 'true';
  if (authRequired) {
    if (!env.AUTH_URL?.trim() && !missing.includes('AUTH_URL')) {
      missing.push('AUTH_URL');
    }
    if (
      (!env.AUTH_SECRET?.trim() || env.AUTH_SECRET.trim().length < 32) &&
      !invalid.includes('AUTH_SECRET')
    ) {
      invalid.push('AUTH_SECRET');
    }
  }

  if (env.AUTH_URL?.trim() && !isHttpUrl(env.AUTH_URL)) {
    invalid.push('AUTH_URL');
  }
  if (env.REDIS_URL?.trim() && !isHttpUrl(env.REDIS_URL)) {
    invalid.push('REDIS_URL');
  }
  if (Boolean(env.REDIS_URL?.trim()) !== Boolean(env.REDIS_TOKEN?.trim())) {
    const missingRedisSetting = env.REDIS_URL?.trim()
      ? 'REDIS_TOKEN'
      : 'REDIS_URL';
    if (!missing.includes(missingRedisSetting)) {
      missing.push(missingRedisSetting);
    }
  }
  if (env.OPENROUTER_BASE_URL?.trim() && !isHttpUrl(env.OPENROUTER_BASE_URL)) {
    invalid.push('OPENROUTER_BASE_URL');
  }
  invalid.push(...invalidCoachModelSettings(env));
  if (
    !env.OPENROUTER_API_KEY?.trim() &&
    (production || env.COACH_DEMO_FALLBACK_ENABLED !== 'true')
  ) {
    missing.push('OPENROUTER_API_KEY');
  }

  if (missing.length || invalid.length) {
    return error('invalid_configuration', undefined, {
      ...(missing.length ? { missing } : {}),
      ...(invalid.length ? { invalid } : {}),
    });
  }

  return ok();
}

export function checkAuthenticationConfiguration(
  env: NodeJS.ProcessEnv = process.env
): HealthCheckResult {
  const required =
    env.NODE_ENV === 'production' ||
    env.EMAIL_AUTH_ENABLED === 'true' ||
    env.GOOGLE_AUTH_ENABLED === 'true';
  const baseUrlReady = isHttpUrl(env.AUTH_URL);
  const secretReady = Boolean(
    env.AUTH_SECRET?.trim() && env.AUTH_SECRET.trim().length >= 32
  );
  const googleEnabled = env.GOOGLE_AUTH_ENABLED === 'true';
  const googleReady =
    !googleEnabled ||
    Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());

  if (!required && !baseUrlReady && !secretReady) {
    return ok(undefined, {
      mode: 'disabled',
      required: false,
      googleEnabled,
    });
  }
  if (!baseUrlReady || !secretReady || !googleReady) {
    return error('authentication_not_configured', undefined, {
      baseUrlReady,
      secretReady,
      googleEnabled,
      googleReady,
    });
  }
  return ok(undefined, {
    mode: 'configured',
    googleEnabled,
  });
}

export function checkAiConfiguration(
  env: NodeJS.ProcessEnv = process.env
): HealthCheckResult {
  const liveConfigured = Boolean(env.OPENROUTER_API_KEY?.trim());
  const demoConfigured = env.COACH_DEMO_FALLBACK_ENABLED === 'true';
  const liveRequired = env.NODE_ENV === 'production';
  const baseUrlReady =
    !env.OPENROUTER_BASE_URL?.trim() || isHttpUrl(env.OPENROUTER_BASE_URL);
  const invalidModelSettings = invalidCoachModelSettings(env);
  const modelReady = invalidModelSettings.length === 0;

  if (
    (!liveConfigured && (liveRequired || !demoConfigured)) ||
    !baseUrlReady ||
    !modelReady
  ) {
    return error('ai_not_configured', undefined, {
      liveConfigured,
      demoConfigured,
      liveRequired,
      baseUrlReady,
      modelReady,
      ...(invalidModelSettings.length ? { invalidModelSettings } : {}),
    });
  }
  return ok(undefined, {
    mode: liveConfigured ? 'live' : 'demo',
    demoFallbackEnabled: demoConfigured,
    modelConfigured: COACH_MODEL_ENV_NAMES.some((name) =>
      Boolean(env[name]?.trim())
    ),
  });
}

export async function checkRedisReadiness(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: ReadinessFetch = globalThis.fetch
): Promise<HealthCheckResult> {
  const redisUrl = env.REDIS_URL?.trim().replace(/\/$/, '');
  const redisToken = env.REDIS_TOKEN?.trim();
  const required = env.NODE_ENV === 'production';

  if (!redisUrl && !redisToken && !required) {
    return ok(undefined, { mode: 'process-local', required: false });
  }
  if (!redisUrl || !redisToken || !isHttpUrl(redisUrl)) {
    return error('redis_not_configured', undefined, {
      required,
      urlConfigured: Boolean(redisUrl),
      tokenConfigured: Boolean(redisToken),
    });
  }

  const timeoutMs = boundedTimeout(env.HEALTH_REDIS_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetcher(redisUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${redisToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(['PING']),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return error('redis_unavailable', Date.now() - startedAt, {
        httpStatus: response.status,
      });
    }
    const payload = (await response.json()) as { result?: unknown };
    if (payload.result !== 'PONG') {
      return error('redis_invalid_response', Date.now() - startedAt);
    }
    return ok(Date.now() - startedAt, { mode: 'distributed' });
  } catch {
    return error('redis_unavailable', Date.now() - startedAt);
  }
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

export function checkCatalogReadiness(counts: {
  publishedCount: number;
  readyCount: number;
  minimumPublishedCount?: number;
}): HealthCheckResult {
  const minimumPublishedCount = counts.minimumPublishedCount ?? 58;
  const details = {
    publishedCount: counts.publishedCount,
    readyCount: counts.readyCount,
    minimumPublishedCount,
  };
  if (counts.publishedCount === 0) {
    return error('catalog_empty', undefined, details);
  }
  if (counts.publishedCount < minimumPublishedCount) {
    return error('catalog_below_minimum', undefined, details);
  }
  return counts.readyCount === counts.publishedCount
    ? ok(undefined, details)
    : error('catalog_invalid', undefined, details);
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
  now = new Date(),
  dependencies: ReadinessDependencies = {}
): Promise<HealthStatus> {
  const configuration = checkRequiredConfiguration(env);
  const authentication = checkAuthenticationConfiguration(env);
  const ai = checkAiConfiguration(env);
  const redisPromise = checkRedisReadiness(
    env,
    dependencies.fetch ?? globalThis.fetch
  );
  let database: HealthCheckResult;
  let migrations: HealthCheckResult;
  let catalog: HealthCheckResult;
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    database = error('database_url_missing');
    migrations = error('database_unavailable');
    catalog = error('database_unavailable');
  } else if ((env.DATABASE_PROVIDER ?? 'postgresql') !== 'postgresql') {
    database = error('unsupported_database_provider');
    migrations = error('unsupported_database_provider');
    catalog = error('unsupported_database_provider');
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
          catalog_write: boolean;
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
          ) as owns_schema,
          exists(
            select 1
            from unnest(array[
              'coach_catalog_source',
              'coach_catalog_sync_run',
              'coach_problem_candidate',
              'coach_problem_revision',
              'coach_problem_origin',
              'coach_catalog_review_audit',
              'coach_test_case'
            ]::text[]) as catalog_table(table_name)
            where has_table_privilege(
              current_user,
              format('%I.%I', ${env.DB_SCHEMA ?? 'algocoach'}::text, table_name),
              'INSERT'
            ) or has_table_privilege(
              current_user,
              format('%I.%I', ${env.DB_SCHEMA ?? 'algocoach'}::text, table_name),
              'UPDATE'
            ) or has_table_privilege(
              current_user,
              format('%I.%I', ${env.DB_SCHEMA ?? 'algocoach'}::text, table_name),
              'DELETE'
            )
          ) as catalog_write
      `;
      const expectedRole = env.DATABASE_APPLICATION_ROLE?.trim();
      if (expectedRole && role?.current_role !== expectedRole) {
        database = error('unexpected_database_role', Date.now() - startedAt);
      } else if (
        env.NODE_ENV === 'production' &&
        (role?.owns_schema ||
          role?.catalog_write ||
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

      if (env.DB_CATALOG_ENABLED === 'false') {
        catalog = ok(undefined, { mode: 'disabled' });
      } else {
        try {
          const applicationSchema = quotedIdentifier(
            env.DB_SCHEMA ?? 'algocoach'
          );
          const [row] = await client.unsafe<
            { published_count: number; ready_count: number }[]
          >(`
            SELECT
              count(*)::int AS published_count,
              count(*) FILTER (
                WHERE revision.id IS NOT NULL
                  AND revision.status = 'published'
                  AND problem.content_version = revision.version
                  AND jsonb_typeof(revision.language_configs) = 'object'
                  AND nullif(btrim(revision.language_configs->'javascript'->>'entryPoint'), '') IS NOT NULL
                  AND nullif(btrim(revision.language_configs->'javascript'->>'template'), '') IS NOT NULL
                  AND revision.language_configs->'javascript'->>'monacoId' = 'javascript'
                  AND revision.language_configs->'javascript'->>'runner' = 'quickjs'
                  AND revision.language_configs->'javascript'->>'runtimeVersion' = 'quickjs-emscripten@0.32.0'
                  AND jsonb_typeof(revision.language_configs->'javascript'->'signature') = 'object'
                  AND nullif(btrim(revision.language_configs->'typescript'->>'entryPoint'), '') IS NOT NULL
                  AND nullif(btrim(revision.language_configs->'typescript'->>'template'), '') IS NOT NULL
                  AND revision.language_configs->'typescript'->>'monacoId' = 'typescript'
                  AND revision.language_configs->'typescript'->>'runner' = 'typescript-quickjs'
                  AND revision.language_configs->'typescript'->>'runtimeVersion' = 'typescript@5.9.2 / quickjs-emscripten@0.32.0'
                  AND jsonb_typeof(revision.language_configs->'typescript'->'signature') = 'object'
                  AND nullif(btrim(revision.language_configs->'python'->>'entryPoint'), '') IS NOT NULL
                  AND nullif(btrim(revision.language_configs->'python'->>'template'), '') IS NOT NULL
                  AND revision.language_configs->'python'->>'monacoId' = 'python'
                  AND revision.language_configs->'python'->>'runner' = 'pyodide'
                  AND revision.language_configs->'python'->>'runtimeVersion' = 'pyodide@314.0.2'
                  AND jsonb_typeof(revision.language_configs->'python'->'signature') = 'object'
                  AND jsonb_typeof(revision.signature) = 'object'
                  AND EXISTS (
                    SELECT 1
                    FROM ${applicationSchema}.coach_test_case AS test_case
                    WHERE test_case.problem_id = problem.id
                      AND test_case.revision_id = revision.id
                  )
                  AND (
                    problem.source <> 'external'
                    OR EXISTS (
                      SELECT 1
                      FROM ${applicationSchema}.coach_problem_origin AS origin
                      WHERE origin.problem_id = problem.id
                        AND nullif(btrim(origin.license_spdx), '') IS NOT NULL
                        AND nullif(btrim(origin.attribution), '') IS NOT NULL
                        AND origin.source_revision = revision.source_revision
                        AND origin.content_hash = revision.content_hash
                    )
                  )
              )::int AS ready_count
            FROM ${applicationSchema}.coach_problem AS problem
            LEFT JOIN ${applicationSchema}.coach_problem_revision AS revision
              ON revision.id = problem.current_revision_id
             AND revision.problem_id = problem.id
            WHERE problem.owner_user_id IS NULL
              AND problem.status = 'published'
          `);
          const publishedCount = Number(row?.published_count ?? 0);
          const readyCount = Number(row?.ready_count ?? 0);
          catalog = checkCatalogReadiness({
            publishedCount,
            readyCount,
            minimumPublishedCount: catalogMinimumPublishedProblems(
              env.CATALOG_MIN_PUBLISHED_PROBLEMS
            ),
          });
        } catch {
          catalog = error('catalog_unavailable');
        }
      }
    } catch {
      const latencyMs = Date.now() - startedAt;
      database = error('database_unavailable', latencyMs);
      migrations = error('database_unavailable');
      catalog = error('database_unavailable');
    } finally {
      await client.end({ timeout: 1 }).catch(() => undefined);
    }
  }

  const redis = await redisPromise;
  const checks = {
    configuration,
    database,
    migrations,
    catalog,
    redis,
    authentication,
    ai,
  };
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
