import {
  CoachHttpError,
  errorResponse,
  readJsonBody,
} from '@/features/algorithm-coach/http';
import {
  coachMutationSyncRequestSchema,
  coachSyncRequestSchema,
} from '@/features/algorithm-coach/persistence-schema';
import {
  applyCoachDataMutations,
  CoachPersistenceConflict,
  deleteCoachData,
  loadCoachData,
  saveCoachData,
} from '@/features/algorithm-coach/persistence.server';
import { enforceCoachRateLimits } from '@/features/algorithm-coach/rate-limit.server';

import { getAuth } from '@/core/auth';

export const dynamic = 'force-dynamic';

async function authenticatedUserId(request: Request): Promise<string> {
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
  return userId;
}

async function handle(
  request: Request,
  operation: (userId: string) => Promise<Response>
): Promise<Response> {
  const traceId = crypto.randomUUID();
  try {
    const userId = await authenticatedUserId(request);
    const limited = await enforceCoachRateLimits(request, 'state', userId);
    if (limited) return limited;
    return await operation(userId);
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    if (error instanceof CoachPersistenceConflict) {
      return errorResponse(
        new CoachHttpError(409, 'revision_conflict', error.message, {
          currentRevision: error.currentRevision,
          replayedMutationIds: error.replayedMutationIds,
        }),
        traceId
      );
    }
    console.error(
      JSON.stringify({
        event: 'coach_state_database_failed',
        traceId,
        errorName: error instanceof Error ? error.name : 'Error',
      })
    );
    return errorResponse(
      new CoachHttpError(
        500,
        'database_error',
        'Learning data could not be persisted.'
      ),
      traceId
    );
  }
}

export async function GET(request: Request) {
  return handle(request, async (userId) => {
    const data = await loadCoachData(userId);
    return Response.json(
      { data },
      { headers: { 'cache-control': 'no-store' } }
    );
  });
}

export async function PUT(request: Request) {
  return handle(request, async (userId) => {
    const body = await readJsonBody(request, 1_500_000);
    const parsed = coachSyncRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_state',
        'Learning data validation failed.',
        parsed.error.flatten()
      );
    }
    const revision = await saveCoachData(
      userId,
      parsed.data.state,
      parsed.data.importedProblem,
      parsed.data.importedDrafts,
      parsed.data.reviewProgress,
      parsed.data.revision
    );
    return Response.json(
      { data: { saved: true, revision } },
      { headers: { 'cache-control': 'no-store' } }
    );
  });
}

export async function PATCH(request: Request) {
  return handle(request, async (userId) => {
    const body = await readJsonBody(request, 1_500_000);
    const parsed = coachMutationSyncRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_mutations',
        'Learning data mutations failed validation.',
        parsed.error.flatten()
      );
    }
    const result = await applyCoachDataMutations(
      userId,
      parsed.data.revision,
      parsed.data.mutations
    );
    return Response.json(
      { data: result },
      { headers: { 'cache-control': 'no-store' } }
    );
  });
}

export async function DELETE(request: Request) {
  return handle(request, async (userId) => {
    const revision = await deleteCoachData(userId);
    return Response.json(
      { data: { deleted: true, revision } },
      { headers: { 'cache-control': 'no-store' } }
    );
  });
}
