import { describe, expect, it } from 'vitest';

import {
  getLocaleLessCallback,
  getOAuthErrorCallback,
} from './auth-form-utils';

describe('locale-aware auth callbacks', () => {
  it('rejects a protocol-relative path created after stripping the locale', () => {
    expect(getLocaleLessCallback('/zh//evil.invalid', 'zh')).toBe('/learn');
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

  it('builds a localized OAuth error callback from a safe internal path', () => {
    expect(getOAuthErrorCallback('/en/review?filter=wrong', 'en')).toBe(
      '/auth-error?callbackUrl=%2Freview%3Ffilter%3Dwrong'
    );
    expect(getOAuthErrorCallback('//evil.invalid/collect', 'zh')).toBe(
      '/zh/auth-error?callbackUrl=%2Flearn'
    );
  });
});
