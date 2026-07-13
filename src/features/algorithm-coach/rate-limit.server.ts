import 'server-only';

import { getAuth } from '@/core/auth';
import { md5 } from '@/shared/lib/hash';
import { enforceDistributedWindowRateLimit } from '@/shared/lib/rate-limit';

type CoachRateLimitSurface = 'artifact' | 'chat' | 'state';

async function requestIdentity(request: Request) {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user?.id) {
      return { key: `user:${md5(session.user.id)}`, authenticated: true };
    }
  } catch {
    // Missing auth/database configuration keeps local demo traffic as a guest.
  }
  const cookie = request.headers.get('cookie') || 'no-cookie';
  return { key: `guest:${md5(cookie)}`, authenticated: false };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function enforceCoachRateLimits(
  request: Request,
  surface: CoachRateLimitSurface,
  authenticatedUserId?: string
): Promise<Response | null> {
  const identity = authenticatedUserId
    ? { key: `user:${md5(authenticatedUserId)}`, authenticated: true }
    : await requestIdentity(request);
  const failClosed = process.env.NODE_ENV === 'production';
  const burstMax = positiveInteger(
    process.env.COACH_RATE_LIMIT_PER_MINUTE,
    surface === 'chat' ? 12 : surface === 'state' ? 120 : 20
  );
  const burst = await enforceDistributedWindowRateLimit(request, {
    windowMs: 60_000,
    max: burstMax,
    keyPrefix: `coach-${surface}-burst`,
    extraKey: identity.key,
    identity: 'source-and-extra',
    failClosed,
  });
  if (burst) return burst;

  if (surface === 'state') return null;
  const concurrencyApproximation = await enforceDistributedWindowRateLimit(
    request,
    {
      windowMs: 10_000,
      max: positiveInteger(
        process.env.COACH_RATE_LIMIT_PER_10_SECONDS,
        surface === 'chat' ? 3 : 5
      ),
      keyPrefix: `coach-${surface}-concurrency`,
      extraKey: identity.key,
      identity: 'extra',
      failClosed,
    }
  );
  if (concurrencyApproximation) return concurrencyApproximation;

  return enforceDistributedWindowRateLimit(request, {
    windowMs: 24 * 60 * 60 * 1000,
    max: positiveInteger(
      identity.authenticated
        ? process.env.COACH_AUTHENTICATED_DAILY_REQUESTS
        : process.env.COACH_GUEST_DAILY_REQUESTS,
      identity.authenticated ? 200 : 40
    ),
    keyPrefix: `coach-${surface}-daily`,
    extraKey: identity.key,
    identity: 'extra',
    failClosed,
  });
}
