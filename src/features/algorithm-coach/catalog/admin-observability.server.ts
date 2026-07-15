import { recordOperationalEvent } from '@/shared/lib/observability';

export type CatalogAdminOperation =
  | 'candidate_action'
  | 'candidate_detail'
  | 'candidate_list'
  | 'candidate_preview'
  | 'candidate_update'
  | 'canonical_cases'
  | 'canonical_preview'
  | 'rollback';

function failureType(error: unknown): string {
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof RangeError) return 'RangeError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  if (error instanceof Error) return 'Error';
  return 'NonError';
}

/** Logs a useful failure category without persisting driver messages or SQL. */
export async function recordCatalogAdminFailure(
  operation: CatalogAdminOperation,
  traceId: string,
  error: unknown
) {
  await recordOperationalEvent({
    event: 'catalog_admin_failed',
    level: 'error',
    traceId,
    properties: {
      operation,
      failureType: failureType(error),
    },
  });
}
