import type { CoachAction, CoachTokenUsage } from './types';

export const COACH_PROMPT_VERSION = 'coach-v1.3';
export const COACH_MODEL_WHITELIST = [
  'google/gemini-2.5-flash',
  'gpt-5.5',
  'openai/gpt-5.5',
  'anthropic/claude-4.5-sonnet',
] as const;
export const DEFAULT_COACH_MODEL = COACH_MODEL_WHITELIST[0];
export const DEFAULT_COACH_FALLBACK_MODEL = COACH_MODEL_WHITELIST[3];

export type CoachModel = (typeof COACH_MODEL_WHITELIST)[number];
export type CoachModelRoute = CoachAction | 'chat';
export type CoachProviderFailureKind =
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'invalid_output'
  | 'unknown';

export class CoachModelError extends Error {
  constructor(
    message: string,
    public readonly code: 'model_not_allowed' | 'provider_failed',
    public readonly reason: CoachProviderFailureKind = 'unknown',
    public readonly attempts = 0
  ) {
    super(message);
    this.name = 'CoachModelError';
  }
}

export function resolveCoachModel(model?: string): CoachModel {
  const candidate =
    model?.trim() ||
    process.env.ALGO_COACH_MODEL?.trim() ||
    DEFAULT_COACH_MODEL;
  if (!COACH_MODEL_WHITELIST.includes(candidate as CoachModel)) {
    throw new CoachModelError(
      `Model "${candidate}" is not allowed for the coach endpoint.`,
      'model_not_allowed'
    );
  }
  return candidate as CoachModel;
}

function actionEnvironmentName(route: CoachModelRoute, fallback = false) {
  const suffix = route === 'review_card' ? 'REVIEW_CARD' : route.toUpperCase();
  return `ALGO_COACH_${suffix}_${fallback ? 'FALLBACK_' : ''}MODEL`;
}

export function resolveCoachModelRoute(route: CoachModelRoute): {
  primary: CoachModel;
  fallback?: CoachModel;
} {
  const primary = resolveCoachModel(process.env[actionEnvironmentName(route)]);
  const configuredFallback =
    process.env[actionEnvironmentName(route, true)]?.trim() ||
    process.env.ALGO_COACH_FALLBACK_MODEL?.trim() ||
    DEFAULT_COACH_FALLBACK_MODEL;
  const fallback = resolveCoachModel(configuredFallback);
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

export function isCoachProviderAccessFailure(error: unknown): boolean {
  const status = statusCodeFromError(error);
  if (status === 401 || status === 403) return true;
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /invalid (?:api )?(?:key|token)|unauthori[sz]ed|forbidden|access denied|无权访问|权限不足|没有权限/i.test(
    message
  );
}

export function classifyCoachProviderError(
  error: unknown
): CoachProviderFailureKind {
  const status = statusCodeFromError(error);
  if (status === 429) return 'rate_limited';
  if (status && status >= 500) return 'unavailable';
  const name = error instanceof Error ? error.name : '';
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/abort|timeout|timed out|deadline/i.test(`${name} ${message}`)) {
    return 'timeout';
  }
  if (
    /no available channel|temporarily unavailable|service unavailable|overloaded|upstream.*(?:failed|error)/i.test(
      message
    )
  ) {
    return 'unavailable';
  }
  if (
    /schema|structured|parse|invalid json|no object generated/i.test(message)
  ) {
    return 'invalid_output';
  }
  return 'unknown';
}

export function isCoachFailoverEligible(
  reason: CoachProviderFailureKind
): boolean {
  return (
    reason === 'rate_limited' ||
    reason === 'unavailable' ||
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

const COACH_MODEL_PRICING: Record<
  CoachModel,
  { envPrefix: string; inputPerMillion: number; outputPerMillion: number }
> = {
  'google/gemini-2.5-flash': {
    envPrefix: 'GEMINI_2_5_FLASH',
    inputPerMillion: 2,
    outputPerMillion: 10,
  },
  'gpt-5.5': {
    envPrefix: 'GPT_5_5',
    inputPerMillion: 15,
    outputPerMillion: 75,
  },
  'openai/gpt-5.5': {
    envPrefix: 'GPT_5_5',
    inputPerMillion: 15,
    outputPerMillion: 75,
  },
  'anthropic/claude-4.5-sonnet': {
    envPrefix: 'CLAUDE_4_5_SONNET',
    inputPerMillion: 5,
    outputPerMillion: 25,
  },
};

export function estimateCoachCostUsd(
  usage: CoachTokenUsage,
  model: CoachModel = DEFAULT_COACH_MODEL
): number {
  const pricing = COACH_MODEL_PRICING[model];
  const inputPerMillion = positiveNumber(
    process.env[`COACH_${pricing.envPrefix}_INPUT_COST_PER_MILLION_USD`] ??
      process.env.COACH_INPUT_COST_PER_MILLION_USD,
    pricing.inputPerMillion
  );
  const outputPerMillion = positiveNumber(
    process.env[`COACH_${pricing.envPrefix}_OUTPUT_COST_PER_MILLION_USD`] ??
      process.env.COACH_OUTPUT_COST_PER_MILLION_USD,
    pricing.outputPerMillion
  );
  return Number(
    (
      (usage.inputTokens * inputPerMillion +
        usage.outputTokens * outputPerMillion) /
      1_000_000
    ).toFixed(8)
  );
}
