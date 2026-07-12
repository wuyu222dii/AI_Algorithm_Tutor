import {
  CoachHttpError,
  errorResponse,
  readJsonBody,
} from '@/features/algorithm-coach/http';
import {
  coachChatRequestSchema,
  normalizeCoachChatRequest,
} from '@/features/algorithm-coach/schemas';
import {
  COACH_PROMPT_VERSION,
  CoachModelError,
  getCoachRuntimeConfig,
  streamLiveCoachChat,
} from '@/features/algorithm-coach/server';

import { enforceMinIntervalRateLimit } from '@/shared/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 700,
    keyPrefix: 'algorithm-coach-chat',
  });
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

    const chatRequest = normalizeCoachChatRequest(parsed.data);
    const config = await getCoachRuntimeConfig(chatRequest.model);
    if (!config.apiKey) {
      throw new CoachHttpError(
        503,
        'ai_not_configured',
        'The AI coach is not configured.'
      );
    }

    const headers = {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-coach-model': config.model,
      'x-coach-mode': 'live',
      'x-coach-prompt-version': COACH_PROMPT_VERSION,
      'x-coach-trace-id': traceId,
    };

    return new Response(await streamLiveCoachChat(chatRequest, config), {
      headers,
    });
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    if (error instanceof CoachModelError) {
      if (error.code === 'provider_failed') {
        console.error(
          `[coach-chat:${traceId}] provider failure`,
          error.message
        );
      }
      return errorResponse(
        new CoachHttpError(
          error.code === 'model_not_allowed' ? 400 : 502,
          error.code,
          error.code === 'provider_failed'
            ? 'The AI provider could not start a coach response.'
            : error.message,
          error.code === 'provider_failed' ? undefined : error.message
        ),
        traceId
      );
    }
    console.error(`[coach-chat:${traceId}] unexpected failure`, error);
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
