#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';

type MigrationRow = {
  hash: string;
  created_at: string | number | null;
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validatedIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a simple PostgreSQL identifier`);
  }
  return value;
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function migrateDatabase(options?: {
  databaseUrl?: string;
  allowApplicationDatabaseUrl?: boolean;
  respectAutoMigrateFlag?: boolean;
  applicationRole?: string;
  requireApplicationRole?: boolean;
}): Promise<void> {
  if (
    options?.respectAutoMigrateFlag &&
    process.env.DB_AUTO_MIGRATE === 'false'
  ) {
    console.log('[database] automatic migrations are disabled');
    return;
  }

  const provider = process.env.DATABASE_PROVIDER ?? 'postgresql';
  if (provider !== 'postgresql') {
    throw new Error(
      `Automatic migrations currently require PostgreSQL; received ${provider}`
    );
  }

  const databaseUrl =
    options?.databaseUrl?.trim() ||
    process.env.MIGRATION_DATABASE_URL?.trim() ||
    (options?.allowApplicationDatabaseUrl
      ? process.env.DATABASE_URL?.trim()
      : undefined);
  if (!databaseUrl) {
    throw new Error(
      options?.allowApplicationDatabaseUrl
        ? 'MIGRATION_DATABASE_URL or DATABASE_URL is required for development migrations'
        : 'MIGRATION_DATABASE_URL is required for release migrations'
    );
  }

  const migrationsFolder = path.resolve(
    process.cwd(),
    process.env.DB_MIGRATIONS_OUT ?? './src/config/db/migrations'
  );
  const migrationsSchema = validatedIdentifier(
    process.env.DB_MIGRATIONS_SCHEMA ?? 'drizzle',
    'DB_MIGRATIONS_SCHEMA'
  );
  const migrationsTable = validatedIdentifier(
    process.env.DB_MIGRATIONS_TABLE ?? '__drizzle_migrations',
    'DB_MIGRATIONS_TABLE'
  );
  const applicationSchema = validatedIdentifier(
    process.env.DB_SCHEMA ?? 'algocoach',
    'DB_SCHEMA'
  );
  if (applicationSchema !== 'algocoach') {
    throw new Error(
      'DB_SCHEMA must be algocoach because the committed migrations target that schema'
    );
  }
  const configuredApplicationRole =
    options?.applicationRole?.trim() ||
    process.env.DATABASE_APPLICATION_ROLE?.trim();
  if (options?.requireApplicationRole && !configuredApplicationRole) {
    throw new Error(
      'DATABASE_APPLICATION_ROLE is required for release migrations'
    );
  }
  const applicationRole = configuredApplicationRole
    ? validatedIdentifier(
        configuredApplicationRole,
        'DATABASE_APPLICATION_ROLE'
      )
    : undefined;
  if (
    applicationRole &&
    decodeURIComponent(new URL(databaseUrl).username) === applicationRole
  ) {
    throw new Error(
      'DATABASE_APPLICATION_ROLE must differ from the migration database role'
    );
  }
  const lockTimeoutMs = positiveInteger(
    process.env.DB_MIGRATION_LOCK_TIMEOUT_MS,
    30_000
  );
  const statementTimeoutMs = positiveInteger(
    process.env.DB_MIGRATION_STATEMENT_TIMEOUT_MS,
    60_000
  );
  const migrations = readMigrationFiles({ migrationsFolder });
  const migrationSchemaSql = quotedIdentifier(migrationsSchema);
  const migrationTableSql = quotedIdentifier(migrationsTable);
  const lockKey = `algocoach:${applicationSchema}:${migrationsSchema}.${migrationsTable}`;

  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 10,
    onnotice: () => undefined,
  });

  try {
    await client.begin(async (transaction) => {
      await transaction`select set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`;

      const lockStartedAt = Date.now();
      while (true) {
        const [row] = await transaction<{ locked: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as locked
        `;
        if (row?.locked) break;
        if (Date.now() - lockStartedAt >= lockTimeoutMs) {
          throw new Error(
            `Timed out waiting ${lockTimeoutMs}ms for the migration lock`
          );
        }
        await transaction`select pg_sleep(0.25)`;
      }

      await transaction.unsafe(
        `CREATE SCHEMA IF NOT EXISTS ${migrationSchemaSql}`
      );
      await transaction.unsafe(`
        CREATE TABLE IF NOT EXISTS ${migrationSchemaSql}.${migrationTableSql} (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint NOT NULL UNIQUE
        )
      `);

      const applied = await transaction.unsafe<MigrationRow[]>(`
        SELECT hash, created_at
        FROM ${migrationSchemaSql}.${migrationTableSql}
        ORDER BY created_at ASC
      `);
      const localByTimestamp = new Map(
        migrations.map((migration) => [migration.folderMillis, migration])
      );

      for (const row of applied) {
        const timestamp = Number(row.created_at);
        const local = localByTimestamp.get(timestamp);
        if (!local) {
          throw new Error(
            `Database migration ${timestamp} is missing from the repository`
          );
        }
        if (local.hash !== row.hash) {
          throw new Error(
            `Database migration ${timestamp} does not match its committed SQL file`
          );
        }
      }

      const appliedTimestamps = new Set(
        applied.map((row) => Number(row.created_at))
      );
      let appliedCount = 0;

      for (const migration of migrations) {
        if (appliedTimestamps.has(migration.folderMillis)) continue;

        for (const statement of migration.sql) {
          if (statement.trim()) await transaction.unsafe(statement);
        }
        await transaction.unsafe(
          `INSERT INTO ${migrationSchemaSql}.${migrationTableSql} (hash, created_at) VALUES ($1, $2)`,
          [migration.hash, migration.folderMillis]
        );
        appliedCount += 1;
      }

      if (applicationRole) {
        const [role] = await transaction<
          {
            exists: boolean;
            owns_schema: boolean;
            rolcreatedb: boolean;
            rolcreaterole: boolean;
            rolsuper: boolean;
          }[]
        >`
          select
            exists(select 1 from pg_roles where rolname = ${applicationRole}) as exists,
            exists(
              select 1
              from pg_namespace
              where nspname = ${applicationSchema}
                and pg_get_userbyid(nspowner) = ${applicationRole}
            ) as owns_schema,
            coalesce((select rolsuper from pg_roles where rolname = ${applicationRole}), false) as rolsuper,
            coalesce((select rolcreatedb from pg_roles where rolname = ${applicationRole}), false) as rolcreatedb,
            coalesce((select rolcreaterole from pg_roles where rolname = ${applicationRole}), false) as rolcreaterole
        `;
        if (!role?.exists) {
          throw new Error(
            `Application database role ${applicationRole} does not exist`
          );
        }
        if (
          role.owns_schema ||
          role.rolsuper ||
          role.rolcreatedb ||
          role.rolcreaterole
        ) {
          throw new Error(
            `Application database role ${applicationRole} is not restricted`
          );
        }

        const applicationSchemaSql = quotedIdentifier(applicationSchema);
        const applicationRoleSql = quotedIdentifier(applicationRole);
        await transaction.unsafe(
          `REVOKE CREATE ON SCHEMA ${applicationSchemaSql} FROM ${applicationRoleSql}`
        );
        await transaction.unsafe(
          `GRANT USAGE ON SCHEMA ${applicationSchemaSql} TO ${applicationRoleSql}`
        );
        await transaction.unsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${applicationSchemaSql} TO ${applicationRoleSql}`
        );
        await transaction.unsafe(
          `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${applicationSchemaSql} TO ${applicationRoleSql}`
        );
        await transaction.unsafe(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${applicationSchemaSql} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${applicationRoleSql}`
        );
        await transaction.unsafe(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${applicationSchemaSql} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${applicationRoleSql}`
        );
        await transaction.unsafe(
          `GRANT USAGE ON SCHEMA ${migrationSchemaSql} TO ${applicationRoleSql}`
        );
        await transaction.unsafe(
          `GRANT SELECT ON ${migrationSchemaSql}.${migrationTableSql} TO ${applicationRoleSql}`
        );
      }

      console.log(
        appliedCount > 0
          ? `[database] applied ${appliedCount} migration(s)`
          : '[database] schema is current'
      );
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';

if (import.meta.url === entryPoint) {
  migrateDatabase({
    allowApplicationDatabaseUrl: process.argv.includes(
      '--allow-application-database-url'
    ),
    requireApplicationRole: process.argv.includes('--require-application-role'),
  }).catch((error) => {
    console.error(
      `[database] migration failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
    process.exit(1);
  });
}
