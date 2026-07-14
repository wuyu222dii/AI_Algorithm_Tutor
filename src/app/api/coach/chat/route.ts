import { hydrateCoachCatalogRequest } from '@/features/algorithm-coach/coach-request.server';
import { canUseCoachDemoFallback } from '@/features/algorithm-coach/demo-fallback';
import { createDemoChatResponse } from '@/features/algorithm-coach/fixtures';
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
  coachChatRequestSchema,
  normalizeCoachChatRequest,
} from '@/features/algorithm-coach/schemas';
import {
  COACH_CHAT_MAX_OUTPUT_TOKENS,
  COACH_PROMPT_VERSION,
  CoachModelError,
  getCoachRuntimeConfig,
  streamLiveCoachChat,
} from '@/features/algorithm-coach/server';
import { CoachChatRequest, Problem } from '@/features/algorithm-coach/types';

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
      message: 'The AI provider could not start a coach response.',
    },
  }[error.reason ?? 'unknown'];
  const response = errorResponse(
    new CoachHttpError(failure.status, failure.code, failure.message),
    traceId
  );
  if (failure.status === 429) response.headers.set('retry-after', '30');
  return response;
}

function localCoachChatResponse(
  chatRequest: CoachChatRequest,
  traceId: string,
  reason: 'not_configured' | 'provider_failed',
  problem?: Problem
) {
  void recordOperationalEvent({
    event: 'coach_chat_started',
    traceId,
    properties: {
      mode: 'local',
      model: 'deterministic-demo',
      reason,
    },
  });
  return new Response(createDemoChatResponse(chatRequest, problem), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-coach-model': 'deterministic-demo',
      'x-coach-mode': 'local',
      'x-coach-prompt-version': COACH_PROMPT_VERSION,
      'x-coach-trace-id': traceId,
    },
  });
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  let capacityLease: CoachCapacityLease | undefined;
  const limited = await enforceCoachRateLimits(request, 'chat');
  if (limited) {
    limited.headers.set('x-coach-trace-id', traceId);
    return limited;
  }

  try {
    const body = await readJsonBody(request);
    const parsed = coachChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_request',
        'Coach chat request validation failed.',
        parsed.error.flatten()
      );
    }

    const hydrated = await hydrateCoachCatalogRequest(
      normalizeCoachChatRequest(parsed.data)
    );
    const chatRequest = hydrated.request;
    const config = await getCoachRuntimeConfig('chat');
    if (!config.apiKey) {
      const fallbackRequest = {
        action: 'hint' as const,
        ...chatRequest,
      };
      if (canUseCoachDemoFallback(fallbackRequest, Boolean(hydrated.problem))) {
        return localCoachChatResponse(
          chatRequest,
          traceId,
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

    const capacity = await acquireCoachCapacity(request, 'chat', undefined, {
      models: [
        config.model,
        ...(config.fallbackModel ? [config.fallbackModel] : []),
      ],
      input: chatRequest,
      maxOutputTokens: COACH_CHAT_MAX_OUTPUT_TOKENS,
      maxAttempts: 2,
    });
    if (capacity instanceof Response) {
      capacity.headers.set('x-coach-trace-id', traceId);
      return capacity;
    }
    capacityLease = capacity;

    let generation;
    try {
      generation = await streamLiveCoachChat(chatRequest, config);
    } catch (error) {
      await commitCoachFailedUsage(
        capacityLease,
        error instanceof CoachModelError ? error.attempts : 1
      );
      capacityLease = undefined;
      const fallbackRequest = {
        action: 'hint' as const,
        ...chatRequest,
      };
      if (
        error instanceof CoachModelError &&
        error.code === 'provider_failed' &&
        canUseCoachDemoFallback(fallbackRequest, Boolean(hydrated.problem))
      ) {
        void recordOperationalEvent({
          event: 'coach_chat_provider_fallback',
          level: 'warn',
          traceId,
          properties: { model: config.model },
          error,
        });
        return localCoachChatResponse(
          chatRequest,
          traceId,
          'provider_failed',
          hydrated.problem
        );
      }
      throw error;
    }

    const settledLease = capacityLease;
    capacityLease = undefined;
    void generation.completion
      .then(async (completion) => {
        await commitCoachUsage(
          settledLease,
          completion.usage,
          completion.estimatedCostUsd,
          generation.attempts
        );
        await recordOperationalEvent({
          event: 'coach_chat_completed',
          traceId,
          properties: {
            model: generation.selectedModel,
            attempts: generation.attempts,
            finishReason: completion.finishReason,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
            totalTokens: completion.usage.totalTokens,
            estimatedCostUsd: completion.estimatedCostUsd,
          },
        });
      })
      .catch(async (error) => {
        await commitCoachFailedUsage(settledLease, generation.attempts);
        await recordOperationalEvent({
          event: 'coach_chat_stream_failed',
          level: 'error',
          traceId,
          properties: {
            model: generation.selectedModel,
            attempts: generation.attempts,
          },
          error,
        });
      });

    const headers = {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-coach-model': generation.selectedModel,
      'x-coach-mode': 'live',
      'x-coach-attempts': String(generation.attempts),
      'x-coach-prompt-version': COACH_PROMPT_VERSION,
      'x-coach-trace-id': traceId,
    };

    void recordOperationalEvent({
      event: 'coach_chat_started',
      traceId,
      properties: {
        mode: 'live',
        model: generation.selectedModel,
        attempts: generation.attempts,
        fallbackFrom: generation.fallbackFrom,
      },
    });

    return new Response(generation.stream, {
      headers,
    });
  } catch (error) {
    if (capacityLease) await releaseCoachCapacity(capacityLease);
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    if (error instanceof CoachModelError) {
      if (error.code === 'provider_failed') {
        void recordOperationalEvent({
          event: 'coach_chat_provider_failed',
          level: 'error',
          traceId,
          error,
        });
      }
      return coachModelErrorResponse(error, traceId);
    }
    void recordOperationalEvent({
      event: 'coach_chat_failed',
      level: 'error',
      traceId,
      error,
    });
    return errorResponse(
      new CoachHttpError(
        500,
        'internal_error',
        'The coach chat request could not be started.'
      ),
      traceId
    );
  }
}
