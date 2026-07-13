import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/core/auth';
import { isCloudflareWorker } from '@/shared/lib/env';
import { md5 } from '@/shared/lib/hash';
import {
  getSafeOAuthErrorCallback,
  normalizeOAuthErrorCode,
} from '@/shared/lib/oauth-error';
import { recordOperationalEvent } from '@/shared/lib/observability';
import { enforceDistributedWindowRateLimit } from '@/shared/lib/rate-limit';
import type {
  AuthProviderEvent,
  AuthProviderEventName,
} from '@/shared/types/observability';

const GOOGLE_OAUTH_ERROR_COOKIE = 'algocoach_google_oauth_error';
const GOOGLE_OAUTH_ERROR_COOKIE_MAX_AGE = 10 * 60;

function recordGoogleOAuthEvent(
  request: Request,
  event: AuthProviderEventName,
  outcome: AuthProviderEvent['outcome'],
  reason?: string
) {
  const requestId = request.headers.get('x-request-id');
  const traceId = requestId
    ? requestId.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128)
    : crypto.randomUUID();

  // Console logging happens synchronously. Optional external exporters are
  // best effort and must not delay authentication responses.
  void recordOperationalEvent({
    event,
    traceId,
    level: outcome === 'failed' ? 'warn' : 'info',
    properties: {
      provider: 'google',
      outcome,
      ...(reason ? { reason: normalizeOAuthErrorCode(reason) } : {}),
    },
  });
}

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
    suffixes: ['/sign-in/social'],
    windowEnvName: 'AUTH_SOCIAL_SIGN_IN_RATE_WINDOW_MS',
    maxEnvName: 'AUTH_SOCIAL_SIGN_IN_RATE_MAX',
    defaultWindowMs: 60_000,
    defaultMax: 20,
    keyPrefix: 'auth-social-sign-in',
  },
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

function isGoogleOAuthCallback(url: URL) {
  return url.pathname.endsWith('/api/auth/callback/google');
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get('cookie') || '';
  const rawValue = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);

  if (!rawValue) return null;
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return null;
  }
}

function withGoogleOAuthErrorCookie(
  response: Response,
  request: Request,
  callback: string | null
) {
  const headers = new Headers(response.headers);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const value = callback ? encodeURIComponent(callback) : '';
  const maxAge = callback ? GOOGLE_OAUTH_ERROR_COOKIE_MAX_AGE : 0;
  headers.append(
    'set-cookie',
    `${GOOGLE_OAUTH_ERROR_COOKIE}=${value}; Path=/api/auth/callback/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function redirectToOAuthError(
  request: Request,
  callback: string,
  error: unknown
) {
  const target = new URL(getSafeOAuthErrorCallback(callback), request.url);
  target.searchParams.set('error', normalizeOAuthErrorCode(error));
  const response = Response.redirect(target, 302);
  return withGoogleOAuthErrorCookie(withNoStore(response), request, null);
}

async function getGoogleOAuthErrorCallback(request: Request) {
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/api/auth/sign-in/social')) return null;

  const body = await request
    .clone()
    .json()
    .catch(() => null);
  if (!body || body.provider !== 'google') return null;

  return getSafeOAuthErrorCallback(body.errorCallbackURL);
}

async function maybeRateLimitGetSession(
  request: Request
): Promise<Response | null> {
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

  return enforceDistributedWindowRateLimit(request, {
    windowMs,
    max,
    keyPrefix: 'auth-get-session',
    extraKey: md5(cookie),
    identity: 'source-and-extra',
    failClosed: false,
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
  const sourceLimited = await enforceDistributedWindowRateLimit(request, {
    windowMs,
    max: max * 3,
    keyPrefix: `${rule.keyPrefix}-source`,
    identity: 'source',
    failClosed: process.env.NODE_ENV === 'production',
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
  const provider =
    body && typeof body.provider === 'string'
      ? body.provider.trim().toLowerCase()
      : '';
  const cookie = request.headers.get('cookie') || 'anonymous';

  return enforceDistributedWindowRateLimit(request, {
    windowMs,
    max,
    keyPrefix: `${rule.keyPrefix}-account`,
    extraKey: email
      ? md5(email)
      : md5(`${cookie}|${provider || 'no-provider'}`),
    identity: 'extra',
    failClosed: process.env.NODE_ENV === 'production',
  });
}

export async function POST(request: Request) {
  const limited =
    (await maybeRateLimitGetSession(request)) ||
    (await maybeRateLimitAuthMutation(request));
  if (limited) {
    return withNoStore(limited);
  }

  const googleOAuthErrorCallback = await getGoogleOAuthErrorCallback(request);
  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  const response = withNoStore(await handler.POST(request));

  if (googleOAuthErrorCallback) {
    recordGoogleOAuthEvent(
      request,
      response.ok ? 'auth_provider_started' : 'auth_provider_failed',
      response.ok ? 'started' : 'failed',
      response.ok ? undefined : `start_http_${response.status}`
    );
  }

  return googleOAuthErrorCallback
    ? withGoogleOAuthErrorCookie(response, request, googleOAuthErrorCallback)
    : response;
}

export async function GET(request: Request) {
  const limited = await maybeRateLimitGetSession(request);
  if (limited) {
    return withNoStore(limited);
  }

  const requestUrl = new URL(request.url);
  const isGoogleCallback = isGoogleOAuthCallback(requestUrl);
  const savedErrorCallback = isGoogleCallback
    ? readCookie(request, GOOGLE_OAUTH_ERROR_COOKIE)
    : null;

  // Better Auth handles an upstream `error` before parsing OAuth state, so its
  // normal errorCallbackURL is unavailable for user-cancelled Google consent.
  if (savedErrorCallback && requestUrl.searchParams.has('error')) {
    recordGoogleOAuthEvent(
      request,
      'auth_provider_failed',
      'failed',
      requestUrl.searchParams.get('error') || undefined
    );
    return redirectToOAuthError(
      request,
      savedErrorCallback,
      requestUrl.searchParams.get('error')
    );
  }

  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  let response = withNoStore(await handler.GET(request));

  if (isGoogleCallback && savedErrorCallback) {
    const location = response.headers.get('location');
    if (location) {
      const target = new URL(location, request.url);
      if (target.pathname.endsWith('/auth-error')) {
        recordGoogleOAuthEvent(
          request,
          'auth_provider_failed',
          'failed',
          target.searchParams.get('error') || undefined
        );
        response = redirectToOAuthError(
          request,
          savedErrorCallback,
          target.searchParams.get('error')
        );
        return response;
      }
    }
    response = withGoogleOAuthErrorCookie(response, request, null);
  }

  if (isGoogleCallback) {
    const location = response.headers.get('location');
    const target = location ? new URL(location, request.url) : null;
    const failed =
      response.status >= 400 || target?.pathname.endsWith('/auth-error');
    recordGoogleOAuthEvent(
      request,
      failed ? 'auth_provider_failed' : 'auth_provider_succeeded',
      failed ? 'failed' : 'succeeded',
      failed
        ? target?.searchParams.get('error') ||
            `callback_http_${response.status}`
        : undefined
    );
  }

  return response;
}
