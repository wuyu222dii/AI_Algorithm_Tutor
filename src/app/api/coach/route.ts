import { canUseCoachDemoFallback } from '@/features/algorithm-coach/demo-fallback';
import { createDemoArtifact } from '@/features/algorithm-coach/fixtures';
import {
  CoachHttpError,
  errorResponse,
  readJsonBody,
} from '@/features/algorithm-coach/http';
import { enforceCoachRateLimits } from '@/features/algorithm-coach/rate-limit.server';
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
import { CoachRequest, CoachResponse } from '@/features/algorithm-coach/types';

import { recordOperationalEvent } from '@/shared/lib/observability';

export const dynamic = 'force-dynamic';

function localCoachResponse(
  coachRequest: CoachRequest,
  traceId: string,
  startedAt: number,
  reason: 'not_configured' | 'provider_failed'
) {
  const artifact = {
    ...createDemoArtifact(coachRequest),
    generationMode: 'local' as const,
    model: 'deterministic-demo',
    promptVersion: COACH_PROMPT_VERSION,
    traceId,
    latencyMs: Math.round(performance.now() - startedAt),
  };
  const response: CoachResponse = {
    artifact,
    mode: 'local',
    model: 'deterministic-demo',
    promptVersion: COACH_PROMPT_VERSION,
    latencyMs: artifact.latencyMs,
    traceId,
  };
  void recordOperationalEvent({
    event: 'coach_artifact_generated',
    traceId,
    properties: {
      action: coachRequest.action,
      mode: 'local',
      model: response.model,
      reason,
      latencyMs: response.latencyMs,
    },
  });
  return Response.json(response, {
    headers: {
      'cache-control': 'no-store',
      'x-coach-mode': 'local',
      'x-coach-trace-id': traceId,
    },
  });
}

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
    const limited = await enforceCoachRateLimits(request, 'artifact');
    if (limited) {
      limited.headers.set('x-coach-trace-id', traceId);
      return limited;
    }

    const config = await getCoachRuntimeConfig(coachRequest.model);
    if (!config.apiKey) {
      if (canUseCoachDemoFallback(coachRequest)) {
        return localCoachResponse(
          coachRequest,
          traceId,
          startedAt,
          'not_configured'
        );
      }
      throw new CoachHttpError(
        503,
        'ai_not_configured',
        'The AI coach is not configured.'
      );
    }

    let artifact;
    try {
      artifact = await generateLiveArtifact(coachRequest, config);
    } catch (error) {
      if (
        error instanceof CoachModelError &&
        error.code === 'provider_failed' &&
        canUseCoachDemoFallback(coachRequest)
      ) {
        void recordOperationalEvent({
          event: 'coach_provider_fallback',
          level: 'warn',
          traceId,
          properties: { action: coachRequest.action, model: config.model },
          error,
        });
        return localCoachResponse(
          coachRequest,
          traceId,
          startedAt,
          'provider_failed'
        );
      }
      throw error;
    }
    const mode: CoachResponse['mode'] = 'live';

    const response: CoachResponse = {
      artifact,
      mode,
      model: config.model,
      promptVersion: COACH_PROMPT_VERSION,
      latencyMs: Math.round(performance.now() - startedAt),
      traceId,
    };
    void recordOperationalEvent({
      event: 'coach_artifact_generated',
      traceId,
      properties: {
        action: coachRequest.action,
        mode,
        model: response.model,
        latencyMs: response.latencyMs,
      },
    });

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
        void recordOperationalEvent({
          event: 'coach_provider_failed',
          level: 'error',
          traceId,
          error,
        });
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

    void recordOperationalEvent({
      event: 'coach_request_failed',
      level: 'error',
      traceId,
      error,
    });
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
