#!/usr/bin/env node
import postgres from 'postgres';

import { createDatabaseReleaseMarker } from '../src/core/db/release-marker';

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function main() {
  const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  const schema = (process.env.DB_SCHEMA ?? 'algocoach').trim();
  const releaseId = process.env.DATABASE_RELEASE_ID?.trim() ?? '';
  const channel = process.env.DATABASE_RELEASE_CHANNEL?.trim() ?? '';
  if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL is required');
  if (!identifierPattern.test(schema)) throw new Error('DB_SCHEMA is invalid');
  const marker = createDatabaseReleaseMarker(channel, releaseId);
  const database = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await database.unsafe(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`);
    const [row] = await database<[{ marker: string | null }]>`
      select obj_description(namespace.oid, 'pg_namespace') as marker
      from pg_namespace as namespace
      where namespace.nspname = ${schema}
    `;
    if (row?.marker !== marker)
      throw new Error('Database release marker mismatch');
    console.log(JSON.stringify({ status: 'ok', schema, channel, releaseId }));
  } finally {
    await database.end({ timeout: 2 });
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: 'error',
      code: 'database_release_marker_failed',
      errorName: error instanceof Error ? error.name : 'Error',
    })
  );
  process.exitCode = 1;
});
