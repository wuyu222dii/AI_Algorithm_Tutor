import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/core/auth';
import { isCloudflareWorker } from '@/shared/lib/env';
import { md5 } from '@/shared/lib/hash';
import { enforceWindowRateLimit } from '@/shared/lib/rate-limit';

type AuthMutationRateRule = {
  suffixes: string[];
  windowEnvName: string;
  maxEnvName: string;
  defaultWindowMs: number;
  defaultMax: number;
  keyPrefix: string;
};

const AUTH_MUTATION_RATE_RULES: AuthMutationRateRule[] = [
  {
    suffixes: ['/sign-in/email'],
    windowEnvName: 'AUTH_SIGN_IN_RATE_WINDOW_MS',
    maxEnvName: 'AUTH_SIGN_IN_RATE_MAX',
    defaultWindowMs: 60_000,
    defaultMax: 10,
    keyPrefix: 'auth-sign-in',
  },
  {
    suffixes: ['/sign-up/email'],
    windowEnvName: 'AUTH_SIGN_UP_RATE_WINDOW_MS',
    maxEnvName: 'AUTH_SIGN_UP_RATE_MAX',
    defaultWindowMs: 10 * 60_000,
    defaultMax: 3,
    keyPrefix: 'auth-sign-up',
  },
  {
    suffixes: ['/request-password-reset', '/forget-password'],
    windowEnvName: 'AUTH_PASSWORD_RESET_RATE_WINDOW_MS',
    maxEnvName: 'AUTH_PASSWORD_RESET_RATE_MAX',
    defaultWindowMs: 10 * 60_000,
    defaultMax: 3,
    keyPrefix: 'auth-password-reset',
  },
  {
    suffixes: ['/send-verification-email'],
    windowEnvName: 'AUTH_VERIFICATION_EMAIL_RATE_WINDOW_MS',
    maxEnvName: 'AUTH_VERIFICATION_EMAIL_RATE_MAX',
    defaultWindowMs: 10 * 60_000,
    defaultMax: 3,
    keyPrefix: 'auth-verification-email',
  },
];

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function maybeRateLimitGetSession(request: Request): Response | null {
  const url = new URL(request.url);
  // better-auth session endpoint is served under this catch-all route.
  if (isCloudflareWorker || !url.pathname.endsWith('/api/auth/get-session')) {
    return null;
  }

  const configuredWindow = Number(process.env.AUTH_GET_SESSION_RATE_WINDOW_MS);
  const windowMs =
    Number.isFinite(configuredWindow) && configuredWindow >= 1_000
      ? configuredWindow
      : 60_000;
  const configuredMax = Number(process.env.AUTH_GET_SESSION_RATE_MAX);
  const max =
    Number.isFinite(configuredMax) && configuredMax >= 1
      ? Math.floor(configuredMax)
      : 120;
  const cookie = request.headers.get('cookie') || 'anonymous';

  return enforceWindowRateLimit(request, {
    windowMs,
    max,
    keyPrefix: 'auth-get-session',
    extraKey: md5(cookie),
    identity: 'source-and-extra',
  });
}

async function maybeRateLimitAuthMutation(
  request: Request
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const rule = AUTH_MUTATION_RATE_RULES.find(({ suffixes }) =>
    suffixes.some((suffix) => pathname.endsWith(suffix))
  );
  if (!rule) return null;

  const configuredWindow = Number(process.env[rule.windowEnvName]);
  const windowMs =
    Number.isFinite(configuredWindow) && configuredWindow >= 1_000
      ? configuredWindow
      : rule.defaultWindowMs;
  const configuredMax = Number(process.env[rule.maxEnvName]);
  const max =
    Number.isFinite(configuredMax) && configuredMax >= 1
      ? Math.floor(configuredMax)
      : rule.defaultMax;

  // Source and account limits are independent: rotating cookies cannot reset
  // either rule, while users can still immediately correct a mistyped password.
  const sourceLimited = enforceWindowRateLimit(request, {
    windowMs,
    max: max * 3,
    keyPrefix: `${rule.keyPrefix}-source`,
    identity: 'source',
  });
  if (sourceLimited) return sourceLimited;

  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const email =
    body && typeof body.email === 'string'
      ? body.email.trim().toLowerCase()
      : '';

  return enforceWindowRateLimit(request, {
    windowMs,
    max,
    keyPrefix: `${rule.keyPrefix}-account`,
    extraKey: email ? md5(email) : 'no-email',
    identity: 'extra',
  });
}

export async function POST(request: Request) {
  const limited =
    maybeRateLimitGetSession(request) ||
    (await maybeRateLimitAuthMutation(request));
  if (limited) {
    return withNoStore(limited);
  }

  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  return withNoStore(await handler.POST(request));
}

export async function GET(request: Request) {
  const limited = maybeRateLimitGetSession(request);
  if (limited) {
    return withNoStore(limited);
  }

  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  return withNoStore(await handler.GET(request));
}
