import { resolveAiRelayEnvironment } from './relay-config';
import type { CoachAction, CoachTokenUsage } from './types';

export const COACH_PROMPT_VERSION = 'coach-v1.3';
export const COACH_MODEL_WHITELIST: readonly string[] = [
  'google/gemini-2.5-flash',
  'gpt-5.5',
  'openai/gpt-5.5',
  'anthropic/claude-4.5-sonnet',
];
export const DEFAULT_COACH_MODEL = COACH_MODEL_WHITELIST[0];
export const DEFAULT_COACH_FALLBACK_MODEL = COACH_MODEL_WHITELIST[3];

export type CoachModel = string;
export type CoachModelRoute = CoachAction | 'chat';
export type CoachProviderFailureKind =
  | 'credential_invalid'
  | 'group_access_denied'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'channel_unavailable'
  | 'timeout'
  | 'invalid_output';

export class CoachModelError extends Error {
  constructor(
    message: string,
    public readonly code: 'model_not_allowed' | 'provider_failed',
    public readonly reason: CoachProviderFailureKind = 'channel_unavailable',
    public readonly attempts = 0,
    public readonly selectedModel?: CoachModel,
    public readonly fallbackFrom?: CoachModel
  ) {
    super(message);
    this.name = 'CoachModelError';
  }
}

export function isValidCoachModelId(value: string): boolean {
  return value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

export function resolveCoachModel(model?: string): CoachModel {
  const relay = resolveAiRelayEnvironment();
  const candidate =
    model?.trim() ||
    relay.primaryModel ||
    process.env.ALGO_COACH_MODEL?.trim() ||
    DEFAULT_COACH_MODEL;
  if (!isValidCoachModelId(candidate)) {
    throw new CoachModelError(
      `Model "${candidate}" is not a valid relay model identifier.`,
      'model_not_allowed'
    );
  }
  return candidate;
}

function actionEnvironmentName(route: CoachModelRoute, fallback = false) {
  const suffix = route === 'review_card' ? 'REVIEW_CARD' : route.toUpperCase();
  return `ALGO_COACH_${suffix}_${fallback ? 'FALLBACK_' : ''}MODEL`;
}

export function resolveCoachModelRoute(route: CoachModelRoute): {
  primary: CoachModel;
  fallback?: CoachModel;
} {
  const relay = resolveAiRelayEnvironment();
  const usesRelayModelPair = Boolean(relay.primaryModel || relay.fallbackModel);
  if (usesRelayModelPair && (!relay.primaryModel || !relay.fallbackModel)) {
    throw new CoachModelError(
      'AI_RELAY_PRIMARY_MODEL and AI_RELAY_FALLBACK_MODEL must be configured together.',
      'model_not_allowed'
    );
  }
  const globalPrimary = resolveCoachModel(
    usesRelayModelPair ? relay.primaryModel : process.env.ALGO_COACH_MODEL
  );
  const globalFallback = resolveCoachModel(
    usesRelayModelPair
      ? relay.fallbackModel
      : process.env.ALGO_COACH_FALLBACK_MODEL || DEFAULT_COACH_FALLBACK_MODEL
  );
  const primary = resolveCoachModel(
    process.env[actionEnvironmentName(route)]?.trim() || globalPrimary
  );
  const configuredFallback =
    process.env[actionEnvironmentName(route, true)]?.trim() || globalFallback;
  const fallback = resolveCoachModel(configuredFallback);
  if (
    process.env.NODE_ENV === 'production' &&
    [primary, fallback].some(
      (model) => model !== globalPrimary && model !== globalFallback
    )
  ) {
    throw new CoachModelError(
      'Production action routes may only select preflighted relay models.',
      'model_not_allowed'
    );
  }
  return fallback === primary ? { primary } : { primary, fallback };
}

type CircuitEntry = { failures: number; openUntil: number };

declare global {
  var __coachModelCircuits: Map<string, CircuitEntry> | undefined;
}

function circuitStore() {
  if (!globalThis.__coachModelCircuits) {
    globalThis.__coachModelCircuits = new Map();
  }
  return globalThis.__coachModelCircuits;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isCoachModelCircuitOpen(
  model: CoachModel,
  now = Date.now()
): boolean {
  const entry = circuitStore().get(model);
  if (!entry) return false;
  if (entry.openUntil > now) return true;
  if (entry.openUntil) circuitStore().delete(model);
  return false;
}

export function recordCoachModelSuccess(model: CoachModel) {
  circuitStore().delete(model);
}

export function recordCoachModelFailure(
  model: CoachModel,
  reason: CoachProviderFailureKind,
  now = Date.now()
) {
  if (!isCoachFailoverEligible(reason)) return;
  const threshold = positiveInteger(
    process.env.COACH_CIRCUIT_BREAKER_FAILURES,
    3
  );
  const durationMs = positiveInteger(
    process.env.COACH_CIRCUIT_BREAKER_DURATION_MS,
    60_000
  );
  const current = circuitStore().get(model) ?? { failures: 0, openUntil: 0 };
  current.failures += 1;
  if (current.failures >= threshold) current.openUntil = now + durationMs;
  circuitStore().set(model, current);
}

export function resetCoachModelCircuits() {
  circuitStore().clear();
}

function statusCodeFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    cause?: unknown;
    errors?: unknown[];
  };
  const direct = Number(candidate.statusCode ?? candidate.status);
  if (Number.isInteger(direct) && direct >= 100) return direct;
  const caused = statusCodeFromError(candidate.cause);
  if (caused) return caused;
  for (const nested of candidate.errors ?? []) {
    const status = statusCodeFromError(nested);
    if (status) return status;
  }
  return undefined;
}

function hasStructuredProviderErrorCode(
  error: unknown,
  expectedCode: string,
  seen = new Set<object>(),
  depth = 0
): boolean {
  if (depth > 4 || !error || typeof error !== 'object' || seen.has(error)) {
    return false;
  }
  seen.add(error);
  const candidate = error as {
    code?: unknown;
    error?: unknown;
    data?: unknown;
    cause?: unknown;
    errors?: unknown[];
    responseBody?: unknown;
  };
  if (candidate.code === expectedCode) return true;
  if (typeof candidate.responseBody === 'string') {
    try {
      const body = JSON.parse(
        candidate.responseBody.slice(0, 8_000)
      ) as unknown;
      if (hasStructuredProviderErrorCode(body, expectedCode, seen, depth + 1)) {
        return true;
      }
    } catch {
      // Provider response bodies are untrusted and may not be JSON.
    }
  }
  for (const nested of [
    candidate.error,
    candidate.data,
    candidate.cause,
    ...(candidate.errors ?? []).slice(0, 4),
  ]) {
    if (hasStructuredProviderErrorCode(nested, expectedCode, seen, depth + 1)) {
      return true;
    }
  }
  return false;
}

function providerErrorMessage(
  error: unknown,
  seen = new Set<object>(),
  depth = 0
): string {
  if (depth > 4) return '';
  if (typeof error === 'string') return error.slice(0, 8_000);
  if (!error || typeof error !== 'object' || seen.has(error)) return '';
  seen.add(error);
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
    errors?: unknown[];
    responseBody?: unknown;
  };
  const direct = [candidate.name, candidate.message]
    .filter((value): value is string => typeof value === 'string')
    .join(': ');
  let responseBodyMessage = '';
  if (typeof candidate.responseBody === 'string') {
    try {
      const body = JSON.parse(candidate.responseBody.slice(0, 8_000)) as {
        error?: unknown;
        message?: unknown;
      };
      const relayError =
        body.error && typeof body.error === 'object'
          ? (body.error as { message?: unknown; code?: unknown })
          : undefined;
      responseBodyMessage = [
        relayError?.message,
        relayError?.code,
        body.message,
      ]
        .filter(
          (value): value is string | number =>
            typeof value === 'string' || typeof value === 'number'
        )
        .join(' ')
        .slice(0, 2_000);
    } catch {
      responseBodyMessage = '';
    }
  }
  const nested = [
    responseBodyMessage,
    providerErrorMessage(candidate.cause, seen, depth + 1),
    ...(candidate.errors ?? [])
      .slice(0, 4)
      .map((item) => providerErrorMessage(item, seen, depth + 1)),
  ]
    .filter(Boolean)
    .join(' ');
  return `${direct} ${nested}`.trim().slice(0, 8_000);
}

export function isCoachProviderAccessFailure(error: unknown): boolean {
  const reason = classifyCoachProviderError(error);
  return reason === 'credential_invalid' || reason === 'group_access_denied';
}

export function classifyCoachProviderError(
  error: unknown
): CoachProviderFailureKind {
  const status = statusCodeFromError(error);
  const providerMessage = providerErrorMessage(error);
  if (
    status === 403 &&
    (hasStructuredProviderErrorCode(error, 'insufficient_user_quota') ||
      /(?:^|[^A-Za-z0-9_])insufficient_user_quota(?:$|[^A-Za-z0-9_])/i.test(
        providerMessage
      ))
  ) {
    return 'quota_exhausted';
  }
  if (status === 401) return 'credential_invalid';
  if (status === 403) return 'group_access_denied';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status && status >= 500) return 'channel_unavailable';
  const name = error instanceof Error ? error.name : '';
  const message = providerMessage || String(error);
  if (
    /credential[_ -]?invalid|invalid (?:api )?(?:key|token)|unauthori[sz]ed|authentication failed|令牌(?:无效|失效)|密钥(?:无效|错误)|未提供.*令牌/i.test(
      message
    )
  ) {
    return 'credential_invalid';
  }
  if (
    /forbidden|access denied|group.*(?:access|permission)|无权访问.*(?:分组|模型)|权限不足|没有权限/i.test(
      message
    )
  ) {
    return 'group_access_denied';
  }
  if (/rate[ _-]?limit|too many requests|请求(?:过于)?频繁/i.test(message)) {
    return 'rate_limited';
  }
  if (/abort|timeout|timed out|deadline/i.test(`${name} ${message}`)) {
    return 'timeout';
  }
  if (
    /channel[_ -]?unavailable|no available channel|temporarily unavailable|service unavailable|overloaded|upstream.*(?:failed|error)|无可用(?:渠道|通道)|(?:渠道|通道)(?:不可用|异常)/i.test(
      message
    )
  ) {
    return 'channel_unavailable';
  }
  if (
    /schema|structured|parse|invalid json|no object generated/i.test(message)
  ) {
    return 'invalid_output';
  }
  if (status && status >= 400 && status < 500) return 'invalid_output';
  return 'channel_unavailable';
}

export function isCoachFailoverEligible(
  reason: CoachProviderFailureKind
): boolean {
  return (
    reason === 'group_access_denied' ||
    reason === 'rate_limited' ||
    reason === 'channel_unavailable' ||
    reason === 'timeout'
  );
}

export function normalizeCoachUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): CoachTokenUsage {
  const inputTokens = Math.max(0, usage.inputTokens ?? 0);
  const outputTokens = Math.max(0, usage.outputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(inputTokens + outputTokens, usage.totalTokens ?? 0),
  };
}

function positiveNumber(value: string | undefined, fallback: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const LEGACY_COACH_MODEL_PRICE_ENV: Record<string, string> = {
  'google/gemini-2.5-flash': 'GEMINI_2_5_FLASH',
  'gpt-5.5': 'GPT_5_5',
  'openai/gpt-5.5': 'GPT_5_5',
  'anthropic/claude-4.5-sonnet': 'CLAUDE_4_5_SONNET',
};

export interface AiRelayModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export function parseAiRelayPricingJson(
  raw: string | undefined
): Record<string, AiRelayModelPricing> | undefined {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const pricing: Record<string, AiRelayModelPricing> = {};
    for (const [model, value] of Object.entries(parsed)) {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model) ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        return undefined;
      }
      const candidate = value as Record<string, unknown>;
      if (
        Object.keys(candidate).some(
          (key) => key !== 'inputPerMillionUsd' && key !== 'outputPerMillionUsd'
        ) ||
        typeof candidate.inputPerMillionUsd !== 'number' ||
        typeof candidate.outputPerMillionUsd !== 'number'
      ) {
        return undefined;
      }
      const inputPerMillionUsd = candidate.inputPerMillionUsd;
      const outputPerMillionUsd = candidate.outputPerMillionUsd;
      if (
        !Number.isFinite(inputPerMillionUsd) ||
        inputPerMillionUsd < 0 ||
        !Number.isFinite(outputPerMillionUsd) ||
        outputPerMillionUsd < 0
      ) {
        return undefined;
      }
      pricing[model] = { inputPerMillionUsd, outputPerMillionUsd };
    }
    return pricing;
  } catch {
    return undefined;
  }
}

export function estimateCoachCostUsd(
  usage: CoachTokenUsage,
  model: CoachModel = DEFAULT_COACH_MODEL
): number {
  const relayPricing = parseAiRelayPricingJson(
    process.env.AI_RELAY_PRICING_JSON
  )?.[model];
  const legacyEnvPrefix = LEGACY_COACH_MODEL_PRICE_ENV[model];
  const inputPerMillion = positiveNumber(
    relayPricing?.inputPerMillionUsd.toString() ??
      (legacyEnvPrefix
        ? process.env[`COACH_${legacyEnvPrefix}_INPUT_COST_PER_MILLION_USD`]
        : undefined) ??
      process.env.COACH_INPUT_COST_PER_MILLION_USD,
    100
  );
  const outputPerMillion = positiveNumber(
    relayPricing?.outputPerMillionUsd.toString() ??
      (legacyEnvPrefix
        ? process.env[`COACH_${legacyEnvPrefix}_OUTPUT_COST_PER_MILLION_USD`]
        : undefined) ??
      process.env.COACH_OUTPUT_COST_PER_MILLION_USD,
    200
  );
  return Number(
    (
      (usage.inputTokens * inputPerMillion +
        usage.outputTokens * outputPerMillion) /
      1_000_000
    ).toFixed(8)
  );
}
