import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

let client: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle> | undefined;

export function catalogAdminDatabase(): ReturnType<typeof drizzle> {
  if (database) return database;
  const url = process.env.CATALOG_ADMIN_DATABASE_URL?.trim();
  if (!url) {
    throw new Error('CATALOG_ADMIN_DATABASE_URL is not configured.');
  }
  client = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { options: '-c search_path=algocoach' },
  });
  database = drizzle({ client });
  return database;
}

export async function closeCatalogAdminDatabase(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  client = undefined;
  database = undefined;
}
