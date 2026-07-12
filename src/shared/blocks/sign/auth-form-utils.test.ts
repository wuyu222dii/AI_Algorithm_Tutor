import { describe, expect, it } from 'vitest';

import { getLocaleLessCallback } from './auth-form-utils';

describe('locale-aware auth callbacks', () => {
  it('rejects a protocol-relative path created after stripping the locale', () => {
    expect(getLocaleLessCallback('/zh//evil.invalid', 'zh')).toBe('/');
  });

  it('strips the active locale from a normal internal callback', () => {
    expect(getLocaleLessCallback('/zh/practice/two-sum?tab=code', 'zh')).toBe(
      '/practice/two-sum?tab=code'
    );
  });

  it('preserves a normal locale-less internal callback', () => {
    expect(getLocaleLessCallback('/review?filter=wrong', 'zh')).toBe(
      '/review?filter=wrong'
    );
  });
});
