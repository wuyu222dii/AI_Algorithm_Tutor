#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

import migrationJournal from '../src/config/db/migrations/meta/_journal.json';
import { readyHealthStatus } from '../src/core/db/readiness';
import { migrateDatabase } from './migrate-database';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a simple PostgreSQL identifier`);
  }
  return value;
}

function assertLocalTestUrl(value: string, label: string): URL {
  const url = new URL(value);
  const databaseName = url.pathname.replace(/^\//, '');
  if (!LOCAL_HOSTS.has(url.hostname) || !databaseName.endsWith('_test')) {
    throw new Error(
      `${label} must target a local PostgreSQL database ending in _test`
    );
  }
  return url;
}

async function ensureApplicationRole(
  admin: postgres.Sql,
  role: string,
  password: string
) {
  const [existing] = await admin<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname = ${role}) as exists
  `;
  const [statement] = await admin<{ sql: string }[]>`
    select format(
      ${
        existing?.exists
          ? 'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
          : 'CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
      },
      ${role}::text,
      ${password}::text
    ) as sql
  `;
  if (!statement?.sql)
    throw new Error('Failed to prepare the application role');
  await admin.unsafe(statement.sql);
}

async function verifyAuthAndLearningIsolation(
  app: postgres.Sql,
  applicationSchema: string
) {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const firstUserId = `ci_auth_first_${nonce}`;
  const secondUserId = `ci_auth_second_${nonce}`;
  const firstEmail = `same-email-${nonce}@example.test`;
  const secondEmail = `different-email-${nonce}@example.test`;
  const users = [firstUserId, secondUserId];

  try {
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."user" (id, name, email, email_verified) VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
      [
        firstUserId,
        'Existing profile',
        firstEmail,
        secondUserId,
        'Separate profile',
        secondEmail,
      ]
    );
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."account" (id, account_id, provider_id, user_id, updated_at) VALUES ($1, $2, 'credential', $3, now()), ($4, $5, 'google', $3, now()), ($6, $7, 'google', $8, now())`,
      [
        `credential_${nonce}`,
        firstUserId,
        firstUserId,
        `google_same_${nonce}`,
        `google-sub-same-${nonce}`,
        `google_other_${nonce}`,
        `google-sub-other-${nonce}`,
        secondUserId,
      ]
    );

    const [linked] = await app.unsafe<{ users: number; accounts: number }[]>(
      `SELECT count(DISTINCT u.id)::int AS users, count(a.id)::int AS accounts FROM "${applicationSchema}"."user" u JOIN "${applicationSchema}"."account" a ON a.user_id = u.id WHERE u.email = $1`,
      [firstEmail]
    );
    if (linked?.users !== 1 || linked.accounts !== 2) {
      throw new Error('Verified same-email account linking invariant failed');
    }

    const repeated = await app.unsafe(
      `INSERT INTO "${applicationSchema}"."account" (id, account_id, provider_id, user_id, updated_at) VALUES ($1, $2, 'google', $3, now()) ON CONFLICT (provider_id, account_id) DO NOTHING`,
      [`google_repeat_${nonce}`, `google-sub-other-${nonce}`, secondUserId]
    );
    if (repeated.count !== 0) {
      throw new Error('Repeated OAuth callback was not idempotent');
    }

    let crossUserLinkRejected = false;
    try {
      await app.unsafe(
        `INSERT INTO "${applicationSchema}"."account" (id, account_id, provider_id, user_id, updated_at) VALUES ($1, $2, 'google', $3, now())`,
        [`google_conflict_${nonce}`, `google-sub-other-${nonce}`, firstUserId]
      );
    } catch (error) {
      crossUserLinkRejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505';
    }
    if (!crossUserLinkRejected) {
      throw new Error('OAuth provider identity crossed local user boundaries');
    }

    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_learning_profile" (user_id, goal, preferred_language, weekly_target, onboarding_completed, onboarded_at) VALUES ($1, 'interview', 'python', 5, true, now()), ($2, 'foundation', 'javascript', 3, true, now())`,
      users
    );
    const firstProfile = await app.unsafe<{ user_id: string; goal: string }[]>(
      `SELECT user_id, goal FROM "${applicationSchema}"."coach_learning_profile" WHERE user_id = $1`,
      [firstUserId]
    );
    const secondProfile = await app.unsafe<{ user_id: string; goal: string }[]>(
      `SELECT user_id, goal FROM "${applicationSchema}"."coach_learning_profile" WHERE user_id = $1`,
      [secondUserId]
    );
    if (
      firstProfile.length !== 1 ||
      firstProfile[0]?.goal !== 'interview' ||
      secondProfile.length !== 1 ||
      secondProfile[0]?.goal !== 'foundation'
    ) {
      throw new Error('Learning data was not isolated by authenticated user');
    }

    const reviewValues = [
      firstUserId,
      'dependency-cycle',
      secondUserId,
      'minimum-processing-rate',
    ];
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_review_item" (user_id, problem_slug, status, source, due_at, interval_days, repetitions, ease_factor, updated_at) VALUES ($1, $2, 'due', 'mistake', now(), 1, 0, 2.5, now()), ($3, $4, 'due', 'completion', now(), 1, 0, 2.5, now())`,
      reviewValues
    );
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_review_item" (user_id, problem_slug, status, source, due_at, interval_days, repetitions, ease_factor, last_rating, updated_at) VALUES ($1, $2, 'resolved', 'mistake', now() + interval '3 days', 3, 1, 2.5, 'good', now()) ON CONFLICT (user_id, problem_slug) DO UPDATE SET status = excluded.status, due_at = excluded.due_at, interval_days = excluded.interval_days, repetitions = excluded.repetitions, last_rating = excluded.last_rating, updated_at = excluded.updated_at`,
      reviewValues.slice(0, 2)
    );
    const firstReview = await app.unsafe<
      { status: string; repetitions: number; last_rating: string | null }[]
    >(
      `SELECT status, repetitions, last_rating FROM "${applicationSchema}"."coach_review_item" WHERE user_id = $1 AND problem_slug = $2`,
      reviewValues.slice(0, 2)
    );
    const secondReview = await app.unsafe<{ status: string }[]>(
      `SELECT status FROM "${applicationSchema}"."coach_review_item" WHERE user_id = $1`,
      [secondUserId]
    );
    if (
      firstReview.length !== 1 ||
      firstReview[0]?.status !== 'resolved' ||
      firstReview[0]?.repetitions !== 1 ||
      firstReview[0]?.last_rating !== 'good' ||
      secondReview.length !== 1 ||
      secondReview[0]?.status !== 'due'
    ) {
      throw new Error('Review persistence was not idempotent or user-isolated');
    }

    let invalidReviewRejected = false;
    try {
      await app.unsafe(
        `INSERT INTO "${applicationSchema}"."coach_review_item" (user_id, problem_slug, status, source, due_at, interval_days, repetitions, ease_factor, updated_at) VALUES ($1, 'invalid-review', 'due', 'mistake', now(), 0, 0, 2.5, now())`,
        [firstUserId]
      );
    } catch (error) {
      invalidReviewRejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23514';
    }
    if (!invalidReviewRejected) {
      throw new Error('Invalid review schedule bypassed database constraints');
    }

    const importedDraftValues = {
      title: JSON.stringify({ zh: '私有草稿', en: 'Private draft' }),
      description: JSON.stringify({ zh: '测试题面', en: 'Test statement' }),
      templates: JSON.stringify({
        javascript: 'function solve(input) { return input; }',
        python: 'def solve(input):\n    return input',
      }),
      hints: JSON.stringify({ zh: ['', '', ''], en: ['', '', ''] }),
    };
    const insertImportedDraft = async (
      id: string,
      ownerUserId: string,
      slug: string,
      active: boolean
    ) =>
      app.unsafe(
        `INSERT INTO "${applicationSchema}"."coach_problem" (id, slug, owner_user_id, source, title, description, difficulty, topics, entry_point, templates, hints, status, is_active) VALUES ($1, $2, $3, 'imported', $4::jsonb, $5::jsonb, 'medium', ARRAY['custom']::text[], 'solve', $6::jsonb, $7::jsonb, 'draft', $8)`,
        [
          id,
          slug,
          ownerUserId,
          importedDraftValues.title,
          importedDraftValues.description,
          importedDraftValues.templates,
          importedDraftValues.hints,
          active,
        ]
      );

    await insertImportedDraft(
      `ci_draft_first_a_${nonce}`,
      firstUserId,
      'imported-draft',
      true
    );
    await insertImportedDraft(
      `ci_draft_first_b_${nonce}`,
      firstUserId,
      'imported-draft-second',
      false
    );
    await insertImportedDraft(
      `ci_draft_second_a_${nonce}`,
      secondUserId,
      'imported-draft',
      true
    );

    let duplicateOwnerSlugRejected = false;
    try {
      await insertImportedDraft(
        `ci_draft_duplicate_${nonce}`,
        firstUserId,
        'imported-draft',
        false
      );
    } catch (error) {
      duplicateOwnerSlugRejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505';
    }
    if (!duplicateOwnerSlugRejected) {
      throw new Error('Imported drafts were not unique by owner and slug');
    }

    let duplicateActiveDraftRejected = false;
    try {
      await insertImportedDraft(
        `ci_draft_active_conflict_${nonce}`,
        firstUserId,
        'imported-draft-active-conflict',
        true
      );
    } catch (error) {
      duplicateActiveDraftRejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505';
    }
    if (!duplicateActiveDraftRejected) {
      throw new Error('More than one active imported draft was allowed');
    }

    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_problem" (id, slug, owner_user_id, source, title, description, difficulty, topics, entry_point, templates, hints, status, is_active) VALUES ($1, 'imported-draft-second', $2, 'imported', $3::jsonb, $4::jsonb, 'hard', ARRAY['custom']::text[], 'solve', $5::jsonb, $6::jsonb, 'draft', false) ON CONFLICT (owner_user_id, slug) WHERE owner_user_id IS NOT NULL DO UPDATE SET difficulty = excluded.difficulty, updated_at = now()`,
      [
        `ci_draft_idempotent_${nonce}`,
        firstUserId,
        importedDraftValues.title,
        importedDraftValues.description,
        importedDraftValues.templates,
        importedDraftValues.hints,
      ]
    );
    const idempotentDraft = await app.unsafe<
      { count: number; difficulty: string }[]
    >(
      `SELECT count(*)::int AS count, max(difficulty) AS difficulty FROM "${applicationSchema}"."coach_problem" WHERE owner_user_id = $1 AND slug = 'imported-draft-second'`,
      [firstUserId]
    );
    if (
      idempotentDraft[0]?.count !== 1 ||
      idempotentDraft[0]?.difficulty !== 'hard'
    ) {
      throw new Error('Imported draft upsert was not idempotent');
    }

    await app.unsafe(
      `DELETE FROM "${applicationSchema}"."coach_problem" WHERE owner_user_id = $1`,
      [firstUserId]
    );
    const [remainingImportedDrafts] = await app.unsafe<
      {
        first_count: number;
        second_count: number;
      }[]
    >(
      `SELECT count(*) FILTER (WHERE owner_user_id = $1)::int AS first_count, count(*) FILTER (WHERE owner_user_id = $2)::int AS second_count FROM "${applicationSchema}"."coach_problem" WHERE owner_user_id = ANY($3::text[])`,
      [firstUserId, secondUserId, users]
    );
    if (
      remainingImportedDrafts?.first_count !== 0 ||
      remainingImportedDrafts.second_count !== 1
    ) {
      throw new Error('Imported draft deletion crossed user boundaries');
    }

    const funnelEventNames = [
      'visitor_started',
      'onboarding_started',
      'first_code_run',
      'first_problem_passed',
      'review_completed',
      'guest_data_claimed',
      'sync_succeeded',
      'sync_failed',
      'experiment_exposed',
      'imported_problem_saved',
    ];
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_product_event" (id, user_id, session_id, name, properties, occurred_at) SELECT $1 || ordinal::text, $2, $3, name, '{}'::jsonb, now() FROM unnest($4::text[]) WITH ORDINALITY AS funnel(name, ordinal)`,
      [`ci_funnel_${nonce}_`, firstUserId, `session_${nonce}`, funnelEventNames]
    );
    const [persistedFunnel] = await app.unsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM "${applicationSchema}"."coach_product_event" WHERE user_id = $1 AND name = ANY($2::text[])`,
      [firstUserId, funnelEventNames]
    );
    if (persistedFunnel?.count !== funnelEventNames.length) {
      throw new Error('Expanded product funnel events were not persisted');
    }

    let invalidEventRejected = false;
    try {
      await app.unsafe(
        `INSERT INTO "${applicationSchema}"."coach_product_event" (id, user_id, session_id, name, properties, occurred_at) VALUES ($1, $2, $3, 'not_a_product_event', '{}'::jsonb, now())`,
        [`ci_invalid_event_${nonce}`, firstUserId, `session_${nonce}`]
      );
    } catch (error) {
      invalidEventRejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23514';
    }
    if (!invalidEventRejected) {
      throw new Error('Unknown product event bypassed the database constraint');
    }
  } finally {
    await app.unsafe(
      `DELETE FROM "${applicationSchema}"."user" WHERE id = ANY($1::text[])`,
      [users]
    );
  }
}

export async function runPostgresIntegrationTest(): Promise<void> {
  if (process.env.DB_INTEGRATION_TEST !== 'true') {
    throw new Error('DB_INTEGRATION_TEST=true is required');
  }

  const migrationDatabaseUrl = required('MIGRATION_DATABASE_URL');
  const applicationDatabaseUrl = required('DATABASE_URL');
  const migrationUrl = assertLocalTestUrl(
    migrationDatabaseUrl,
    'MIGRATION_DATABASE_URL'
  );
  const applicationUrl = assertLocalTestUrl(
    applicationDatabaseUrl,
    'DATABASE_URL'
  );
  if (
    migrationUrl.hostname !== applicationUrl.hostname ||
    migrationUrl.port !== applicationUrl.port ||
    migrationUrl.pathname !== applicationUrl.pathname
  ) {
    throw new Error(
      'Migration and application URLs must target the same test DB'
    );
  }

  const applicationRole = safeIdentifier(
    decodeURIComponent(applicationUrl.username),
    'application database role'
  );
  const migrationRole = decodeURIComponent(migrationUrl.username);
  if (!applicationRole || applicationRole === migrationRole) {
    throw new Error(
      'Migration and application database roles must be different'
    );
  }

  const applicationPassword = decodeURIComponent(applicationUrl.password);
  if (!applicationPassword) {
    throw new Error('The application database role requires a password');
  }

  const applicationSchema = safeIdentifier(
    process.env.DB_SCHEMA ?? 'algocoach',
    'DB_SCHEMA'
  );
  const migrationSchema = safeIdentifier(
    process.env.DB_MIGRATIONS_SCHEMA ?? 'drizzle',
    'DB_MIGRATIONS_SCHEMA'
  );
  const migrationTable = safeIdentifier(
    process.env.DB_MIGRATIONS_TABLE ?? '__drizzle_migrations',
    'DB_MIGRATIONS_TABLE'
  );
  const admin = postgres(migrationDatabaseUrl, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
  });

  try {
    await ensureApplicationRole(admin, applicationRole, applicationPassword);
    await migrateDatabase({
      databaseUrl: migrationDatabaseUrl,
      applicationRole,
      requireApplicationRole: true,
    });
    await migrateDatabase({
      databaseUrl: migrationDatabaseUrl,
      applicationRole,
      requireApplicationRole: true,
    });

    const applied = await admin.unsafe<{ created_at: string | number }[]>(`
      SELECT created_at
      FROM "${migrationSchema}"."${migrationTable}"
      ORDER BY created_at ASC
    `);
    const expected = migrationJournal.entries.map((entry) => entry.when);
    if (
      applied.length !== expected.length ||
      applied.some((row, index) => Number(row.created_at) !== expected[index])
    ) {
      throw new Error(
        'The applied migration journal does not match the repository'
      );
    }

    const app = postgres(applicationDatabaseUrl, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
    });
    try {
      const probeName = `ci_database_probe_${Date.now()}`;
      await app.unsafe(
        `INSERT INTO "${applicationSchema}"."config" (name, value) VALUES ($1, $2)`,
        [probeName, 'ok']
      );
      await app.unsafe(
        `DELETE FROM "${applicationSchema}"."config" WHERE name = $1`,
        [probeName]
      );
      await verifyAuthAndLearningIsolation(app, applicationSchema);

      let ddlRejected = false;
      try {
        await app.unsafe(
          `CREATE TABLE "${applicationSchema}"."ci_ddl_must_fail" (id integer)`
        );
      } catch (error) {
        ddlRejected =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '42501';
      }
      if (!ddlRejected) {
        throw new Error('The application role unexpectedly has DDL permission');
      }

      const readiness = await readyHealthStatus(
        {
          NODE_ENV: 'production',
          DATABASE_PROVIDER: 'postgresql',
          DATABASE_URL: applicationDatabaseUrl,
          DATABASE_APPLICATION_ROLE: applicationRole,
          DB_MIGRATIONS_SCHEMA: migrationSchema,
          DB_MIGRATIONS_TABLE: migrationTable,
          AUTH_URL: 'https://algocoach.test',
          AUTH_SECRET: 'ci-only-auth-secret-with-at-least-32-characters',
          OPENROUTER_API_KEY: 'ci-only-openrouter-key',
          REDIS_URL: 'https://redis.example.test',
          REDIS_TOKEN: 'ci-only-redis-token',
          TRUSTED_PROXY_HEADERS: 'x-forwarded-for',
          GOOGLE_AUTH_ENABLED: 'false',
          GOOGLE_ONE_TAP_ENABLED: 'false',
        },
        undefined,
        {
          fetch: async () => Response.json({ result: 'PONG' }),
        }
      );
      if (readiness.status !== 'ok') {
        throw new Error(
          `Readiness failed: ${JSON.stringify(readiness.checks)}`
        );
      }
    } finally {
      await app.end({ timeout: 2 });
    }

    console.log(
      `[database-test] ${expected.length} migrations are current; OAuth and imported-draft idempotency/isolation, restricted DML/readiness, and DDL rejection passed`
    );
  } finally {
    await admin.end({ timeout: 2 });
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';

if (import.meta.url === entryPoint) {
  runPostgresIntegrationTest().catch((error) => {
    console.error(
      `[database-test] ${
        error instanceof Error ? error.message : 'Unknown integration error'
      }`
    );
    process.exit(1);
  });
}
