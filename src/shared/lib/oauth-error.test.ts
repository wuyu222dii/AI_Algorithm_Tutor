import { describe, expect, it } from 'vitest';

import {
  getOAuthErrorMessageKey,
  getSafeOAuthErrorCallback,
  normalizeOAuthErrorCode,
} from './oauth-error';

describe('OAuth error handling', () => {
  it('keeps a localized error route and a safe internal callback', () => {
    expect(
      getSafeOAuthErrorCallback(
        '/en/auth-error?callbackUrl=%2Freview%3Ffilter%3Dwrong'
      )
    ).toBe('/en/auth-error?callbackUrl=%2Freview%3Ffilter%3Dwrong');
  });

  it('rejects external, protocol-relative and unrelated error routes', () => {
    const fallback = '/auth-error?callbackUrl=%2Flearn';
    expect(getSafeOAuthErrorCallback('https://evil.invalid/collect')).toBe(
      fallback
    );
    expect(getSafeOAuthErrorCallback('//evil.invalid/collect')).toBe(fallback);
    expect(getSafeOAuthErrorCallback('/admin?callbackUrl=%2Freview')).toBe(
      fallback
    );
    expect(
      getSafeOAuthErrorCallback(
        '/auth-error?callbackUrl=%2F%2Fevil.invalid%2Fcollect'
      )
    ).toBe(fallback);
  });

  it('maps provider errors without exposing provider descriptions', () => {
    expect(getOAuthErrorMessageKey('access_denied')).toBe('oauth_cancelled');
    expect(getOAuthErrorMessageKey('account_not_linked')).toBe(
      'oauth_account_conflict'
    );
    expect(getOAuthErrorMessageKey('invalid_code')).toBe(
      'oauth_provider_failed'
    );
    expect(getOAuthErrorMessageKey('state_not_found')).toBe(
      'oauth_restart_required'
    );
    expect(normalizeOAuthErrorCode('bad\r\nset-cookie: stolen')).toBe(
      'bad__set-cookie__stolen'
    );
  });
});
