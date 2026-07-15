import { describe, expect, it } from 'vitest';

import {
  CatalogDatabaseAccessError,
  validateCatalogDatabaseAccess,
  type CatalogDatabaseAccessErrorCode,
  type CatalogDatabaseAccessSnapshot,
} from './catalog-database-access';

const VALID_ACCESS: CatalogDatabaseAccessSnapshot = {
  currentUser: 'algocoach_catalog_worker',
  sessionUser: 'algocoach_catalog_worker',
  schemaUsage: true,
  syncRoleMember: true,
  candidateInsert: true,
  candidateUpdate: true,
  publishedProblemInsert: false,
  publishedProblemUpdate: false,
  publishedProblemDelete: false,
};

function accessErrorCode(
  overrides: Partial<CatalogDatabaseAccessSnapshot>,
  configuredUsername = 'algocoach_catalog_worker.project-ref'
): CatalogDatabaseAccessErrorCode {
  try {
    validateCatalogDatabaseAccess(
      { ...VALID_ACCESS, ...overrides },
      configuredUsername
    );
    throw new Error('Expected access validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogDatabaseAccessError);
    return (error as CatalogDatabaseAccessError).code;
  }
}

describe('catalog database access validation', () => {
  it('accepts a direct or Supabase pooler username for the restricted role', () => {
    expect(() =>
      validateCatalogDatabaseAccess(VALID_ACCESS, 'algocoach_catalog_worker')
    ).not.toThrow();
    expect(() =>
      validateCatalogDatabaseAccess(
        VALID_ACCESS,
        'algocoach_catalog_worker.project-ref'
      )
    ).not.toThrow();
  });

  it.each<
    [
      Partial<CatalogDatabaseAccessSnapshot>,
      CatalogDatabaseAccessErrorCode,
      string?,
    ]
  >([
    [{ sessionUser: 'pooler' }, 'identity_mismatch'],
    [{ currentUser: 'postgres', sessionUser: 'postgres' }, 'identity_mismatch'],
    [{ schemaUsage: false }, 'schema_usage_missing'],
    [{ syncRoleMember: false }, 'sync_role_missing'],
    [{ candidateInsert: false }, 'candidate_write_missing'],
    [{ candidateUpdate: false }, 'candidate_write_missing'],
    [{ publishedProblemInsert: true }, 'published_catalog_write_present'],
    [{ publishedProblemUpdate: true }, 'published_catalog_write_present'],
    [{ publishedProblemDelete: true }, 'published_catalog_write_present'],
  ])(
    'rejects an unsafe identity or ACL snapshot',
    (overrides, code, username) => {
      expect(accessErrorCode(overrides, username)).toBe(code);
    }
  );
});
