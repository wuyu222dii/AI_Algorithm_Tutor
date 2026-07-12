import {
  CoachHttpError,
  errorResponse,
  readJsonBody,
} from '@/features/algorithm-coach/http';
import {
  coachRequestSchema,
  normalizeCoachRequest,
} from '@/features/algorithm-coach/schemas';
import {
  COACH_PROMPT_VERSION,
  CoachModelError,
  generateLiveArtifact,
  getCoachRuntimeConfig,
} from '@/features/algorithm-coach/server';
import { CoachResponse } from '@/features/algorithm-coach/types';

import { enforceMinIntervalRateLimit } from '@/shared/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const startedAt = performance.now();
  try {
    const body = await readJsonBody(request);
    const parsed = coachRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_request',
        'Coach request validation failed.',
        parsed.error.flatten()
      );
    }

    const coachRequest = normalizeCoachRequest(parsed.data);
    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: 500,
      keyPrefix: 'algorithm-coach',
      extraKey: coachRequest.action,
    });
    if (limited) {
      limited.headers.set('x-coach-trace-id', traceId);
      return limited;
    }

    const config = await getCoachRuntimeConfig(coachRequest.model);
    if (!config.apiKey) {
      throw new CoachHttpError(
        503,
        'ai_not_configured',
        'The AI coach is not configured.'
      );
    }

    const artifact = await generateLiveArtifact(coachRequest, config);
    const mode: CoachResponse['mode'] = 'live';

    const response: CoachResponse = {
      artifact,
      mode,
      model: config.model,
      promptVersion: COACH_PROMPT_VERSION,
      latencyMs: Math.round(performance.now() - startedAt),
      traceId,
    };

    return Response.json(response, {
      headers: {
        'cache-control': 'no-store',
        'x-coach-mode': mode,
        'x-coach-trace-id': traceId,
      },
    });
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    if (error instanceof CoachModelError) {
      if (error.code === 'provider_failed') {
        console.error(`[coach:${traceId}] provider failure`, error.message);
      }
      return errorResponse(
        new CoachHttpError(
          error.code === 'model_not_allowed' ? 400 : 502,
          error.code,
          error.code === 'provider_failed'
            ? 'The AI provider could not generate a valid coach response.'
            : error.message,
          error.code === 'provider_failed' ? undefined : error.message
        ),
        traceId
      );
    }

    console.error(`[coach:${traceId}] unexpected failure`, error);
    return errorResponse(
      new CoachHttpError(
        500,
        'internal_error',
        'The coach request could not be completed.'
      ),
      traceId
    );
  }
}
