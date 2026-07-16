import 'server-only';

import { md5 } from '@/shared/lib/hash';
import { recordOperationalEvent } from '@/shared/lib/observability';
import { isSafeRedisRestUrl } from '@/shared/lib/redis-url';

import {
  CoachProviderFailureKind,
  isCoachFailoverEligible,
  isCoachModelCircuitOpen,
  recordCoachModelFailure,
  recordCoachModelSuccess,
} from './model';

const RECORD_FAILURE_SCRIPT = [
  "local failures = tonumber(redis.call('INCR', KEYS[1]))",
  "redis.call('PEXPIRE', KEYS[1], ARGV[2])",
  'if failures >= tonumber(ARGV[1]) then',
  "  redis.call('SET', KEYS[2], '1', 'PX', ARGV[2])",
  '  return 1',
  'end',
  'return 0',
].join('\n');

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function redisConfiguration() {
  const url = process.env.REDIS_URL?.trim().replace(/\/$/, '');
  const token = process.env.REDIS_TOKEN?.trim();
  return url && token ? { url, token } : undefined;
}

function redisKeys(circuitKey: string) {
  const identity = md5(circuitKey);
  return {
    failures: `algocoach:relay-circuit:${identity}:failures`,
    open: `algocoach:relay-circuit:${identity}:open`,
  };
}

async function redisCommand(command: Array<string | number>) {
  const redis = redisConfiguration();
  if (!redis) return undefined;
  if (!isSafeRedisRestUrl(redis.url)) {
    throw new Error('REDIS_URL must be a secure Redis REST endpoint');
  }
  const response = await fetch(redis.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redis.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command.map(String)),
    cache: 'no-store',
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Redis returned ${response.status}`);
  const payload = (await response.json()) as { result?: unknown };
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Object.prototype.hasOwnProperty.call(payload, 'result')
  ) {
    throw new Error('Redis returned an invalid response envelope');
  }
  return payload.result;
}

async function reportRedisFailure(operation: string, error: unknown) {
  await recordOperationalEvent({
    event: 'coach_circuit_redis_failed',
    level: 'warn',
    properties: { operation },
    error,
  });
}

function redisExistsResult(value: unknown): boolean {
  if (value === 0 || value === '0') return false;
  if (value === 1 || value === '1') return true;
  throw new Error('Redis EXISTS returned an invalid result');
}

export async function isDistributedCoachCircuitOpen(
  circuitKey: string
): Promise<boolean> {
  if (isCoachModelCircuitOpen(circuitKey)) return true;
  if (!redisConfiguration()) return false;
  try {
    const keys = redisKeys(circuitKey);
    return redisExistsResult(await redisCommand(['EXISTS', keys.open]));
  } catch (error) {
    await reportRedisFailure('read', error);
    return process.env.NODE_ENV === 'production';
  }
}

export async function recordDistributedCoachModelSuccess(
  circuitKey: string
): Promise<void> {
  recordCoachModelSuccess(circuitKey);
  if (!redisConfiguration()) return;
  try {
    const keys = redisKeys(circuitKey);
    await redisCommand(['DEL', keys.failures, keys.open]);
  } catch (error) {
    await reportRedisFailure('reset', error);
  }
}

export async function recordDistributedCoachModelFailure(
  circuitKey: string,
  reason: CoachProviderFailureKind
): Promise<void> {
  recordCoachModelFailure(circuitKey, reason);
  if (!isCoachFailoverEligible(reason) || !redisConfiguration()) return;
  const threshold = positiveInteger(
    process.env.COACH_CIRCUIT_BREAKER_FAILURES,
    3
  );
  const durationMs = positiveInteger(
    process.env.COACH_CIRCUIT_BREAKER_DURATION_MS,
    60_000
  );
  try {
    const keys = redisKeys(circuitKey);
    await redisCommand([
      'EVAL',
      RECORD_FAILURE_SCRIPT,
      2,
      keys.failures,
      keys.open,
      threshold,
      durationMs,
    ]);
  } catch (error) {
    await reportRedisFailure('record_failure', error);
  }
}
