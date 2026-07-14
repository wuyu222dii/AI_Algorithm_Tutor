export type CatalogOperationalEventName =
  | 'catalog_sync_completed'
  | 'catalog_candidate_rejected'
  | 'catalog_revision_published'
  | 'catalog_revision_rolled_back';

export interface CatalogOperationalEventProperties {
  mode: 'database' | 'workspace';
  outcome:
    | 'succeeded'
    | 'failed'
    | 'rejected'
    | 'published'
    | 'already_published'
    | 'rolled_back';
  runId?: string;
  revision?: string;
  discovered?: number;
  notModified?: boolean;
  candidateId?: string;
  issueCodes?: string[];
  problemSlug?: string;
  revisionId?: string;
  releaseId?: string;
  fromVersion?: number;
  toVersion?: number;
  errorCode?: string;
}

export function emitCatalogOperationalEvent(
  event: CatalogOperationalEventName,
  properties: CatalogOperationalEventProperties
): void {
  const level =
    properties.outcome === 'failed' || properties.outcome === 'rejected'
      ? 'warn'
      : 'info';
  const safeProperties = {
    mode: properties.mode,
    outcome: properties.outcome,
    ...(properties.runId ? { runId: properties.runId } : {}),
    ...(properties.revision ? { revision: properties.revision } : {}),
    ...(properties.discovered !== undefined
      ? { discovered: properties.discovered }
      : {}),
    ...(properties.notModified !== undefined
      ? { notModified: properties.notModified }
      : {}),
    ...(properties.candidateId ? { candidateId: properties.candidateId } : {}),
    ...(properties.issueCodes ? { issueCodes: properties.issueCodes } : {}),
    ...(properties.problemSlug ? { problemSlug: properties.problemSlug } : {}),
    ...(properties.revisionId ? { revisionId: properties.revisionId } : {}),
    ...(properties.releaseId ? { releaseId: properties.releaseId } : {}),
    ...(properties.fromVersion !== undefined
      ? { fromVersion: properties.fromVersion }
      : {}),
    ...(properties.toVersion !== undefined
      ? { toVersion: properties.toVersion }
      : {}),
    ...(properties.errorCode ? { errorCode: properties.errorCode } : {}),
  };
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...safeProperties,
    })
  );
}
