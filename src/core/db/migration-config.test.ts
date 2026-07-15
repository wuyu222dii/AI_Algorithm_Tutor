import { describe, expect, it } from 'vitest';

import {
  automaticMigrationsEnabled,
  resolveMigrationDatabaseUrl,
} from './migration-config';

describe('migration database configuration', () => {
  it('keeps automatic migrations opt-in', () => {
    expect(automaticMigrationsEnabled({})).toBe(false);
    expect(automaticMigrationsEnabled({ DB_AUTO_MIGRATE: 'false' })).toBe(
      false
    );
    expect(automaticMigrationsEnabled({ DB_AUTO_MIGRATE: ' true ' })).toBe(
      true
    );
  });

  it('rejects ambiguous automatic migration settings', () => {
    expect(() =>
      automaticMigrationsEnabled({ DB_AUTO_MIGRATE: 'yes' })
    ).toThrow('DB_AUTO_MIGRATE must be either true or false');
  });

  it('uses only the explicit migration URL or MIGRATION_DATABASE_URL', () => {
    expect(
      resolveMigrationDatabaseUrl({
        databaseUrl: ' postgresql://migrator@localhost/algocoach ',
        env: {
          MIGRATION_DATABASE_URL:
            'postgresql://other-migrator@localhost/algocoach',
        },
      })
    ).toBe('postgresql://migrator@localhost/algocoach');
    expect(
      resolveMigrationDatabaseUrl({
        env: {
          MIGRATION_DATABASE_URL: ' postgresql://migrator@localhost/algocoach ',
        },
      })
    ).toBe('postgresql://migrator@localhost/algocoach');
  });

  it('fails closed when the dedicated migration URL is absent', () => {
    expect(() => resolveMigrationDatabaseUrl({ env: {} })).toThrow(
      'MIGRATION_DATABASE_URL is required for database migrations; DATABASE_URL is runtime-only'
    );
  });
});
