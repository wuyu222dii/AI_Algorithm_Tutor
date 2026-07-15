export type CatalogDatabaseAccessErrorCode =
  | 'identity_mismatch'
  | 'schema_usage_missing'
  | 'sync_role_missing'
  | 'candidate_write_missing'
  | 'published_catalog_write_present';

const ACCESS_ERROR_MESSAGES: Record<CatalogDatabaseAccessErrorCode, string> = {
  identity_mismatch:
    'The authenticated database role does not match the role encoded in the catalog URL, or the session changed roles.',
  schema_usage_missing:
    'The authenticated database role lacks USAGE on the catalog schema.',
  sync_role_missing:
    'The authenticated database role is not a member of algocoach_catalog_sync.',
  candidate_write_missing:
    'The authenticated database role requires INSERT and UPDATE on coach_problem_candidate.',
  published_catalog_write_present:
    'The catalog sync role has unsafe write access to coach_problem; use the restricted sync credential.',
};

export interface CatalogDatabaseAccessSnapshot {
  currentUser: string;
  sessionUser: string;
  schemaUsage: boolean;
  syncRoleMember: boolean;
  candidateInsert: boolean;
  candidateUpdate: boolean;
  publishedProblemInsert: boolean;
  publishedProblemUpdate: boolean;
  publishedProblemDelete: boolean;
}

export class CatalogDatabaseAccessError extends Error {
  readonly code: CatalogDatabaseAccessErrorCode;

  constructor(code: CatalogDatabaseAccessErrorCode) {
    super(ACCESS_ERROR_MESSAGES[code]);
    this.name = 'CatalogDatabaseAccessError';
    this.code = code;
  }
}

function configuredRoleMatches(
  configuredUsername: string,
  databaseRole: string
): boolean {
  return (
    configuredUsername === databaseRole ||
    configuredUsername.startsWith(`${databaseRole}.`)
  );
}

/** Verifies the result of a read-only PostgreSQL identity/ACL probe. */
export function validateCatalogDatabaseAccess(
  snapshot: CatalogDatabaseAccessSnapshot,
  configuredUsername: string
): void {
  if (
    snapshot.currentUser !== snapshot.sessionUser ||
    !configuredRoleMatches(configuredUsername, snapshot.currentUser)
  ) {
    throw new CatalogDatabaseAccessError('identity_mismatch');
  }
  if (!snapshot.schemaUsage) {
    throw new CatalogDatabaseAccessError('schema_usage_missing');
  }
  if (!snapshot.syncRoleMember) {
    throw new CatalogDatabaseAccessError('sync_role_missing');
  }
  if (!snapshot.candidateInsert || !snapshot.candidateUpdate) {
    throw new CatalogDatabaseAccessError('candidate_write_missing');
  }
  if (
    snapshot.publishedProblemInsert ||
    snapshot.publishedProblemUpdate ||
    snapshot.publishedProblemDelete
  ) {
    throw new CatalogDatabaseAccessError('published_catalog_write_present');
  }
}
