import { describe, expect, it } from 'vitest';

import {
  catalogStructuredReviewMode,
  structuredCatalogWritesEnabled,
} from './admin-config';

describe('structured catalog review mode', () => {
  it('defaults production to shadow and development to write', () => {
    expect(catalogStructuredReviewMode({ NODE_ENV: 'production' })).toBe(
      'shadow'
    );
    expect(catalogStructuredReviewMode({ NODE_ENV: 'development' })).toBe(
      'write'
    );
  });

  it('accepts only the three supported modes', () => {
    expect(
      structuredCatalogWritesEnabled({
        NODE_ENV: 'production',
        CATALOG_STRUCTURED_REVIEW_MODE: 'write',
      })
    ).toBe(true);
    expect(
      catalogStructuredReviewMode({
        NODE_ENV: 'production',
        CATALOG_STRUCTURED_REVIEW_MODE: 'invalid',
      })
    ).toBe('shadow');
  });
});
