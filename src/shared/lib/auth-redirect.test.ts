import { describe, expect, it } from 'vitest';

import {
  getSafeInternalCallback,
  isSafeInternalCallback,
} from './auth-redirect';

describe('auth redirect validation', () => {
  it.each([
    '//evil.invalid/collect',
    '/\\evil.invalid/collect',
    '/learn\nset-cookie:session=stolen',
    '/learn%0d%0aset-cookie:session=stolen',
    `/${encodeURIComponent(
      encodeURIComponent(encodeURIComponent('//evil.invalid/collect'))
    )}`,
  ])('rejects unsafe callback %s', (callback) => {
    expect(isSafeInternalCallback(callback)).toBe(false);
    expect(getSafeInternalCallback(callback)).toBe('/');
  });

  it('keeps a normal internal path with query and hash', () => {
    const callback = '/practice/two-sum?tab=code#editor';
    expect(isSafeInternalCallback(callback)).toBe(true);
    expect(getSafeInternalCallback(callback)).toBe(callback);
  });

  it('uses the root fallback when the supplied fallback is also unsafe', () => {
    expect(
      getSafeInternalCallback('//evil.invalid', '//fallback.invalid')
    ).toBe('/');
  });
});
