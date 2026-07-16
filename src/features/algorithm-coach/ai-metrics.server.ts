import 'server-only';

import { dbPostgres } from '@/core/db';
import { envConfigs } from '@/config';
import { coachAiRequestMetric } from '@/config/db/schema.postgres';
import { recordOperationalEvent } from '@/shared/lib/observability';

import { resolveAiRelayEnvironment } from './relay-config';

export type CoachAiMetricSurface =
  | 'artifact'
  | 'chat'
  | 'catalog_draft'
  | 'canary'
  | 'eval';

export type CoachAiMetricStatus = 'succeeded' | 'failed' | 'cancelled';

export interface CoachAiRequestMetricInput {
  traceId: string;
  surface: CoachAiMetricSurface;
  action: string;
  mode?: 'live' | 'local';
  status: CoachAiMetricStatus;
  relayOrigin?: string;
  selectedModel?: string;
  fallbackFrom?: string;
  attempts?: number;
  errorCode?: string;
  latencyMs: number;
  usageReported?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  estimatedCostUsd?: number;
  createdAt?: Date;
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

export function relayOriginFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  return relayOriginFromBaseUrl(resolveAiRelayEnvironment(env).baseURL);
}

export function relayOriginFromBaseUrl(
  value: string | undefined
): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function normalizeCoachAiRequestMetric(
  input: CoachAiRequestMetricInput
) {
  const rawAttempts = Number.isFinite(input.attempts)
    ? Math.round(input.attempts ?? 1)
    : 1;
  const attempts = Math.max(0, Math.min(32_767, rawAttempts));
  const costUsd = Number.isFinite(input.estimatedCostUsd)
    ? Math.max(0, input.estimatedCostUsd ?? 0)
    : 0;
  const estimatedCostMicroUsd = Math.max(
    0,
    Math.min(2_147_483_647, Math.round(costUsd * 1_000_000))
  );
  return {
    traceId: input.traceId,
    surface: input.surface,
    action: input.action.slice(0, 80),
    mode: input.mode ?? 'live',
    status: input.status,
    relayOrigin: input.relayOrigin ?? relayOriginFromEnvironment(),
    selectedModel: input.selectedModel?.slice(0, 160),
    fallbackFrom: input.fallbackFrom?.slice(0, 160),
    attempts,
    errorCode: input.errorCode?.slice(0, 80),
    latencyMs: nonNegativeInteger(input.latencyMs) ?? 0,
    usageReported: input.usageReported ?? false,
    inputTokens: nonNegativeInteger(input.usage?.inputTokens),
    outputTokens: nonNegativeInteger(input.usage?.outputTokens),
    totalTokens: nonNegativeInteger(input.usage?.totalTokens),
    estimatedCostMicroUsd,
    createdAt: input.createdAt ?? new Date(),
  };
}

/**
 * Stores operational AI metadata only. Prompt text, code, credentials and user
 * identifiers are intentionally excluded from this contract.
 */
export async function recordCoachAiRequestMetric(
  input: CoachAiRequestMetricInput
): Promise<void> {
  if (envConfigs.database_provider !== 'postgresql') return;
  const writeMetric = async () => {
    try {
      await dbPostgres()
        .insert(coachAiRequestMetric)
        .values(normalizeCoachAiRequestMetric(input))
        .onConflictDoNothing({ target: coachAiRequestMetric.traceId });
    } catch (error) {
      await recordOperationalEvent({
        event: 'coach_ai_metric_write_failed',
        level: 'warn',
        traceId: input.traceId,
        properties: {
          surface: input.surface,
          status: input.status,
          errorCode: input.errorCode,
        },
        error,
      });
    }
  };

  if (process.env.NODE_ENV === 'production') {
    await writeMetric();
  } else {
    // A missing local metrics migration must not block interactive coaching.
    void writeMetric();
  }
}
