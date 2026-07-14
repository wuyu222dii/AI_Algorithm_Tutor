import { enforceCoachRateLimits } from '@/features/algorithm-coach/rate-limit.server';
import { z } from 'zod';

import { md5 } from '@/shared/lib/hash';
import { recordOperationalEvent } from '@/shared/lib/observability';

export const dynamic = 'force-dynamic';

const anonymousFunnelEventSchema = z.object({
  id: z.string().min(8).max(160),
  name: z.enum([
    'visitor_started',
    'onboarding_started',
    'activated',
    'practice_started',
    'first_code_run',
    'first_problem_passed',
    'review_completed',
    'assessment_completed',
    'language_selected',
    'typescript_transpile_failed',
    'experiment_exposed',
  ]),
  timestamp: z.iso.datetime(),
  problemSlug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

function guestIdentity(request: Request): string | null {
  const value = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('algocoach_guest_id='))
    ?.slice('algocoach_guest_id='.length);
  return value && /^[A-Za-z0-9_-]{8,160}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  const limited = await enforceCoachRateLimits(request, 'state');
  if (limited) return limited;

  const guestId = guestIdentity(request);
  if (!guestId) {
    return Response.json(
      { error: { code: 'guest_identity_required' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'invalid_request' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
  const parsed = anonymousFunnelEventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'invalid_event' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
  const eventTime = Date.parse(parsed.data.timestamp);
  const now = Date.now();
  if (
    eventTime < now - 24 * 60 * 60 * 1000 ||
    eventTime > now + 5 * 60 * 1000
  ) {
    return Response.json(
      { error: { code: 'invalid_event_time' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  await recordOperationalEvent({
    event: 'anonymous_product_funnel',
    properties: {
      productEvent: parsed.data.name,
      guestSubject: md5(guestId),
      eventId: md5(parsed.data.id),
      ...(parsed.data.problemSlug
        ? { problemSlug: parsed.data.problemSlug }
        : {}),
    },
  });
  return new Response(null, {
    status: 202,
    headers: { 'cache-control': 'no-store' },
  });
}
