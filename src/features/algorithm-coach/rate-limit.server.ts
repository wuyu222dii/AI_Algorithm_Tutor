import 'server-only';

import { getAuth } from '@/core/auth';
import { md5 } from '@/shared/lib/hash';
import { recordOperationalEvent } from '@/shared/lib/observability';
import { enforceDistributedWindowRateLimit } from '@/shared/lib/rate-limit';
import { resolveRedisRestConfiguration } from '@/shared/lib/redis-rest';
import { isSafeRedisRestUrl } from '@/shared/lib/redis-url';

import { CoachModel, estimateCoachCostUsd } from './model';
import type { CoachTokenUsage } from './types';

type CoachRateLimitSurface = 'artifact' | 'chat' | 'state';
type CoachGenerationSurface = Exclude<CoachRateLimitSurface, 'state'>;

type CoachCapacityReservation = {
  id: string;
  identity: string;
  backend: 'redis' | 'memory';
  reservedTokens: number;
  reservedCostMicroUsd: number;
  reservedAttempts: number;
  budgetDay: string;
  expiresAt: number;
};

export interface CoachCapacityLease {
  reservations: CoachCapacityReservation[];
  settled: boolean;
}

export interface CoachCapacitySettlement {
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface CoachCapacityBudget {
  models: CoachModel[];
  input: unknown;
  maxOutputTokens: number;
  maxAttempts: number;
}

type MemoryCapacityEntry = {
  day: string;
  concurrent: number;
  tokens: number;
  costMicroUsd: number;
  leases: Map<
    string,
    { expiresAt: number; tokens: number; costMicroUsd: number }
  >;
};

declare global {
  var __coachCapacityStore: Map<string, MemoryCapacityEntry> | undefined;
}

async function requestIdentity(request: Request) {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user?.id) {
      return { key: `user:${md5(session.user.id)}`, authenticated: true };
    }
  } catch {
    // Missing auth/database configuration keeps local demo traffic as a guest.
  }
  const cookie = request.headers.get('cookie') || '';
  const guestId = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('algocoach_guest_id='))
    ?.slice('algocoach_guest_id='.length);
  const fallbackIdentity = [
    cookie,
    trustedRequestSource(request),
    request.headers.get('user-agent') ?? '',
    request.headers.get('accept-language') ?? '',
  ].join('|');
  return {
    key: `guest:${md5(guestId || fallbackIdentity || 'anonymous')}`,
    authenticated: false,
  };
}

const CAPACITY_PROXY_HEADERS = new Set([
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-real-ip',
]);

function trustedCapacityProxyHeaders() {
  const configured = process.env.TRUSTED_PROXY_HEADERS;
  if (!configured && process.env.NODE_ENV !== 'production') {
    return ['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip'];
  }
  return (configured ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter((header) => CAPACITY_PROXY_HEADERS.has(header));
}

function trustedRequestSource(request: Request) {
  for (const header of trustedCapacityProxyHeaders()) {
    const value = request.headers.get(header)?.split(',')[0]?.trim();
    if (value) return value.slice(0, 64);
  }
  return '';
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function capacityStore() {
  if (!globalThis.__coachCapacityStore) {
    globalThis.__coachCapacityStore = new Map();
  }
  return globalThis.__coachCapacityStore;
}

function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function millisecondsUntilNextUtcDay(now = new Date()) {
  return (
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) -
    now.getTime()
  );
}

function capacityResponse(
  code:
    | 'coach_concurrency_limit'
    | 'coach_daily_budget_exceeded'
    | 'rate_limit_unavailable',
  status: 429 | 503,
  retryAfterSeconds: number
) {
  const message =
    code === 'coach_concurrency_limit'
      ? 'Too many coach generations are already running.'
      : code === 'coach_daily_budget_exceeded'
        ? 'The daily AI usage budget has been reached.'
        : 'Request protection is temporarily unavailable.';
  return Response.json(
    { error: code, message },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))),
      },
    }
  );
}

function redisConfiguration() {
  return resolveRedisRestConfiguration();
}

async function redisEval(
  script: string,
  keys: string[],
  args: Array<string | number>
): Promise<unknown> {
  const redis = redisConfiguration();
  if (!redis) throw new Error('Redis is not configured');
  if (!isSafeRedisRestUrl(redis.url)) {
    throw new Error('REDIS_URL must be a secure Redis REST endpoint');
  }
  const response = await fetch(redis.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redis.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify([
      'EVAL',
      script,
      String(keys.length),
      ...keys,
      ...args.map(String),
    ]),
    cache: 'no-store',
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Redis returned ${response.status}`);
  const payload = (await response.json()) as { result?: unknown };
  return payload.result;
}

const ACQUIRE_CAPACITY_SCRIPT = [
  "local concurrent = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "if concurrent >= tonumber(ARGV[1]) then return {1, redis.call('PTTL', KEYS[1])} end",
  "local tokens = tonumber(redis.call('GET', KEYS[2]) or '0')",
  "local cost = tonumber(redis.call('GET', KEYS[3]) or '0')",
  'if tokens + tonumber(ARGV[2]) > tonumber(ARGV[4]) or cost + tonumber(ARGV[3]) > tonumber(ARGV[5]) then return {2, tonumber(ARGV[7])} end',
  "local lease = redis.call('SET', KEYS[4], ARGV[2] .. ':' .. ARGV[3], 'PX', ARGV[6], 'NX')",
  'if not lease then return {1, tonumber(ARGV[6])} end',
  "redis.call('INCR', KEYS[1])",
  "redis.call('PEXPIRE', KEYS[1], ARGV[6])",
  "redis.call('INCRBY', KEYS[2], ARGV[2])",
  "redis.call('PEXPIRE', KEYS[2], ARGV[7])",
  "redis.call('INCRBY', KEYS[3], ARGV[3])",
  "redis.call('PEXPIRE', KEYS[3], ARGV[7])",
  'return {0, tonumber(ARGV[6])}',
].join('\n');

const SETTLE_CAPACITY_SCRIPT = [
  "local reservation = redis.call('GET', KEYS[4])",
  'if not reservation then return 0 end',
  "redis.call('DEL', KEYS[4])",
  "local concurrent = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "if concurrent > 0 then redis.call('DECR', KEYS[1]) end",
  "local separator = string.find(reservation, ':')",
  'local reservedTokens = tonumber(string.sub(reservation, 1, separator - 1))',
  'local reservedCost = tonumber(string.sub(reservation, separator + 1))',
  'local tokenDelta = tonumber(ARGV[1]) - reservedTokens',
  'local costDelta = tonumber(ARGV[2]) - reservedCost',
  "redis.call('INCRBY', KEYS[2], tokenDelta)",
  "redis.call('INCRBY', KEYS[3], costDelta)",
  'return 1',
].join('\n');

function capacityOptions(
  surface: CoachGenerationSurface,
  authenticated: boolean,
  ipGuard = false,
  budget?: CoachCapacityBudget
) {
  const configuredReservedTokens = positiveInteger(
    surface === 'chat'
      ? process.env.COACH_CHAT_RESERVED_TOKENS
      : process.env.COACH_ARTIFACT_RESERVED_TOKENS,
    surface === 'chat' ? 1_000 : 1_800
  );
  let serializedInput = '';
  try {
    serializedInput = JSON.stringify(budget?.input ?? '');
  } catch {
    serializedInput = String(budget?.input ?? '');
  }
  // One UTF-16 code unit per token plus prompt overhead deliberately
  // overestimates normal source code while remaining safe for CJK text.
  const estimatedInputTokens = budget
    ? Math.max(800, serializedInput.length + 800)
    : 0;
  const maxOutputTokens = budget
    ? Math.max(1, Math.round(budget.maxOutputTokens))
    : 0;
  const reservedAttempts = budget
    ? Math.max(1, Math.round(budget.maxAttempts))
    : 1;
  const reservedTokens =
    Math.max(configuredReservedTokens, estimatedInputTokens + maxOutputTokens) *
    reservedAttempts;
  const projectedCostUsd = budget?.models.length
    ? Math.max(
        ...budget.models.map((model) =>
          estimateCoachCostUsd(
            {
              inputTokens: estimatedInputTokens,
              outputTokens: maxOutputTokens,
              totalTokens: estimatedInputTokens + maxOutputTokens,
            },
            model
          )
        )
      ) *
      reservedAttempts *
      1.1
    : 0;
  const configuredReservedCostUsd = positiveNumber(
    surface === 'chat'
      ? process.env.COACH_CHAT_RESERVED_COST_USD
      : process.env.COACH_ARTIFACT_RESERVED_COST_USD,
    surface === 'chat' ? 0.008 : 0.01
  );
  const reservedCostUsd = Math.max(configuredReservedCostUsd, projectedCostUsd);
  return {
    maxConcurrent: positiveInteger(
      ipGuard
        ? process.env.COACH_IP_MAX_CONCURRENCY
        : process.env.COACH_MAX_CONCURRENCY,
      ipGuard ? 6 : 2
    ),
    maxDailyTokens: positiveInteger(
      ipGuard
        ? process.env.COACH_IP_DAILY_TOKENS
        : authenticated
          ? process.env.COACH_AUTHENTICATED_DAILY_TOKENS
          : process.env.COACH_GUEST_DAILY_TOKENS,
      ipGuard ? 400_000 : authenticated ? 200_000 : 40_000
    ),
    maxDailyCostMicroUsd: Math.round(
      positiveNumber(
        ipGuard
          ? process.env.COACH_IP_DAILY_COST_USD
          : authenticated
            ? process.env.COACH_AUTHENTICATED_DAILY_COST_USD
            : process.env.COACH_GUEST_DAILY_COST_USD,
        ipGuard ? 0.2 : 0.05
      ) * 1_000_000
    ),
    reservedTokens,
    reservedCostMicroUsd: Math.round(reservedCostUsd * 1_000_000),
    reservedAttempts,
    leaseMs: positiveInteger(
      process.env.COACH_GENERATION_LEASE_MS,
      surface === 'chat' ? 60_000 : 30_000
    ),
  };
}

function acquireMemoryCapacity(
  identity: string,
  options: ReturnType<typeof capacityOptions>
): CoachCapacityReservation | Response {
  const now = Date.now();
  const day = utcDay();
  const store = capacityStore();
  const current = store.get(identity);
  const entry: MemoryCapacityEntry =
    !current || current.day !== day
      ? {
          day,
          concurrent: 0,
          tokens: 0,
          costMicroUsd: 0,
          leases: new Map(),
        }
      : current;
  for (const [id, lease] of entry.leases) {
    if (lease.expiresAt > now) continue;
    entry.leases.delete(id);
    entry.concurrent = Math.max(0, entry.concurrent - 1);
  }
  if (entry.concurrent >= options.maxConcurrent) {
    return capacityResponse('coach_concurrency_limit', 429, 2);
  }
  if (
    entry.tokens + options.reservedTokens > options.maxDailyTokens ||
    entry.costMicroUsd + options.reservedCostMicroUsd >
      options.maxDailyCostMicroUsd
  ) {
    return capacityResponse(
      'coach_daily_budget_exceeded',
      429,
      millisecondsUntilNextUtcDay() / 1000
    );
  }
  const id = crypto.randomUUID();
  const expiresAt = now + options.leaseMs;
  entry.concurrent += 1;
  entry.tokens += options.reservedTokens;
  entry.costMicroUsd += options.reservedCostMicroUsd;
  entry.leases.set(id, {
    expiresAt,
    tokens: options.reservedTokens,
    costMicroUsd: options.reservedCostMicroUsd,
  });
  store.set(identity, entry);
  return {
    id,
    identity,
    backend: 'memory',
    reservedTokens: options.reservedTokens,
    reservedCostMicroUsd: options.reservedCostMicroUsd,
    reservedAttempts: options.reservedAttempts,
    budgetDay: day,
    expiresAt,
  };
}

async function acquireRedisCapacity(
  identity: string,
  options: ReturnType<typeof capacityOptions>
): Promise<CoachCapacityReservation | Response> {
  const id = crypto.randomUUID();
  const prefix = `algocoach:capacity:${md5(identity)}`;
  const day = utcDay();
  const dayTtlMs = millisecondsUntilNextUtcDay() + 60 * 60 * 1000;
  const keys = [
    `${prefix}:concurrent`,
    `${prefix}:${day}:tokens`,
    `${prefix}:${day}:cost`,
    `${prefix}:lease:${id}`,
  ];
  const result = await redisEval(ACQUIRE_CAPACITY_SCRIPT, keys, [
    options.maxConcurrent,
    options.reservedTokens,
    options.reservedCostMicroUsd,
    options.maxDailyTokens,
    options.maxDailyCostMicroUsd,
    options.leaseMs,
    dayTtlMs,
  ]);
  if (!Array.isArray(result)) throw new Error('Invalid Redis capacity result');
  const status = Number(result[0]);
  if (status === 1) {
    return capacityResponse(
      'coach_concurrency_limit',
      429,
      Math.max(1, Number(result[1]) || 1) / 1000
    );
  }
  if (status === 2) {
    return capacityResponse(
      'coach_daily_budget_exceeded',
      429,
      Math.max(1, Number(result[1]) || dayTtlMs) / 1000
    );
  }
  if (status !== 0) throw new Error('Unknown Redis capacity result');
  return {
    id,
    identity,
    backend: 'redis',
    reservedTokens: options.reservedTokens,
    reservedCostMicroUsd: options.reservedCostMicroUsd,
    reservedAttempts: options.reservedAttempts,
    budgetDay: day,
    expiresAt: Date.now() + options.leaseMs,
  };
}

async function acquireCapacityReservation(
  identity: string,
  options: ReturnType<typeof capacityOptions>
) {
  if (!redisConfiguration()) {
    if (process.env.NODE_ENV === 'production') {
      void recordOperationalEvent({
        event: 'coach_capacity_backend_failed',
        level: 'error',
        properties: { reason: 'not_configured' },
      });
      return capacityResponse('rate_limit_unavailable', 503, 5);
    }
    return acquireMemoryCapacity(identity, options);
  }
  try {
    return await acquireRedisCapacity(identity, options);
  } catch (error) {
    void recordOperationalEvent({
      event: 'coach_capacity_backend_failed',
      level: process.env.NODE_ENV === 'production' ? 'error' : 'warn',
      properties: { reason: 'request_failed' },
      error,
    });
    if (process.env.NODE_ENV === 'production') {
      return capacityResponse('rate_limit_unavailable', 503, 5);
    }
    return acquireMemoryCapacity(identity, options);
  }
}

/**
 * Atomically reserves concurrent capacity and a conservative token/cost budget.
 * Production never falls back to a process-local store.
 */
export async function acquireCoachCapacity(
  request: Request,
  surface: CoachGenerationSurface,
  authenticatedUserId?: string,
  budget?: CoachCapacityBudget
): Promise<CoachCapacityLease | Response> {
  const identity = authenticatedUserId
    ? { key: `user:${md5(authenticatedUserId)}`, authenticated: true }
    : await requestIdentity(request);
  const sources = [
    {
      key: identity.key,
      options: capacityOptions(surface, identity.authenticated, false, budget),
    },
  ];
  const source = trustedRequestSource(request);
  if (source) {
    sources.push({
      key: `ip:${md5(source)}`,
      options: capacityOptions(surface, false, true, budget),
    });
  }

  const reservations: CoachCapacityReservation[] = [];
  for (const item of sources) {
    const reservation = await acquireCapacityReservation(
      item.key,
      item.options
    );
    if (reservation instanceof Response) {
      for (const acquired of reservations) {
        await settleCapacityReservation(acquired, 0, 0);
      }
      return reservation;
    }
    reservations.push(reservation);
  }
  return { reservations, settled: false };
}

function memorySettle(
  lease: CoachCapacityReservation,
  actualTokens: number,
  actualCostMicroUsd: number
) {
  const entry = capacityStore().get(lease.identity);
  const reservation = entry?.leases.get(lease.id);
  if (!entry || !reservation) return;
  entry.leases.delete(lease.id);
  entry.concurrent = Math.max(0, entry.concurrent - 1);
  entry.tokens = Math.max(0, entry.tokens + actualTokens - reservation.tokens);
  entry.costMicroUsd = Math.max(
    0,
    entry.costMicroUsd + actualCostMicroUsd - reservation.costMicroUsd
  );
}

async function redisSettle(
  lease: CoachCapacityReservation,
  actualTokens: number,
  actualCostMicroUsd: number
) {
  const prefix = `algocoach:capacity:${md5(lease.identity)}`;
  await redisEval(
    SETTLE_CAPACITY_SCRIPT,
    [
      `${prefix}:concurrent`,
      `${prefix}:${lease.budgetDay}:tokens`,
      `${prefix}:${lease.budgetDay}:cost`,
      `${prefix}:lease:${lease.id}`,
    ],
    [actualTokens, actualCostMicroUsd]
  );
}

async function settleCapacityReservation(
  lease: CoachCapacityReservation,
  actualTokens: number,
  actualCostMicroUsd: number
) {
  if (lease.backend === 'memory') {
    memorySettle(lease, actualTokens, actualCostMicroUsd);
    return;
  }
  try {
    await redisSettle(lease, actualTokens, actualCostMicroUsd);
  } catch {
    // The lease and concurrency key expire automatically; keep the reserved
    // daily budget when settlement cannot be confirmed.
  }
}

async function settleCoachCapacity(
  lease: CoachCapacityLease,
  actualTokens: number,
  actualCostMicroUsd: number
) {
  if (lease.settled) return;
  lease.settled = true;
  await Promise.all(
    lease.reservations.map((reservation) =>
      settleCapacityReservation(reservation, actualTokens, actualCostMicroUsd)
    )
  );
}

export async function commitCoachUsage(
  lease: CoachCapacityLease,
  usage: CoachTokenUsage,
  estimatedCostUsd: number,
  attempts = 1
): Promise<CoachCapacitySettlement> {
  const extraAttempts = Math.max(0, Math.floor(attempts) - 1);
  const baseline = lease.reservations[0];
  const reservedAttempts = baseline?.reservedAttempts ?? 1;
  const totalTokens =
    Math.max(0, Math.round(usage.totalTokens)) +
    extraAttempts *
      Math.ceil((baseline?.reservedTokens ?? 0) / reservedAttempts);
  const costMicroUsd =
    Math.max(0, Math.round(estimatedCostUsd * 1_000_000)) +
    extraAttempts *
      Math.ceil((baseline?.reservedCostMicroUsd ?? 0) / reservedAttempts);
  await settleCoachCapacity(lease, totalTokens, costMicroUsd);
  return { totalTokens, estimatedCostUsd: costMicroUsd / 1_000_000 };
}

export async function commitCoachFailedUsage(
  lease: CoachCapacityLease,
  attempts = 1
): Promise<CoachCapacitySettlement> {
  const baseline = lease.reservations[0];
  const safeAttempts = Math.max(0, Math.floor(attempts));
  const reservedAttempts = baseline?.reservedAttempts ?? 1;
  const totalTokens =
    safeAttempts *
    Math.ceil((baseline?.reservedTokens ?? 0) / reservedAttempts);
  const costMicroUsd =
    safeAttempts *
    Math.ceil((baseline?.reservedCostMicroUsd ?? 0) / reservedAttempts);
  await settleCoachCapacity(lease, totalTokens, costMicroUsd);
  return { totalTokens, estimatedCostUsd: costMicroUsd / 1_000_000 };
}

/** Keep the admission reservation when a successful relay omits trustworthy usage. */
export async function commitCoachConservativeUsage(
  lease: CoachCapacityLease,
  attempts = 1
): Promise<CoachCapacitySettlement> {
  return commitCoachFailedUsage(lease, attempts);
}

export async function releaseCoachCapacity(lease: CoachCapacityLease) {
  await settleCoachCapacity(lease, 0, 0);
}

export async function enforceCoachRateLimits(
  request: Request,
  surface: CoachRateLimitSurface,
  authenticatedUserId?: string
): Promise<Response | null> {
  const identity = authenticatedUserId
    ? { key: `user:${md5(authenticatedUserId)}`, authenticated: true }
    : await requestIdentity(request);
  const failClosed = process.env.NODE_ENV === 'production';
  const burstMax = positiveInteger(
    process.env.COACH_RATE_LIMIT_PER_MINUTE,
    surface === 'chat' ? 12 : surface === 'state' ? 120 : 20
  );
  const burst = await enforceDistributedWindowRateLimit(request, {
    windowMs: 60_000,
    max: burstMax,
    keyPrefix: `coach-${surface}-burst`,
    extraKey: identity.key,
    identity: 'source-and-extra',
    failClosed,
  });
  if (burst) return burst;

  if (surface === 'state') return null;
  const concurrencyApproximation = await enforceDistributedWindowRateLimit(
    request,
    {
      windowMs: 10_000,
      max: positiveInteger(
        process.env.COACH_RATE_LIMIT_PER_10_SECONDS,
        surface === 'chat' ? 3 : 5
      ),
      keyPrefix: `coach-${surface}-concurrency`,
      extraKey: identity.key,
      identity: 'extra',
      failClosed,
    }
  );
  if (concurrencyApproximation) return concurrencyApproximation;

  return enforceDistributedWindowRateLimit(request, {
    windowMs: 24 * 60 * 60 * 1000,
    max: positiveInteger(
      identity.authenticated
        ? process.env.COACH_AUTHENTICATED_DAILY_REQUESTS
        : process.env.COACH_GUEST_DAILY_REQUESTS,
      identity.authenticated ? 200 : 40
    ),
    keyPrefix: `coach-${surface}-daily`,
    extraKey: identity.key,
    identity: 'extra',
    failClosed,
  });
}
