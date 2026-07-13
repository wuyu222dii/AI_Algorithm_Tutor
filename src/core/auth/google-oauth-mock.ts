import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GoogleOAuthMockPayload {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string;
  exp: number;
  nonce?: string;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createGoogleOAuthMockToken(
  payload: GoogleOAuthMockPayload,
  secret: string
): string {
  const encoded = encode(payload);
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyGoogleOAuthMockToken(
  token: string,
  secret: string,
  nonce?: string
): GoogleOAuthMockPayload | null {
  const [encoded, suppliedSignature, ...rest] = token.split('.');
  if (!encoded || !suppliedSignature || rest.length) return null;
  const expected = Buffer.from(signature(encoded, secret), 'utf8');
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as GoogleOAuthMockPayload;
    if (
      !payload.sub ||
      !payload.email ||
      !payload.name ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000) ||
      (nonce && payload.nonce !== nonce)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function getGoogleOAuthMockOptions() {
  const enabled =
    process.env.NODE_ENV !== 'production' &&
    process.env.GOOGLE_OAUTH_MOCK_ENABLED === 'true';
  const secret = process.env.GOOGLE_OAUTH_MOCK_SECRET?.trim();
  if (!enabled) return {};
  if (!secret || secret.length < 32) {
    throw new Error(
      'GOOGLE_OAUTH_MOCK_SECRET must contain at least 32 characters'
    );
  }

  return {
    verifyIdToken: async (token: string, nonce?: string) =>
      Boolean(verifyGoogleOAuthMockToken(token, secret, nonce)),
    getUserInfo: async ({ idToken }: { idToken?: string }) => {
      if (!idToken) throw new Error('Mock Google ID token is missing');
      const payload = verifyGoogleOAuthMockToken(idToken, secret);
      if (!payload) throw new Error('Mock Google ID token is invalid');
      return {
        user: {
          id: payload.sub,
          email: payload.email,
          emailVerified: payload.emailVerified,
          name: payload.name,
          image: payload.image,
        },
        data: { sub: payload.sub, email_verified: payload.emailVerified },
      };
    },
  };
}
