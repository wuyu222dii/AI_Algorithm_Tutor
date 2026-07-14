import { canUseCoachDemoFallback } from '@/features/algorithm-coach/demo-fallback';
import { createDemoArtifact } from '@/features/algorithm-coach/fixtures';
import {
  CoachHttpError,
  errorResponse,
  readJsonBody,
} from '@/features/algorithm-coach/http';
import {
  acquireCoachCapacity,
  CoachCapacityLease,
  commitCoachFailedUsage,
  commitCoachUsage,
  enforceCoachRateLimits,
  releaseCoachCapacity,
} from '@/features/algorithm-coach/rate-limit.server';
import {
  coachRequestSchema,
  normalizeCoachRequest,
} from '@/features/algorithm-coach/schemas';
import {
  COACH_ARTIFACT_MAX_OUTPUT_TOKENS,
  COACH_PROMPT_VERSION,
  CoachModelError,
  generateLiveArtifact,
  getCoachRuntimeConfig,
} from '@/features/algorithm-coach/server';
import { CoachRequest, CoachResponse } from '@/features/algorithm-coach/types';

import { recordOperationalEvent } from '@/shared/lib/observability';

export const dynamic = 'force-dynamic';

function coachModelErrorResponse(error: CoachModelError, traceId: string) {
  if (error.code === 'model_not_allowed') {
    return errorResponse(
      new CoachHttpError(
        503,
        'ai_configuration_error',
        'The AI coach model configuration is invalid.'
      ),
      traceId
    );
  }
  const failure = {
    rate_limited: {
      status: 429,
      code: 'provider_rate_limited',
      message: 'The AI provider rate limit has been reached.',
    },
    timeout: {
      status: 504,
      code: 'provider_timeout',
      message: 'The AI provider did not respond in time.',
    },
    unavailable: {
      status: 503,
      code: 'provider_unavailable',
      message: 'The AI provider is temporarily unavailable.',
    },
    invalid_output: {
      status: 502,
      code: 'provider_invalid_output',
      message: 'The AI provider returned an invalid coach response.',
    },
    unknown: {
      status: 502,
      code: 'provider_failed',
      message: 'The AI provider could not generate a valid coach response.',
    },
  }[error.reason ?? 'unknown'];
  const response = errorResponse(
    new CoachHttpError(failure.status, failure.code, failure.message),
    traceId
  );
  if (failure.status === 429) response.headers.set('retry-after', '30');
  return response;
}

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
  let capacityLease: CoachCapacityLease | undefined;
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

    const config = await getCoachRuntimeConfig(coachRequest.action);
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

    const capacity = await acquireCoachCapacity(
      request,
      'artifact',
      undefined,
      {
        models: [
          config.model,
          ...(config.fallbackModel ? [config.fallbackModel] : []),
        ],
        input: coachRequest,
        maxOutputTokens: COACH_ARTIFACT_MAX_OUTPUT_TOKENS,
        maxAttempts: 3,
      }
    );
    if (capacity instanceof Response) {
      capacity.headers.set('x-coach-trace-id', traceId);
      return capacity;
    }
    capacityLease = capacity;

    let generation;
    try {
      generation = await generateLiveArtifact(coachRequest, config);
    } catch (error) {
      await commitCoachFailedUsage(
        capacityLease,
        error instanceof CoachModelError ? error.attempts : 1
      );
      capacityLease = undefined;
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
    await commitCoachUsage(
      capacityLease,
      generation.usage,
      generation.estimatedCostUsd,
      generation.attempts
    );
    capacityLease = undefined;
    const mode: CoachResponse['mode'] = 'live';
    const artifact = {
      ...generation.artifact,
      generationMode: mode,
      model: generation.selectedModel,
      promptVersion: COACH_PROMPT_VERSION,
      traceId,
      latencyMs: Math.round(performance.now() - startedAt),
    };

    const response: CoachResponse = {
      artifact,
      mode,
      model: generation.selectedModel,
      promptVersion: COACH_PROMPT_VERSION,
      latencyMs: artifact.latencyMs,
      traceId,
      attempts: generation.attempts,
      fallbackFrom: generation.fallbackFrom,
      finishReason: generation.finishReason,
      usage: generation.usage,
      estimatedCostUsd: generation.estimatedCostUsd,
    };
    void recordOperationalEvent({
      event: 'coach_artifact_generated',
      traceId,
      properties: {
        action: coachRequest.action,
        mode,
        model: response.model,
        attempts: generation.attempts,
        fallbackFrom: generation.fallbackFrom,
        finishReason: generation.finishReason,
        inputTokens: generation.usage.inputTokens,
        outputTokens: generation.usage.outputTokens,
        totalTokens: generation.usage.totalTokens,
        estimatedCostUsd: generation.estimatedCostUsd,
        latencyMs: response.latencyMs,
      },
    });

    return Response.json(response, {
      headers: {
        'cache-control': 'no-store',
        'x-coach-mode': mode,
        'x-coach-model': response.model,
        'x-coach-attempts': String(generation.attempts),
        'x-coach-trace-id': traceId,
      },
    });
  } catch (error) {
    if (capacityLease) await releaseCoachCapacity(capacityLease);
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
      return coachModelErrorResponse(error, traceId);
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
