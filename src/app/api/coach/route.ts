import {
  recordCoachAiRequestMetric,
  relayOriginFromBaseUrl,
} from '@/features/algorithm-coach/ai-metrics.server';
import { hydrateCoachCatalogRequest } from '@/features/algorithm-coach/coach-request.server';
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
  commitCoachConservativeUsage,
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
  COACH_PROMPT_VERSION,
  coachArtifactMaxAttempts,
  coachArtifactMaxOutputTokens,
  CoachModelError,
  generateLiveArtifact,
  getCoachRuntimeConfig,
} from '@/features/algorithm-coach/server';
import {
  CoachRequest,
  CoachResponse,
  Problem,
} from '@/features/algorithm-coach/types';

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
    credential_invalid: {
      status: 503,
      code: 'ai_configuration_error',
      message: 'The AI relay credentials are invalid.',
    },
    group_access_denied: {
      status: 503,
      code: 'provider_access_denied',
      message:
        'The configured AI relay model is not available to this account.',
    },
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
    channel_unavailable: {
      status: 503,
      code: 'provider_unavailable',
      message: 'The AI provider is temporarily unavailable.',
    },
    invalid_output: {
      status: 502,
      code: 'provider_invalid_output',
      message: 'The AI provider returned an invalid coach response.',
    },
  }[error.reason];
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
  reason: 'not_configured' | 'provider_failed',
  problem?: Problem
) {
  const artifact = {
    ...createDemoArtifact(coachRequest, problem),
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
      const action =
        body &&
        typeof body === 'object' &&
        'action' in body &&
        typeof body.action === 'string'
          ? body.action.slice(0, 80)
          : 'unknown';
      void recordOperationalEvent({
        event: 'coach_request_validation_failed',
        level: 'warn',
        traceId,
        properties: {
          action,
          issues: parsed.error.issues.slice(0, 12).map((issue) => ({
            path: issue.path.join('.').slice(0, 160),
            code: issue.code,
          })),
        },
      });
      throw new CoachHttpError(
        400,
        'invalid_request',
        'Coach request validation failed.',
        parsed.error.flatten()
      );
    }

    const hydrated = await hydrateCoachCatalogRequest(
      normalizeCoachRequest(parsed.data)
    );
    const coachRequest = hydrated.request;
    const limited = await enforceCoachRateLimits(request, 'artifact');
    if (limited) {
      limited.headers.set('x-coach-trace-id', traceId);
      return limited;
    }

    const config = await getCoachRuntimeConfig(coachRequest.action);
    if (!config.apiKey) {
      if (canUseCoachDemoFallback(coachRequest, Boolean(hydrated.problem))) {
        return localCoachResponse(
          coachRequest,
          traceId,
          startedAt,
          'not_configured',
          hydrated.problem
        );
      }
      throw new CoachHttpError(
        503,
        'ai_not_configured',
        'The AI coach is not configured.'
      );
    }

    const models = Array.from(
      new Set(
        [config.model, config.fallbackModel].filter((model): model is string =>
          Boolean(model)
        )
      )
    );
    const capacity = await acquireCoachCapacity(
      request,
      'artifact',
      undefined,
      {
        models,
        input: coachRequest,
        maxOutputTokens: coachArtifactMaxOutputTokens(coachRequest.action),
        maxAttempts: coachArtifactMaxAttempts(
          coachRequest.action,
          models.length
        ),
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
      const attempts = error instanceof CoachModelError ? error.attempts : 1;
      const settlement = await commitCoachFailedUsage(capacityLease, attempts);
      capacityLease = undefined;
      await recordCoachAiRequestMetric({
        traceId,
        surface: 'artifact',
        action: coachRequest.action,
        status: 'failed',
        relayOrigin: relayOriginFromBaseUrl(config.baseURL),
        selectedModel:
          error instanceof CoachModelError
            ? (error.selectedModel ?? config.model)
            : config.model,
        fallbackFrom:
          error instanceof CoachModelError ? error.fallbackFrom : undefined,
        attempts,
        errorCode:
          error instanceof CoachModelError
            ? error.reason
            : 'channel_unavailable',
        latencyMs: Math.round(performance.now() - startedAt),
        usageReported: false,
        usage: { totalTokens: settlement.totalTokens },
        estimatedCostUsd: settlement.estimatedCostUsd,
      });
      if (
        error instanceof CoachModelError &&
        error.code === 'provider_failed' &&
        canUseCoachDemoFallback(coachRequest, Boolean(hydrated.problem))
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
          'provider_failed',
          hydrated.problem
        );
      }
      throw error;
    }
    const settlement = generation.usageReported
      ? await commitCoachUsage(
          capacityLease,
          generation.usage,
          generation.estimatedCostUsd,
          generation.attempts
        )
      : await commitCoachConservativeUsage(capacityLease, generation.attempts);
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
      usageReported: generation.usageReported,
      estimatedCostUsd: generation.estimatedCostUsd,
    };
    await recordCoachAiRequestMetric({
      traceId,
      surface: 'artifact',
      action: coachRequest.action,
      status: 'succeeded',
      relayOrigin: relayOriginFromBaseUrl(config.baseURL),
      selectedModel: generation.selectedModel,
      fallbackFrom: generation.fallbackFrom,
      attempts: generation.attempts,
      latencyMs: response.latencyMs,
      usageReported: generation.usageReported,
      usage: {
        inputTokens: generation.usage.inputTokens,
        outputTokens: generation.usage.outputTokens,
        totalTokens: settlement.totalTokens,
      },
      estimatedCostUsd: settlement.estimatedCostUsd,
    });
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
        usageReported: generation.usageReported,
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
