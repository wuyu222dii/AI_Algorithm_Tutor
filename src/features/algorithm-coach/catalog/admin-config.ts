export type CatalogStructuredReviewMode = 'off' | 'shadow' | 'write';

export function catalogStructuredReviewMode(
  env: NodeJS.ProcessEnv = process.env
): CatalogStructuredReviewMode {
  const configured = env.CATALOG_STRUCTURED_REVIEW_MODE?.trim().toLowerCase();
  if (
    configured === 'off' ||
    configured === 'shadow' ||
    configured === 'write'
  ) {
    return configured;
  }
  return env.NODE_ENV === 'production' ? 'shadow' : 'write';
}

export function structuredCatalogWritesEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return catalogStructuredReviewMode(env) === 'write';
}
