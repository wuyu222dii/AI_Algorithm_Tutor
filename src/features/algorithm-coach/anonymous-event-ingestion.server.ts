import 'server-only';

import { recordOperationalEvent } from '@/shared/lib/observability';

import type {
  AnonymousEventCheckpoint,
  AnonymousProductEvent,
} from './anonymous-events';
import {
  AnonymousCheckpointValidationError,
  AnonymousIdentityConfigurationError,
  deriveGuestSubject,
  persistAnonymousProductEvents,
  readGuestIdentity,
  validateAnonymousEventTimes,
} from './anonymous-events.server';

export async function ingestAnonymousProductEvents(
  request: Request,
  events: AnonymousProductEvent[],
  checkpoint?: AnonymousEventCheckpoint
): Promise<Response> {
  const guestIdentity = readGuestIdentity(request);
  if (!guestIdentity) {
    return Response.json(
      { error: { code: 'guest_identity_required' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
  if (!validateAnonymousEventTimes(events)) {
    return Response.json(
      { error: { code: 'invalid_event_time' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
  if (process.env.ANONYMOUS_METRICS_ENABLED !== 'true') {
    return Response.json(
      { data: { accepted: 0, duplicates: 0, disabled: true } },
      { status: 202, headers: { 'cache-control': 'no-store' } }
    );
  }

  try {
    const guestSubject = deriveGuestSubject(guestIdentity);
    const result = await persistAnonymousProductEvents(
      guestSubject,
      events,
      checkpoint
    );
    await recordOperationalEvent({
      event: 'anonymous_product_funnel_batch',
      properties: {
        accepted: result.accepted,
        duplicates: result.duplicates,
        eventCount: events.length,
      },
    });
    return Response.json(
      { data: result },
      { status: 202, headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof AnonymousCheckpointValidationError) {
      return Response.json(
        { error: { code: 'invalid_event_checkpoint' } },
        { status: 422, headers: { 'cache-control': 'no-store' } }
      );
    }
    if (error instanceof AnonymousIdentityConfigurationError) {
      return Response.json(
        { error: { code: 'anonymous_identity_unavailable' } },
        { status: 503, headers: { 'cache-control': 'no-store' } }
      );
    }
    const traceId = crypto.randomUUID();
    console.error(`[coach-anonymous-events:${traceId}] persistence failed`, {
      name: error instanceof Error ? error.name : 'Error',
    });
    return Response.json(
      { error: { code: 'event_persistence_failed', traceId } },
      { status: 500, headers: { 'cache-control': 'no-store' } }
    );
  }
}
