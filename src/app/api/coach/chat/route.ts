import { createDemoChatResponse } from '@/features/algorithm-coach/fixtures';
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

function demoStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = text.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [text];
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

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
    const headers = {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-coach-model': config.apiKey ? config.model : 'fixture/algocoach-v1',
      'x-coach-mode': config.apiKey ? 'live' : 'demo',
      'x-coach-prompt-version': COACH_PROMPT_VERSION,
      'x-coach-trace-id': traceId,
    };

    if (!config.apiKey) {
      return new Response(demoStream(createDemoChatResponse(chatRequest)), {
        headers,
      });
    }

    return streamLiveCoachChat(chatRequest, config).toTextStreamResponse({
      headers,
    });
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    if (error instanceof CoachModelError) {
      return errorResponse(
        new CoachHttpError(
          error.code === 'model_not_allowed' ? 400 : 502,
          error.code,
          error.message
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
