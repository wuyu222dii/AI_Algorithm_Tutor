import postgres from 'postgres';

import {
  CatalogDatabaseAccessError,
  validateCatalogDatabaseAccess,
  type CatalogDatabaseAccessSnapshot,
} from '../src/core/db/catalog-database-access';
import {
  CatalogDatabaseUrlConfigurationError,
  validateCatalogDatabaseUrl,
} from '../src/core/db/catalog-database-url';

const SCHEMA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const { configuredUsername } = validateCatalogDatabaseUrl(databaseUrl);
  const schema = process.env.DB_SCHEMA?.trim() || 'algocoach';
  if (!SCHEMA_IDENTIFIER.test(schema)) {
    throw new CatalogDatabaseAccessError('schema_usage_missing');
  }

  const sql = postgres(databaseUrl!, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 2,
    prepare: false,
    onnotice: () => undefined,
  });

  try {
    const candidateTable = `${schema}.coach_problem_candidate`;
    const publishedProblemTable = `${schema}.coach_problem`;
    const rawContentUniqueIndex = `${schema}.uq_coach_problem_candidate_raw_content`;
    const [snapshot] = await sql<CatalogDatabaseAccessSnapshot[]>`
      SELECT
        current_user AS "currentUser",
        session_user AS "sessionUser",
        has_schema_privilege(current_user, ${schema}, 'USAGE') AS "schemaUsage",
        pg_has_role(current_user, 'algocoach_catalog_sync', 'member') AS "syncRoleMember",
        has_table_privilege(current_user, ${candidateTable}, 'INSERT') AS "candidateInsert",
        has_table_privilege(current_user, ${candidateTable}, 'UPDATE') AS "candidateUpdate",
        to_regclass(${rawContentUniqueIndex}) IS NOT NULL AS "rawContentUniqueIndex",
        has_table_privilege(current_user, ${publishedProblemTable}, 'INSERT') AS "publishedProblemInsert",
        has_table_privilege(current_user, ${publishedProblemTable}, 'UPDATE') AS "publishedProblemUpdate",
        has_table_privilege(current_user, ${publishedProblemTable}, 'DELETE') AS "publishedProblemDelete"
    `;
    if (!snapshot) {
      throw new Error('missing_access_snapshot');
    }
    validateCatalogDatabaseAccess(snapshot, configuredUsername);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

function reportFailure(error: unknown): void {
  if (error instanceof CatalogDatabaseUrlConfigurationError) {
    console.error(
      `[catalog] database URL preflight failed (${error.code}): ${error.message}`
    );
  } else if (error instanceof CatalogDatabaseAccessError) {
    console.error(
      `[catalog] database access preflight failed (${error.code}): ${error.message}`
    );
  } else {
    console.error(
      '[catalog] database access preflight failed (connection_or_probe_failed): verify the secret, network access, migrations through 0021, and restricted role grants.'
    );
  }
  process.exitCode = 1;
}

void main()
  .then(() => {
    console.log(
      '[catalog] database URL and restricted access preflight passed'
    );
  })
  .catch(reportFailure);
