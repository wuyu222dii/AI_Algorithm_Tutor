import {
  AnonymousIdentityConfigurationError,
  deriveGuestSubject,
  readGuestIdentity,
} from '@/features/algorithm-coach/anonymous-events.server';
import type { GuestClaimEnvelopeV2 } from '@/features/algorithm-coach/guest-claim';
import {
  CoachHttpError,
  errorResponse,
  readJsonBody,
} from '@/features/algorithm-coach/http';
import { coachSyncRequestSchema } from '@/features/algorithm-coach/persistence-schema';
import {
  claimGuestCoachDataOnServer,
  CoachGuestAlreadyClaimed,
} from '@/features/algorithm-coach/persistence.server';
import { enforceCoachRateLimits } from '@/features/algorithm-coach/rate-limit.server';
import { z } from 'zod';

import { getAuth } from '@/core/auth';

export const dynamic = 'force-dynamic';

const envelopeSchema = z
  .object({
    version: z.literal(2),
    claimId: z.string().min(8).max(160),
    targetUserId: z.string().min(1).max(160),
    snapshot: z.unknown(),
    status: z.literal('pending'),
    createdAt: z.iso.datetime(),
  })
  .strict();

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    if (process.env.DURABLE_GUEST_CLAIM_ENABLED !== 'true') {
      throw new CoachHttpError(
        404,
        'guest_claim_disabled',
        'Durable guest claims are disabled.'
      );
    }
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    if (!userId) {
      throw new CoachHttpError(
        401,
        'unauthorized',
        'Authentication is required.'
      );
    }
    const limited = await enforceCoachRateLimits(request, 'state', userId);
    if (limited) return limited;

    const guestIdentity = readGuestIdentity(request);
    if (!guestIdentity) {
      throw new CoachHttpError(
        400,
        'guest_identity_required',
        'Guest identity is required.'
      );
    }
    const body = await readJsonBody(request, 1_500_000);
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw new CoachHttpError(
        400,
        'invalid_guest_claim',
        'Guest claim validation failed.',
        envelope.error.flatten()
      );
    }
    if (envelope.data.targetUserId !== userId) {
      throw new CoachHttpError(
        403,
        'guest_claim_target_mismatch',
        'Guest claim target does not match the authenticated account.'
      );
    }
    const snapshot = coachSyncRequestSchema.safeParse({
      revision: 0,
      ...(envelope.data.snapshot as object),
    });
    if (!snapshot.success) {
      throw new CoachHttpError(
        400,
        'invalid_guest_snapshot',
        'Guest snapshot validation failed.',
        snapshot.error.flatten()
      );
    }
    const result = await claimGuestCoachDataOnServer(
      userId,
      deriveGuestSubject(guestIdentity),
      {
        ...envelope.data,
        snapshot: {
          state: snapshot.data.state,
          importedProblem: snapshot.data.importedProblem,
          importedDrafts: snapshot.data.importedDrafts ?? [],
          reviewProgress: snapshot.data.reviewProgress,
        },
      } as GuestClaimEnvelopeV2
    );
    return Response.json(
      { data: result },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof CoachGuestAlreadyClaimed) {
      return errorResponse(
        new CoachHttpError(409, 'guest_already_claimed', error.message),
        traceId
      );
    }
    if (error instanceof AnonymousIdentityConfigurationError) {
      return errorResponse(
        new CoachHttpError(
          503,
          'guest_identity_unavailable',
          'Guest identity protection is not configured.'
        ),
        traceId
      );
    }
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    console.error(`[coach-guest-claim:${traceId}] claim failed`, {
      name: error instanceof Error ? error.name : 'Error',
    });
    return errorResponse(
      new CoachHttpError(
        500,
        'guest_claim_failed',
        'Guest learning data could not be claimed.'
      ),
      traceId
    );
  }
}
