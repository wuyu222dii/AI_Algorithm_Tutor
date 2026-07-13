import { describe, expect, it } from 'vitest';

import { AUTH_ACCOUNT_SECURITY } from './security';

describe('OAuth account security', () => {
  it('requires provider-verified email before automatic account linking', () => {
    expect(AUTH_ACCOUNT_SECURITY.accountLinking).toMatchObject({
      enabled: true,
      trustedProviders: [],
      allowDifferentEmails: false,
      updateUserInfoOnLink: false,
      allowUnlinkingAll: false,
    });
  });

  it('encrypts persisted OAuth tokens', () => {
    expect(AUTH_ACCOUNT_SECURITY.encryptOAuthTokens).toBe(true);
  });
});
