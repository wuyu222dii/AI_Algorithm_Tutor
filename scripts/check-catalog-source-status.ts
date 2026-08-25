/**
 * Reports Exercism catalog source readiness and recent sync runs.
 * Uses DATABASE_URL (or CATALOG_ADMIN_DATABASE_URL as fallback) without
 * printing connection strings or credentials.
 */
import postgres from 'postgres';

const SCHEMA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXERCISM_SOURCE_KEY = 'exercism-problem-specifications';

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.CATALOG_ADMIN_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      'Set DATABASE_URL (preferred: CATALOG_DATABASE_URL mapped to DATABASE_URL) or CATALOG_ADMIN_DATABASE_URL.'
    );
  }
  const schema = process.env.DB_SCHEMA?.trim() || 'algocoach';
  if (!SCHEMA_IDENTIFIER.test(schema)) {
    throw new Error(`Invalid DB_SCHEMA: ${schema}`);
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 2,
    prepare: false,
    onnotice: () => undefined,
  });

  try {
    const sourceTable = sql(`${schema}.coach_catalog_source`);
    const syncRunTable = sql(`${schema}.coach_catalog_sync_run`);
    const [identity] = await sql<
      {
        currentUser: string;
        sessionUser: string;
      }[]
    >`
      SELECT current_user AS "currentUser", session_user AS "sessionUser"
    `;
    const sources = await sql<
      {
        key: string;
        status: string;
        syncEnabled: boolean;
        lastSuccessfulRevision: string | null;
        updatedAt: Date;
      }[]
    >`
      SELECT
        key,
        status,
        sync_enabled AS "syncEnabled",
        last_successful_revision AS "lastSuccessfulRevision",
        updated_at AS "updatedAt"
      FROM ${sourceTable}
      WHERE key = ${EXERCISM_SOURCE_KEY}
      LIMIT 1
    `;
    const source = sources[0];
    const runs = source
      ? await sql<
          {
            id: string;
            trigger: string;
            status: string;
            errorCode: string | null;
            errorMessage: string | null;
            createdAt: Date;
          }[]
        >`
          SELECT
            r.id,
            r.trigger,
            r.status,
            r.error_code AS "errorCode",
            r.error_message AS "errorMessage",
            r.created_at AS "createdAt"
          FROM ${syncRunTable} AS r
          INNER JOIN ${sourceTable} AS s
            ON s.id = r.source_id
          WHERE s.key = ${EXERCISM_SOURCE_KEY}
          ORDER BY r.created_at DESC
          LIMIT 8
        `
      : [];

    const scheduledSyncReady = Boolean(
      source && source.status === 'active' && source.syncEnabled
    );
    const report = {
      command: 'catalog:source:status',
      identity: {
        currentUser: identity?.currentUser,
        sessionUser: identity?.sessionUser,
      },
      source: source
        ? {
            key: source.key,
            status: source.status,
            syncEnabled: source.syncEnabled,
            lastSuccessfulRevision: source.lastSuccessfulRevision,
            updatedAt: source.updatedAt.toISOString(),
          }
        : null,
      scheduledSyncReady,
      recentRuns: runs.map((run) => ({
        id: run.id,
        trigger: run.trigger,
        status: run.status,
        errorCode: run.errorCode,
        errorMessage: run.errorMessage?.slice(0, 200) ?? null,
        createdAt: run.createdAt.toISOString(),
      })),
      remediation: scheduledSyncReady
        ? null
        : {
            sql: `UPDATE ${schema}.coach_catalog_source SET status = 'active', sync_enabled = true, updated_at = NOW() WHERE key = '${EXERCISM_SOURCE_KEY}';`,
            note: 'Run with a privileged migration/admin role, then re-check. Do not grant publish rights to the sync worker.',
          },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!scheduledSyncReady) {
      process.exitCode = 2;
    }
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[catalog] source status check failed: ${message}`);
  process.exitCode = 1;
});
