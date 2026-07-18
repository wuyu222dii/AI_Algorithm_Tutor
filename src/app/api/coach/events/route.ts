import { ingestAnonymousProductEvents } from '@/features/algorithm-coach/anonymous-event-ingestion.server';
import { anonymousProductEventSchema } from '@/features/algorithm-coach/anonymous-events';
import { enforceCoachRateLimits } from '@/features/algorithm-coach/rate-limit.server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await enforceCoachRateLimits(request, 'state');
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'invalid_request' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
  const parsed = anonymousProductEventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'invalid_event' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
  return ingestAnonymousProductEvents(request, [parsed.data]);
}
