import { createHash, timingSafeEqual } from 'node:crypto';
import {
  recordCoachAiRequestMetric,
  relayOriginFromEnvironment,
} from '@/features/algorithm-coach/ai-metrics.server';
import { estimateCoachCostUsd } from '@/features/algorithm-coach/model';
import { resolveAiRelayEnvironment } from '@/features/algorithm-coach/relay-config';
import {
  AiRelayProbeError,
  probeAiRelayChat,
} from '@/features/algorithm-coach/relay-preflight';

import { recordOperationalEvent } from '@/shared/lib/observability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function isAuthorized(request: Request, expectedToken: string) {
  const authorization = request.headers.get('authorization') ?? '';
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  return Boolean(
    supplied && timingSafeEqual(digest(supplied), digest(expectedToken))
  );
}

function modelFromEnvironment(primary: boolean) {
  return (
    process.env[
      primary ? 'AI_RELAY_PRIMARY_MODEL' : 'AI_RELAY_FALLBACK_MODEL'
    ] ??
    process.env[primary ? 'ALGO_COACH_MODEL' : 'ALGO_COACH_FALLBACK_MODEL'] ??
    ''
  ).trim();
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const expectedToken = process.env.AI_RELAY_CANARY_TOKEN?.trim() ?? '';
  if (expectedToken.length < 32) {
    return Response.json(
      { status: 'error', code: 'canary_not_configured', traceId },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
  if (!isAuthorized(request, expectedToken)) {
    return Response.json(
      { status: 'error', code: 'unauthorized', traceId },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    );
  }

  const relay = resolveAiRelayEnvironment();
  const usesRelayModelPair = Boolean(relay.primaryModel || relay.fallbackModel);
  const primaryModel = usesRelayModelPair
    ? (relay.primaryModel ?? '')
    : modelFromEnvironment(true);
  const fallbackModel = usesRelayModelPair
    ? (relay.fallbackModel ?? '')
    : modelFromEnvironment(false);
  const startedAt = Date.now();
  const models = Array.from(new Set([primaryModel, fallbackModel]));
  const config = {
    apiKey: relay.apiKey,
    baseURL: relay.baseURL ?? '',
    primaryModel,
    fallbackModel,
    timeoutMs: Number(process.env.AI_RELAY_CANARY_TIMEOUT_MS) || 8_000,
  };
  const probeInputTokens = Math.max(
    1,
    Math.ceil(
      new TextEncoder().encode('Reply with the single word OK.').byteLength / 3
    )
  );
  const outcomes = await Promise.all(
    models.map(async (model, index) => {
      const probeStartedAt = Date.now();
      try {
        const result = await probeAiRelayChat(config, model);
        const modelLatencyMs = Date.now() - probeStartedAt;
        const estimatedCostUsd = estimateCoachCostUsd(result.usage, model);
        return {
          status: 'succeeded' as const,
          index,
          model,
          modelLatencyMs,
          requestId: result.requestId,
          usage: result.usage,
          usageReported: result.usageReported,
          estimatedCostUsd,
        };
      } catch (error) {
        const errorCode =
          error instanceof AiRelayProbeError
            ? error.kind
            : ('channel_unavailable' as const);
        const reserveFailureCost = [
          'rate_limited',
          'channel_unavailable',
          'timeout',
          'invalid_output',
        ].includes(errorCode);
        const usage = reserveFailureCost
          ? {
              inputTokens: probeInputTokens,
              outputTokens: 32,
              totalTokens: probeInputTokens + 32,
            }
          : undefined;
        return {
          status: 'failed' as const,
          index,
          model,
          modelLatencyMs: Date.now() - probeStartedAt,
          errorCode,
          usage,
          estimatedCostUsd: usage ? estimateCoachCostUsd(usage, model) : 0,
        };
      }
    })
  );
  await Promise.all(
    outcomes.map((outcome) =>
      recordCoachAiRequestMetric({
        traceId: `${traceId}:${outcome.index}`,
        surface: 'canary',
        action:
          outcome.index === 0 ? 'primary_completion' : 'fallback_completion',
        status: outcome.status,
        relayOrigin: relayOriginFromEnvironment(),
        selectedModel: outcome.model,
        attempts: 1,
        latencyMs: outcome.modelLatencyMs,
        usageReported:
          outcome.status === 'succeeded' ? outcome.usageReported : false,
        ...(outcome.status === 'succeeded'
          ? {
              usage: outcome.usage,
              estimatedCostUsd: outcome.estimatedCostUsd,
            }
          : {
              errorCode: outcome.errorCode,
              ...(outcome.usage ? { usage: outcome.usage } : {}),
              estimatedCostUsd: outcome.estimatedCostUsd,
            }),
      })
    )
  );
  const latencyMs = Date.now() - startedAt;
  const failures = outcomes.filter((outcome) => outcome.status === 'failed');
  if (failures.length === 0) {
    await recordOperationalEvent({
      event: 'ai_relay_canary_succeeded',
      traceId,
      properties: {
        models,
        latencyMs,
        requestIds: outcomes.map((outcome) =>
          outcome.status === 'succeeded' ? outcome.requestId : undefined
        ),
      },
    });
    return Response.json(
      { status: 'ok', traceId, models, latencyMs },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    );
  }
  const errorCodes = failures.map((failure) => failure.errorCode);
  await recordOperationalEvent({
    event: 'ai_relay_canary_failed',
    traceId,
    error: new Error(errorCodes.join(',')),
    properties: { models, latencyMs, errorCodes },
  });
  return Response.json(
    { status: 'error', code: 'relay_unavailable', traceId },
    { status: 503, headers: { 'cache-control': 'no-store' } }
  );
}
