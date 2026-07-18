import { exportCoachLearningData } from '@/features/algorithm-coach/export.server';
import { CoachHttpError, errorResponse } from '@/features/algorithm-coach/http';
import { enforceCoachRateLimits } from '@/features/algorithm-coach/rate-limit.server';

import { getAuth } from '@/core/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
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

    const data = await exportCoachLearningData(userId);
    return Response.json(
      { data },
      {
        headers: {
          'cache-control': 'private, no-store, max-age=0',
          'content-disposition': `attachment; filename="algocoach-learning-data-${data.exportedAt.slice(0, 10)}.json"`,
          'x-content-type-options': 'nosniff',
        },
      }
    );
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    console.error(
      JSON.stringify({
        event: 'coach_export_failed',
        traceId,
        errorName: error instanceof Error ? error.name : 'Error',
      })
    );
    return errorResponse(
      new CoachHttpError(
        500,
        'export_failed',
        'Learning data could not be exported.'
      ),
      traceId
    );
  }
}
