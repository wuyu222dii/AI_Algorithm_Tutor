import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { dbPostgres } from '@/core/db';
import { coachAnonymousProductEvent } from '@/config/db/schema.postgres';

import type {
  AnonymousEventCheckpoint,
  AnonymousProductEvent,
} from './anonymous-events';

const GUEST_COOKIE_NAME = 'algocoach_guest_id';
const MAX_ANONYMOUS_EVENT_BACKLOG = 1_000;

export class AnonymousIdentityConfigurationError extends Error {
  constructor() {
    super('AUTH_SECRET is required for anonymous identity protection.');
    this.name = 'AnonymousIdentityConfigurationError';
  }
}

export class AnonymousCheckpointValidationError extends Error {
  constructor() {
    super('The anonymous event checkpoint is not monotonic.');
    this.name = 'AnonymousCheckpointValidationError';
  }
}

export function isValidAnonymousEventCheckpoint(
  previous: AnonymousEventCheckpoint | null,
  next: AnonymousEventCheckpoint,
  batchSize: number
): boolean {
  const baseline = previous ?? {
    sequence: 0,
    generatedTotal: 0,
    deliveredTotal: 0,
  };
  if (next.sequence === baseline.sequence) {
    return (
      next.generatedTotal === baseline.generatedTotal &&
      next.deliveredTotal === baseline.deliveredTotal
    );
  }
  if (next.sequence !== baseline.sequence + 1) return false;
  const generatedDelta = next.generatedTotal - baseline.generatedTotal;
  const deliveredDelta = next.deliveredTotal - baseline.deliveredTotal;
  return (
    generatedDelta >= 0 &&
    generatedDelta <= MAX_ANONYMOUS_EVENT_BACKLOG &&
    deliveredDelta >= 0 &&
    deliveredDelta <= batchSize &&
    next.generatedTotal - next.deliveredTotal >= 0 &&
    next.generatedTotal - next.deliveredTotal <= MAX_ANONYMOUS_EVENT_BACKLOG
  );
}

export function readGuestIdentity(request: Request): string | null {
  const value = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GUEST_COOKIE_NAME}=`))
    ?.slice(GUEST_COOKIE_NAME.length + 1);
  return value && /^[A-Za-z0-9_-]{8,160}$/.test(value) ? value : null;
}

export function deriveGuestSubject(guestIdentity: string): string {
  const secret =
    process.env.ANONYMOUS_METRICS_HMAC_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new AnonymousIdentityConfigurationError();
  }
  return createHmac('sha256', secret)
    .update(`algocoach:guest-subject:v1\u0000${guestIdentity}`)
    .digest('hex');
}

function anonymousEventId(guestSubject: string, eventId: string): string {
  return `anonymous_${createHash('sha256')
    .update(`${guestSubject}\u0000${eventId}`)
    .digest('hex')}`;
}

export function validateAnonymousEventTimes(
  events: AnonymousProductEvent[],
  now = Date.now()
): boolean {
  return events.every((event) => {
    const eventTime = Date.parse(event.timestamp);
    return (
      Number.isFinite(eventTime) &&
      eventTime >= now - 8 * 24 * 60 * 60 * 1000 &&
      eventTime <= now + 5 * 60 * 1000
    );
  });
}

export async function persistAnonymousProductEvents(
  guestSubject: string,
  events: AnonymousProductEvent[],
  checkpoint?: AnonymousEventCheckpoint
): Promise<{ accepted: number; duplicates: number }> {
  const uniqueEvents = Array.from(
    new Map(events.map((event) => [event.id, event])).values()
  );
  if (!uniqueEvents.length) return { accepted: 0, duplicates: 0 };

  const normalizedCheckpoint = checkpoint ?? {
    sequence: 0,
    generatedTotal: 0,
    deliveredTotal: 0,
  };
  const database = dbPostgres();
  const inserted = await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${guestSubject}))`
    );
    if (checkpoint) {
      const [last] = await transaction
        .select({
          sequence: coachAnonymousProductEvent.clientSequence,
          generatedTotal: coachAnonymousProductEvent.clientGeneratedTotal,
          deliveredTotal: coachAnonymousProductEvent.clientDeliveredTotal,
        })
        .from(coachAnonymousProductEvent)
        .where(eq(coachAnonymousProductEvent.guestSubject, guestSubject))
        .orderBy(desc(coachAnonymousProductEvent.clientSequence))
        .limit(1);
      if (
        !isValidAnonymousEventCheckpoint(
          last ?? null,
          checkpoint,
          events.length
        )
      ) {
        throw new AnonymousCheckpointValidationError();
      }
    }

    const rows = await transaction
      .insert(coachAnonymousProductEvent)
      .values(
        uniqueEvents.map((event) => ({
          id: anonymousEventId(guestSubject, event.id),
          guestSubject,
          eventId: event.id,
          name: event.name,
          problemSlugSnapshot: event.problemSlug ?? null,
          clientSequence: normalizedCheckpoint.sequence,
          clientGeneratedTotal: normalizedCheckpoint.generatedTotal,
          clientDeliveredTotal: normalizedCheckpoint.deliveredTotal,
          occurredAt: new Date(event.timestamp),
        }))
      )
      .onConflictDoNothing({
        target: [
          coachAnonymousProductEvent.guestSubject,
          coachAnonymousProductEvent.eventId,
        ],
      })
      .returning({ id: coachAnonymousProductEvent.id });

    await transaction
      .update(coachAnonymousProductEvent)
      .set({
        clientSequence: sql`greatest(${coachAnonymousProductEvent.clientSequence}, ${normalizedCheckpoint.sequence})`,
        clientGeneratedTotal: sql`greatest(${coachAnonymousProductEvent.clientGeneratedTotal}, ${normalizedCheckpoint.generatedTotal})`,
        clientDeliveredTotal: sql`greatest(${coachAnonymousProductEvent.clientDeliveredTotal}, ${normalizedCheckpoint.deliveredTotal})`,
      })
      .where(
        and(
          eq(coachAnonymousProductEvent.guestSubject, guestSubject),
          inArray(
            coachAnonymousProductEvent.eventId,
            uniqueEvents.map((event) => event.id)
          )
        )
      );
    return rows;
  });

  return {
    accepted: inserted.length,
    duplicates: events.length - inserted.length,
  };
}
