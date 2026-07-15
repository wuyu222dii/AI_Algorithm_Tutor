type MigrationEnvironment = Readonly<Record<string, string | undefined>>;

export function automaticMigrationsEnabled(
  env: MigrationEnvironment = process.env
): boolean {
  const value = env.DB_AUTO_MIGRATE?.trim().toLowerCase();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;

  throw new Error('DB_AUTO_MIGRATE must be either true or false');
}

export function resolveMigrationDatabaseUrl(options?: {
  databaseUrl?: string;
  env?: MigrationEnvironment;
}): string {
  const databaseUrl =
    options?.databaseUrl?.trim() ||
    (options?.env ?? process.env).MIGRATION_DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      'MIGRATION_DATABASE_URL is required for database migrations; DATABASE_URL is runtime-only'
    );
  }

  return databaseUrl;
}
