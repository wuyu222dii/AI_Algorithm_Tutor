import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createGoogleOAuthMockToken,
  getGoogleOAuthMockOptions,
  verifyGoogleOAuthMockToken,
} from './google-oauth-mock';

const secret = 'google-oauth-mock-test-secret-32-characters';
const payload = {
  sub: 'google-user-1',
  email: 'learner@example.test',
  emailVerified: true,
  name: 'Learner',
  exp: Math.floor(Date.now() / 1000) + 300,
  nonce: 'nonce-1',
};

afterEach(() => vi.unstubAllEnvs());

describe('Google OAuth E2E mock', () => {
  it('accepts only valid, unexpired, nonce-matched tokens', () => {
    const token = createGoogleOAuthMockToken(payload, secret);
    expect(verifyGoogleOAuthMockToken(token, secret, 'nonce-1')).toMatchObject(
      payload
    );
    expect(verifyGoogleOAuthMockToken(token, secret, 'wrong')).toBeNull();
    expect(verifyGoogleOAuthMockToken(`${token}x`, secret)).toBeNull();
  });

  it('cannot be enabled in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GOOGLE_OAUTH_MOCK_ENABLED', 'true');
    vi.stubEnv('GOOGLE_OAUTH_MOCK_SECRET', secret);
    expect(getGoogleOAuthMockOptions()).toEqual({});
  });
});
