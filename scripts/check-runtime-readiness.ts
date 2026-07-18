#!/usr/bin/env node
import postgres from 'postgres';

import { readyHealthStatus } from '../src/core/db/readiness';
import { databaseReleaseMarkerMatches } from '../src/core/db/release-marker';

async function checkDatabaseReleaseMarker() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const schema = (process.env.DB_SCHEMA ?? 'algocoach').trim();
  const releaseId = process.env.EXPECTED_DATABASE_RELEASE_ID?.trim() ?? '';
  const channel = process.env.EXPECTED_DATABASE_RELEASE_CHANNEL?.trim() ?? '';
  if (!databaseUrl || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) return false;
  const database = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [row] = await database<[{ marker: string | null }]>`
      select obj_description(namespace.oid, 'pg_namespace') as marker
      from pg_namespace as namespace
      where namespace.nspname = ${schema}
    `;
    return databaseReleaseMarkerMatches(row?.marker, channel, releaseId);
  } finally {
    await database.end({ timeout: 2 });
  }
}

async function main() {
  const result = await readyHealthStatus({
    ...process.env,
    NODE_ENV: 'production',
  });
  const releaseMarkerReady = await checkDatabaseReleaseMarker();
  console.log(
    JSON.stringify(
      {
        ...result,
        checks: {
          ...result.checks,
          releaseMarker: {
            status: releaseMarkerReady ? 'ok' : 'error',
            ...(releaseMarkerReady
              ? {}
              : { code: 'database_release_marker_mismatch' }),
          },
        },
      },
      null,
      2
    )
  );
  if (result.status !== 'ok' || !releaseMarkerReady) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: 'error',
      code: 'runtime_readiness_check_failed',
      errorName: error instanceof Error ? error.name : 'Error',
    })
  );
  process.exitCode = 1;
});
