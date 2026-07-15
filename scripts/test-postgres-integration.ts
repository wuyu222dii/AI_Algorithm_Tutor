#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import migrationJournal from '../src/config/db/migrations/meta/_journal.json';
import { readyHealthStatus } from '../src/core/db/readiness';
import { CatalogDatabaseStore } from '../src/features/algorithm-coach/catalog/catalog-store.server';
import { curatedExercismProblems } from '../src/features/algorithm-coach/catalog/curated-exercism-problems';
import type { ExercismCatalogAdapter } from '../src/features/algorithm-coach/catalog/exercism-adapter';
import { exercismSnapshotFixture } from '../src/features/algorithm-coach/catalog/fixtures/exercism-snapshot.fixture';
import { migrateDatabase } from './migrate-database';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const READ_ONLY_CATALOG_TABLES = [
  'coach_catalog_source',
  'coach_catalog_sync_run',
  'coach_problem_candidate',
  'coach_problem_revision',
  'coach_problem_origin',
  'coach_catalog_review_audit',
  'coach_test_case',
] as const;

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

async function verifyVersionedCatalog(
  app: postgres.Sql,
  applicationSchema: string
) {
  const [catalog] = await app.unsafe<
    {
      curated_count: number;
      revision_count: number;
      missing_pointer_count: number;
      missing_typescript_count: number;
      unversioned_test_count: number;
      published_catalog_count: number;
      external_count: number;
      external_current_revision_count: number;
      external_test_count: number;
      external_origin_count: number;
      external_audit_count: number;
      p1_count: number;
      p1_revision_metadata_count: number;
      p1_test_count: number;
      p1_origin_count: number;
      p1_audit_count: number;
    }[]
  >(`
    SELECT
      count(*)::int AS curated_count,
      count(revision.id)::int AS revision_count,
      count(*) FILTER (WHERE problem.current_revision_id IS NULL)::int AS missing_pointer_count,
      count(*) FILTER (WHERE NOT (revision.language_configs ? 'typescript'))::int AS missing_typescript_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_test_case" AS test_case
        JOIN "${applicationSchema}"."coach_problem" AS test_problem
          ON test_problem.id = test_case.problem_id
        WHERE test_problem.owner_user_id IS NULL
          AND test_problem.source = 'curated'
          AND test_case.revision_id IS NULL
      ) AS unversioned_test_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_problem"
        WHERE owner_user_id IS NULL AND status = 'published'
      ) AS published_catalog_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_problem"
        WHERE owner_user_id IS NULL AND source = 'external' AND status = 'published'
      ) AS external_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_problem"
        WHERE owner_user_id IS NULL AND source = 'external' AND current_revision_id IS NOT NULL
      ) AS external_current_revision_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_test_case" AS external_test
        JOIN "${applicationSchema}"."coach_problem" AS external_problem
          ON external_problem.id = external_test.problem_id
        WHERE external_problem.source = 'external' AND external_test.revision_id IS NOT NULL
      ) AS external_test_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_problem_origin"
        WHERE license_spdx = 'MIT'
      ) AS external_origin_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_catalog_review_audit"
        WHERE metadata->>'reviewer' = 'migration:0015'
      ) AS external_audit_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_problem_revision"
        WHERE catalog_version = 'p1-learning-v1'
          AND status = 'published'
      ) AS p1_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_problem_revision"
        WHERE catalog_version = 'p1-learning-v1'
          AND jsonb_array_length(learning_objectives) > 0
          AND cardinality(prerequisite_topics) > 0
          AND cardinality(solution_patterns) > 0
          AND language_configs ?& array['javascript', 'python', 'typescript']
          AND content_hash LIKE 'sha256:%'
      ) AS p1_revision_metadata_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_test_case" AS p1_test
        JOIN "${applicationSchema}"."coach_problem_revision" AS p1_revision
          ON p1_revision.id = p1_test.revision_id
        WHERE p1_revision.catalog_version = 'p1-learning-v1'
      ) AS p1_test_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_problem_origin" AS p1_origin
        JOIN "${applicationSchema}"."coach_problem_revision" AS p1_revision
          ON p1_revision.problem_id = p1_origin.problem_id
         AND p1_revision.catalog_version = 'p1-learning-v1'
        WHERE p1_origin.license_spdx = 'LicenseRef-AlgoCoach-Original'
          AND p1_origin.source_revision = p1_revision.source_revision
          AND p1_origin.content_hash = p1_revision.content_hash
      ) AS p1_origin_count,
      (
        SELECT count(*)::int
        FROM "${applicationSchema}"."coach_catalog_review_audit"
        WHERE metadata->>'reviewer' = 'migration:0018'
      ) AS p1_audit_count
    FROM "${applicationSchema}"."coach_problem" AS problem
    LEFT JOIN "${applicationSchema}"."coach_problem_revision" AS revision
      ON revision.id = problem.current_revision_id
    WHERE problem.owner_user_id IS NULL
      AND problem.source = 'curated'
  `);
  if (
    !catalog ||
    catalog.curated_count < 53 ||
    catalog.revision_count !== catalog.curated_count ||
    catalog.missing_pointer_count !== 0 ||
    catalog.missing_typescript_count !== 0 ||
    catalog.unversioned_test_count !== 0 ||
    catalog.published_catalog_count < 73 ||
    catalog.external_count !== 20 ||
    catalog.external_current_revision_count !== 20 ||
    catalog.external_test_count < 60 ||
    catalog.external_origin_count !== 20 ||
    catalog.external_audit_count !== 20 ||
    catalog.p1_count !== 15 ||
    catalog.p1_revision_metadata_count !== 15 ||
    catalog.p1_test_count !== 60 ||
    catalog.p1_origin_count !== 15 ||
    catalog.p1_audit_count !== 15
  ) {
    throw new Error(
      `Versioned catalog backfill is incomplete: ${JSON.stringify(catalog)}`
    );
  }
}

async function verifyCatalogOwnershipConstraints(
  admin: postgres.Sql,
  applicationSchema: string
) {
  const rows = await admin.unsafe<
    { problem_id: string; revision_id: string; test_id: string }[]
  >(`
    SELECT DISTINCT ON (problem.id)
      problem.id AS problem_id, revision.id AS revision_id, test_case.id AS test_id
    FROM "${applicationSchema}"."coach_problem" AS problem
    JOIN "${applicationSchema}"."coach_problem_revision" AS revision
      ON revision.problem_id = problem.id
    JOIN "${applicationSchema}"."coach_test_case" AS test_case
      ON test_case.problem_id = problem.id AND test_case.revision_id = revision.id
    WHERE problem.owner_user_id IS NULL
    ORDER BY problem.id, test_case.id
    LIMIT 2
  `);
  if (rows.length !== 2 || rows[0]?.problem_id === rows[1]?.problem_id) {
    throw new Error('Catalog ownership constraint fixtures are unavailable');
  }

  const expectForeignKeyViolation = async (
    operation: (tx: postgres.TransactionSql) => Promise<unknown>,
    label: string
  ) => {
    let rejected = false;
    try {
      await admin.begin(operation);
    } catch (error) {
      rejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23503';
    }
    if (!rejected) throw new Error(`${label} bypassed composite ownership`);
  };

  await expectForeignKeyViolation(
    (tx) =>
      tx.unsafe(
        `UPDATE "${applicationSchema}"."coach_problem" SET current_revision_id = $1 WHERE id = $2`,
        [rows[1]!.revision_id, rows[0]!.problem_id]
      ),
    'Current revision pointer'
  );
  await expectForeignKeyViolation(
    (tx) =>
      tx.unsafe(
        `INSERT INTO "${applicationSchema}"."coach_test_case" (id, problem_id, revision_id, ordinal, args, expected) VALUES ($1, $2, $3, 30000, '[]'::jsonb, 'null'::jsonb)`,
        [
          `ci_cross_revision_test_${Date.now()}`,
          rows[1]!.problem_id,
          rows[0]!.revision_id,
        ]
      ),
    'Test revision pointer'
  );

  const expectImmutableRejection = async (
    operation: (tx: postgres.TransactionSql) => Promise<unknown>,
    label: string
  ) => {
    let rejected = false;
    try {
      await admin.begin(operation);
    } catch (error) {
      rejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23514';
    }
    if (!rejected) throw new Error(`${label} bypassed revision immutability`);
  };

  await expectImmutableRejection(
    (tx) =>
      tx.unsafe(
        `UPDATE "${applicationSchema}"."coach_problem_revision" SET title = jsonb_set(title, '{en}', '"tampered"'::jsonb) WHERE id = $1`,
        [rows[0]!.revision_id]
      ),
    'Revision content update'
  );
  await expectImmutableRejection(
    (tx) =>
      tx.unsafe(
        `UPDATE "${applicationSchema}"."coach_problem_revision" SET solution_patterns = ARRAY['tampered']::text[] WHERE id = $1`,
        [rows[0]!.revision_id]
      ),
    'Revision learning metadata update'
  );
  await expectImmutableRejection(
    (tx) =>
      tx.unsafe(
        `DELETE FROM "${applicationSchema}"."coach_problem_revision" WHERE id = $1`,
        [rows[0]!.revision_id]
      ),
    'Revision deletion'
  );
  await expectImmutableRejection(
    (tx) =>
      tx.unsafe(
        `UPDATE "${applicationSchema}"."coach_test_case" SET expected = 'null'::jsonb WHERE id = $1`,
        [rows[0]!.test_id]
      ),
    'Revision test update'
  );
  await expectImmutableRejection(
    (tx) =>
      tx.unsafe(
        `DELETE FROM "${applicationSchema}"."coach_test_case" WHERE id = $1`,
        [rows[0]!.test_id]
      ),
    'Revision test deletion'
  );

  await admin.unsafe(
    `UPDATE "${applicationSchema}"."coach_problem_revision" SET status = status, published_at = published_at WHERE id = $1`,
    [rows[0]!.revision_id]
  );
}

async function verifyApplicationCatalogPermissions(
  app: postgres.Sql,
  applicationSchema: string
) {
  const privileges = await app.unsafe<
    {
      table_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }[]
  >(
    `
      SELECT
        table_name,
        has_table_privilege(current_user, format('%I.%I', $1::text, table_name), 'SELECT') AS can_select,
        has_table_privilege(current_user, format('%I.%I', $1::text, table_name), 'INSERT') AS can_insert,
        has_table_privilege(current_user, format('%I.%I', $1::text, table_name), 'UPDATE') AS can_update,
        has_table_privilege(current_user, format('%I.%I', $1::text, table_name), 'DELETE') AS can_delete
      FROM unnest($2::text[]) AS catalog_table(table_name)
      ORDER BY table_name
    `,
    [applicationSchema, READ_ONLY_CATALOG_TABLES]
  );
  if (
    privileges.length !== READ_ONLY_CATALOG_TABLES.length ||
    privileges.some(
      (row) =>
        !row.can_select || row.can_insert || row.can_update || row.can_delete
    )
  ) {
    throw new Error(
      `Application catalog privileges are not read-only: ${JSON.stringify(privileges)}`
    );
  }
}

async function verifyCatalogPublicationLifecycle(
  admin: postgres.Sql,
  applicationSchema: string
) {
  const database = drizzle(admin);
  const store = new CatalogDatabaseStore(database);
  const adapter = {
    fetchSnapshot: async () => ({
      notModified: false,
      revision: exercismSnapshotFixture.revision,
      etag: exercismSnapshotFixture.etag,
      localContentFingerprint: exercismSnapshotFixture.localContentFingerprint,
      snapshot: exercismSnapshotFixture,
    }),
  } as unknown as ExercismCatalogAdapter;

  const firstSync = await store.syncExercism(
    curatedExercismProblems,
    adapter,
    'manual'
  );
  if (firstSync.candidateIds.length !== 20) {
    throw new Error('Fixture sync did not create exactly 20 candidates');
  }
  const secondSync = await store.syncExercism(
    curatedExercismProblems,
    adapter,
    'manual'
  );
  if (secondSync.candidateIds.length !== 0) {
    throw new Error('Repeated fixture sync created duplicate candidates');
  }

  const candidateId = firstSync.candidateIds[0]!;
  const targetProblem = curatedExercismProblems[0]!;
  const validation = await store.validateCandidates([candidateId]);
  if (validation.validated !== 1) {
    throw new Error('Fixture candidate did not pass validation');
  }

  let unapprovedPublishRejected = false;
  try {
    await store.publishCandidates([candidateId], 'ci-release-manager');
  } catch {
    unapprovedPublishRejected = true;
  }
  if (!unapprovedPublishRejected) {
    throw new Error('An unapproved catalog candidate was published');
  }

  const approval = await store.approveCandidates(
    [candidateId],
    'ci-content-reviewer'
  );
  const repeatedApproval = await store.approveCandidates(
    [candidateId],
    'ci-content-reviewer'
  );
  if (approval.approved !== 1 || repeatedApproval.alreadyApproved !== 1) {
    throw new Error('Catalog approval was not independently idempotent');
  }

  const historyUserId = `ci_catalog_history_${Date.now()}`;
  await admin.unsafe(
    `INSERT INTO "${applicationSchema}"."user" (id, name, email, email_verified) VALUES ($1, 'Catalog history', $2, true)`,
    [historyUserId, `${historyUserId}@example.test`]
  );
  try {
    await admin.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_practice_session" (id, user_id, problem_slug_snapshot, problem_content_version, started_at, updated_at) VALUES ($1, $2, $3, 1, now(), now())`,
      [`${historyUserId}_session`, historyUserId, targetProblem.slug]
    );

    const published = await store.publishCandidates(
      [candidateId],
      'ci-release-manager'
    );
    const repeatedPublish = await store.publishCandidates(
      [candidateId],
      'ci-release-manager'
    );
    if (published.published !== 1 || repeatedPublish.alreadyPublished !== 1) {
      throw new Error('Catalog publication was not atomically idempotent');
    }

    const [publishedState] = await admin.unsafe<
      { version: number; revision_count: number }[]
    >(
      `SELECT current_revision.version, count(all_revision.id)::int AS revision_count FROM "${applicationSchema}"."coach_problem" AS problem JOIN "${applicationSchema}"."coach_problem_revision" AS current_revision ON current_revision.id = problem.current_revision_id JOIN "${applicationSchema}"."coach_problem_revision" AS all_revision ON all_revision.problem_id = problem.id WHERE problem.slug = $1 GROUP BY current_revision.version`,
      [targetProblem.slug]
    );
    if (publishedState?.version !== 2 || publishedState.revision_count !== 2) {
      throw new Error('Publishing did not create an immutable second revision');
    }

    await store.rollbackProblem(targetProblem.slug, 1, 'ci-release-manager');
    const [rolledBack] = await admin.unsafe<
      { version: number; session_version: number }[]
    >(
      `SELECT revision.version, session.problem_content_version AS session_version FROM "${applicationSchema}"."coach_problem" AS problem JOIN "${applicationSchema}"."coach_problem_revision" AS revision ON revision.id = problem.current_revision_id JOIN "${applicationSchema}"."coach_practice_session" AS session ON session.problem_slug_snapshot = problem.slug AND session.user_id = $2 WHERE problem.slug = $1`,
      [targetProblem.slug, historyUserId]
    );
    if (rolledBack?.version !== 1 || rolledBack.session_version !== 1) {
      throw new Error('Rollback changed historical practice provenance');
    }
  } finally {
    await admin.unsafe(
      `DELETE FROM "${applicationSchema}"."user" WHERE id = $1`,
      [historyUserId]
    );
  }
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

    const versionedSessionSlug = `versioned-session-${nonce}`;
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_practice_session" (id, user_id, problem_slug_snapshot, problem_content_version, started_at, updated_at) VALUES ($1, $2, $3, 1, now(), now()), ($4, $2, $3, 2, now(), now())`,
      [
        `ci_session_v1_${nonce}`,
        firstUserId,
        versionedSessionSlug,
        `ci_session_v2_${nonce}`,
      ]
    );
    const versionedSessions = await app.unsafe<
      { problem_content_version: number }[]
    >(
      `SELECT problem_content_version FROM "${applicationSchema}"."coach_practice_session" WHERE user_id = $1 AND problem_slug_snapshot = $2 ORDER BY problem_content_version`,
      [firstUserId, versionedSessionSlug]
    );
    if (
      versionedSessions.length !== 2 ||
      versionedSessions[0]?.problem_content_version !== 1 ||
      versionedSessions[1]?.problem_content_version !== 2
    ) {
      throw new Error(
        'Versioned practice sessions did not round-trip independently'
      );
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

    const planId = `daily_plan_${nonce}`;
    const planClientId = `daily-plan:UTC:2026-07-15:${nonce}`;
    const planTasks = [
      {
        id: `${planClientId}:weak-topic`,
        kind: 'weak-topic',
        status: 'pending',
        problemId: 'minimum-processing-rate',
        problemSlug: 'minimum-processing-rate',
        problemContentVersion: 1,
        primaryTopic: 'binary-search',
        difficulty: 'medium',
        reason: 'weak-mastery',
        estimatedMinutes: 20,
      },
    ];
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_daily_learning_plan" (id, user_id, client_plan_id, local_date, time_zone, budget_minutes, estimated_minutes, preferred_language, goal, tasks, changes) VALUES ($1, $2, $3, '2026-07-15', 'UTC', 30, 20, 'python', 'interview', $4::jsonb, '[]'::jsonb) ON CONFLICT (id) DO UPDATE SET estimated_minutes = excluded.estimated_minutes, tasks = excluded.tasks, updated_at = now()`,
      [planId, firstUserId, planClientId, planTasks]
    );
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_daily_learning_plan" (id, user_id, client_plan_id, local_date, time_zone, budget_minutes, estimated_minutes, preferred_language, goal, tasks, changes) VALUES ($1, $2, $3, '2026-07-15', 'UTC', 30, 20, 'javascript', 'foundation', $4::jsonb, '[]'::jsonb)`,
      [`daily_plan_other_${nonce}`, secondUserId, planClientId, planTasks]
    );
    const planRows = await app.unsafe<
      { user_id: string; estimated_minutes: number }[]
    >(
      `SELECT user_id, estimated_minutes FROM "${applicationSchema}"."coach_daily_learning_plan" WHERE client_plan_id = $1 ORDER BY user_id`,
      [planClientId]
    );
    if (planRows.length !== 2) {
      throw new Error('Daily plans were not idempotent and user-isolated');
    }

    const reviewAttemptId = `review_attempt_${nonce}`;
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_review_attempt" (id, user_id, client_attempt_id, problem_slug_snapshot, problem_content_version, answer, grade, selected_rating, submitted_at) VALUES ($1, $2, $3, 'dependency-cycle', 1, 'Use DFS colors and detect a back edge.', $4::jsonb, 'good', now())`,
      [
        reviewAttemptId,
        firstUserId,
        `client_${reviewAttemptId}`,
        {
          suggestedRating: 'good',
          coverage: 0.8,
          matchedPoints: ['DFS colors'],
          missingPoints: [],
        },
      ]
    );
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_learning_artifact" (id, user_id, problem_slug_snapshot, problem_content_version, type, locale, title, summary, review_grade, created_at) VALUES ($1, $2, 'dependency-cycle', 1, 'review_grade', 'en', 'Recall grade', 'Good coverage', $3::jsonb, now())`,
      [
        `review_grade_artifact_${nonce}`,
        firstUserId,
        {
          hitConcepts: ['DFS colors'],
          missedConcepts: [],
          feedback: 'Good coverage',
          suggestedRating: 'good',
          confidence: 0.9,
        },
      ]
    );

    const baselineId = `baseline_${nonce}`;
    const checkpointId = `checkpoint_${nonce}`;
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_assessment" (id, user_id, kind, problem_slugs, problem_versions, status, duration_minutes, started_at, completed_at, score, correct_count, total_count, average_duration_ms) VALUES ($1, $2, 'baseline', ARRAY['dependency-cycle'], '[{"slug":"dependency-cycle","contentVersion":1}]'::jsonb, 'completed', 8, now() - interval '14 days', now() - interval '14 days', 50, 1, 2, 120000), ($3, $2, 'checkpoint', ARRAY['dependency-cycle'], '[{"slug":"dependency-cycle","contentVersion":1}]'::jsonb, 'completed', 8, now(), now(), 100, 2, 2, 90000)`,
      [baselineId, firstUserId, checkpointId]
    );
    await app.unsafe(
      `UPDATE "${applicationSchema}"."coach_assessment" SET baseline_assessment_id = $1, comparison = '{"baselineAssessmentId":"baseline","scoreDelta":50,"correctCountDelta":1,"averageDurationDeltaMs":-30000}'::jsonb WHERE id = $2`,
      [baselineId, checkpointId]
    );

    const correctionEpisode = {
      id: `episode_${nonce}`,
      problemSlug: versionedSessionSlug,
      problemContentVersion: 1,
      startedAt: new Date().toISOString(),
      diagnosedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      initialFailure: {
        executedAt: new Date().toISOString(),
        status: 'failed',
        passedTests: 0,
        totalTests: 1,
        failedTests: [],
      },
      diagnosisCategory: 'wrong-answer',
      diagnoses: [],
      attempts: [],
      resolved: true,
      resolvedAt: new Date().toISOString(),
      passedWithinThreeRuns: true,
      repairDurationMs: 1000,
      repeatedDiagnosisCategories: [],
    };
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_correction_episode" (id, user_id, client_episode_id, problem_slug_snapshot, problem_content_version, diagnosis_category, payload, resolved, passed_within_three_runs, repair_duration_ms, started_at, diagnosed_at, ended_at, resolved_at) VALUES ($1, $2, $3, $4, 1, 'wrong-answer', $5::jsonb, true, true, 1000, now(), now(), now(), now())`,
      [
        `correction_${nonce}`,
        firstUserId,
        correctionEpisode.id,
        versionedSessionSlug,
        correctionEpisode,
      ]
    );
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_code_run" (id, session_id, problem_slug_snapshot, problem_content_version, language, runtime_version, runner_mode, code_snapshot, status, passed_tests, total_tests, duration_ms, executed_at) VALUES ($1, $2, $3, 1, 'python', 'pyodide@test', 'browser-worker', 'def solve(): pass', 'passed', 1, 1, 10, now())`,
      [`effective_run_${nonce}`, `ci_session_v1_${nonce}`, versionedSessionSlug]
    );
    const [cohort] = await app.unsafe<
      { effective_practices: number; diagnosis_three_run_pass_rate: number }[]
    >(
      `SELECT effective_practices, diagnosis_three_run_pass_rate FROM "${applicationSchema}"."coach_cohort_metric_v" WHERE user_id = $1`,
      [firstUserId]
    );
    if (
      !cohort ||
      cohort.effective_practices < 1 ||
      Number(cohort.diagnosis_three_run_pass_rate) !== 1
    ) {
      throw new Error('Cohort metrics did not include effective correction');
    }

    const importedDraftValues = {
      title: { zh: '私有草稿', en: 'Private draft' },
      description: { zh: '测试题面', en: 'Test statement' },
      templates: {
        javascript: 'function solve(input) { return input; }',
        typescript:
          'function solveTyped(input: string): string { return input; }',
        python: 'def solve(input):\n    return input',
      },
      languageConfigs: {
        javascript: {
          entryPoint: 'solve',
          template: 'function solve(input) { return input; }',
          signature: {
            parameters: [{ name: 'input', type: { kind: 'string' } }],
            returns: { kind: 'string' },
          },
          runtimeVersion: 'quickjs@test',
        },
        typescript: {
          entryPoint: 'solveTyped',
          template:
            'function solveTyped(input: string): string { return input; }',
          signature: {
            parameters: [{ name: 'input', type: { kind: 'string' } }],
            returns: { kind: 'string' },
          },
          runtimeVersion: 'typescript@test',
        },
        python: {
          entryPoint: 'solve_python',
          template: 'def solve_python(input):\n    return input',
          signature: {
            parameters: [{ name: 'input', type: { kind: 'string' } }],
            returns: { kind: 'string' },
          },
          runtimeVersion: 'pyodide@test',
        },
      },
      signature: {
        parameters: [{ name: 'input', type: { kind: 'string' } }],
        returns: { kind: 'string' },
      },
      hints: { zh: ['', '', ''], en: ['', '', ''] },
    };
    const insertImportedDraft = async (
      id: string,
      ownerUserId: string,
      slug: string,
      active: boolean
    ) =>
      app.unsafe(
        `INSERT INTO "${applicationSchema}"."coach_problem" (id, slug, owner_user_id, source, title, description, difficulty, topics, entry_point, templates, language_configs, signature, hints, status, is_active) VALUES ($1, $2, $3, 'imported', $4::jsonb, $5::jsonb, 'medium', ARRAY['custom']::text[], 'solve', $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, 'draft', $10)`,
        [
          id,
          slug,
          ownerUserId,
          importedDraftValues.title,
          importedDraftValues.description,
          importedDraftValues.templates,
          importedDraftValues.languageConfigs,
          importedDraftValues.signature,
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

    const importedTestId = `ci_imported_test_${nonce}`;
    await app.unsafe(
      `INSERT INTO "${applicationSchema}"."coach_imported_test_case" (id, problem_id, owner_user_id, ordinal, args, expected, is_sample) VALUES ($1, $2, $3, 0, $4::jsonb, $5::jsonb, true)`,
      [
        importedTestId,
        `ci_draft_first_a_${nonce}`,
        firstUserId,
        ['round-trip'],
        'round-trip',
      ]
    );
    const [importedContract] = await app.unsafe<
      {
        typescript_entry_point: string;
        python_runtime: string;
        test_count: number;
        language_configs: unknown;
      }[]
    >(
      `SELECT problem.language_configs, problem.language_configs->'typescript'->>'entryPoint' AS typescript_entry_point, problem.language_configs->'python'->>'runtimeVersion' AS python_runtime, count(test_case.id)::int AS test_count FROM "${applicationSchema}"."coach_problem" AS problem LEFT JOIN "${applicationSchema}"."coach_imported_test_case" AS test_case ON test_case.problem_id = problem.id AND test_case.owner_user_id = problem.owner_user_id WHERE problem.id = $1 AND problem.owner_user_id = $2 GROUP BY problem.id`,
      [`ci_draft_first_a_${nonce}`, firstUserId]
    );
    if (
      importedContract?.typescript_entry_point !== 'solveTyped' ||
      importedContract.python_runtime !== 'pyodide@test' ||
      importedContract.test_count !== 1
    ) {
      throw new Error(
        `Imported language contracts or tests did not round-trip: ${JSON.stringify(importedContract)}`
      );
    }
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
      'language_selected',
      'typescript_transpile_failed',
      'experiment_exposed',
      'imported_problem_saved',
      'catalog_sync_completed',
      'catalog_candidate_rejected',
      'catalog_revision_published',
      'catalog_revision_rolled_back',
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
    await verifyCatalogOwnershipConstraints(admin, applicationSchema);
    await verifyCatalogPublicationLifecycle(admin, applicationSchema);

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
      await verifyVersionedCatalog(app, applicationSchema);
      await verifyApplicationCatalogPermissions(app, applicationSchema);
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
      `[database-test] ${expected.length} migrations are current; catalog sync/approval/publication/rollback, immutable history, OAuth and imported-draft isolation, restricted DML/readiness, and DDL rejection passed`
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
