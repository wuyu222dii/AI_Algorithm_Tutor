import { md5 } from '@/shared/lib/hash';
import { recordOperationalEvent } from '@/shared/lib/observability';

type MinIntervalOptions = {
  /**
   * Minimum interval between requests for the same key.
   */
  intervalMs: number;
  /**
   * Optional namespace to avoid key collisions across endpoints.
   */
  keyPrefix?: string;
  /**
   * Extra key material if you want to scope more granularly.
   */
  extraKey?: string;
};

type Store = Map<string, number>;
type WindowStore = Map<
  string,
  {
    count: number;
    resetAt: number;
  }
>;

export type WindowRateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  extraKey?: string;
  identity?: 'source' | 'extra' | 'source-and-extra';
};

export type DistributedRateLimitOptions = WindowRateLimitOptions & {
  /** Return 503 instead of using the process-local fallback when Redis fails. */
  failClosed?: boolean;
};

type RedisWindowResult = {
  count: number;
  ttlMs: number;
};

const MAX_RATE_LIMIT_ENTRIES = 10_000;

declare global {
  var __minIntervalRateLimitStore: Store | undefined;
  var __windowRateLimitStore: WindowStore | undefined;
}

const SUPPORTED_PROXY_HEADERS = new Set([
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-real-ip',
]);

function trustedProxyHeaders(): string[] {
  const configured = process.env.TRUSTED_PROXY_HEADERS;
  if (!configured && process.env.NODE_ENV !== 'production') {
    return ['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip'];
  }
  return (configured ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => SUPPORTED_PROXY_HEADERS.has(value));
}

function getClientIpFromRequest(request: Request): string {
  for (const header of trustedProxyHeaders()) {
    const raw = request.headers.get(header);
    if (!raw) continue;
    // A trusted edge must overwrite this header. The left-most value is the
    // original client address in the conventional X-Forwarded-For format.
    const value = raw.split(',')[0]?.trim();
    if (value) return value.slice(0, 64);
  }
  return '';
}

function buildWindowIdentity(
  request: Request,
  opts: WindowRateLimitOptions
): string {
  const url = new URL(request.url);
  const identity = opts.identity ?? 'source-and-extra';
  const source = getClientIpFromRequest(request) || 'unknown-source';
  const extra = opts.extraKey || 'no-extra';
  const identityKey =
    identity === 'source'
      ? source
      : identity === 'extra'
        ? extra
        : `${source}|${extra}`;
  return `${opts.keyPrefix || 'window'}|${request.method}|${url.pathname}|${identityKey}`;
}

function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    {
      error: 'too_many_requests',
      message: `Please retry after ${retryAfterSeconds}s.`,
    },
    {
      status: 429,
      headers: {
        'cache-control': 'no-store',
        'retry-after': String(retryAfterSeconds),
      },
    }
  );
}

function getStore(): Store {
  if (!globalThis.__minIntervalRateLimitStore) {
    globalThis.__minIntervalRateLimitStore = new Map();
  }
  return globalThis.__minIntervalRateLimitStore;
}

function getWindowStore(): WindowStore {
  if (!globalThis.__windowRateLimitStore) {
    globalThis.__windowRateLimitStore = new Map();
  }
  return globalThis.__windowRateLimitStore;
}

function pruneWindowStore(store: WindowStore, now: number) {
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }

  if (store.size < MAX_RATE_LIMIT_ENTRIES) return;
  const overflow = store.size - MAX_RATE_LIMIT_ENTRIES + 1;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function buildKey(request: Request, opts: MinIntervalOptions): string {
  const url = new URL(request.url);
  const ip = getClientIpFromRequest(request);
  const cookie = request.headers.get('cookie') || '';
  const cookieHash = cookie ? md5(cookie) : 'no-cookie';
  const prefix = opts.keyPrefix || 'min-interval';
  const extra = opts.extraKey ? `|${opts.extraKey}` : '';
  return `${prefix}|${request.method}|${url.pathname}|${ip}|${cookieHash}${extra}`;
}

/**
 * Enforce a minimum interval for the same endpoint + identity.
 *
 * Returns a 429 Response when the request is too frequent, otherwise null.
 */
export function enforceMinIntervalRateLimit(
  request: Request,
  opts: MinIntervalOptions
): Response | null {
  const intervalMs = Math.max(0, Number(opts.intervalMs) || 0);
  if (!intervalMs) return null;

  const now = Date.now();
  const store = getStore();
  const key = buildKey(request, opts);
  const last = store.get(key);

  if (typeof last === 'number') {
    const delta = now - last;
    if (delta >= 0 && delta < intervalMs) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((intervalMs - delta) / 1000)
      );
      return tooManyRequests(retryAfterSeconds);
    }
  }

  if (store.size >= MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (typeof oldestKey === 'string') store.delete(oldestKey);
  }
  store.set(key, now);
  return null;
}

/**
 * Bounded in-memory fixed-window limiter for authentication mutations.
 * Account rules should use `extra`; source rules should use `source`.
 */
export function enforceWindowRateLimit(
  request: Request,
  opts: WindowRateLimitOptions
): Response | null {
  const windowMs = Math.max(1_000, Number(opts.windowMs) || 0);
  const max = Math.max(1, Math.floor(Number(opts.max) || 0));
  if (!windowMs || !max) return null;

  const now = Date.now();
  const store = getWindowStore();
  pruneWindowStore(store, now);

  const key = buildWindowIdentity(request, opts);
  const current = store.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

  if (entry.count >= max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - now) / 1000)
    );
    return tooManyRequests(retryAfterSeconds);
  }

  entry.count += 1;
  store.set(key, entry);
  return null;
}

const REDIS_WINDOW_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "local ttl = redis.call('PTTL', KEYS[1])",
  'return {count, ttl}',
].join('\n');

async function incrementRedisWindow(
  key: string,
  windowMs: number
): Promise<RedisWindowResult | null> {
  const redisUrl = process.env.REDIS_URL?.trim().replace(/\/$/, '');
  const redisToken = process.env.REDIS_TOKEN?.trim();
  if (!redisUrl || !redisToken) return null;
  if (!redisUrl.startsWith('https://') && !redisUrl.startsWith('http://')) {
    throw new Error('REDIS_URL must be an HTTP Redis REST endpoint');
  }

  const response = await fetch(redisUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify([
      'EVAL',
      REDIS_WINDOW_SCRIPT,
      '1',
      `algocoach:ratelimit:${md5(key)}`,
      String(windowMs),
    ]),
    cache: 'no-store',
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new Error(`Redis returned ${response.status}`);
  }
  const payload = (await response.json()) as { result?: unknown };
  if (
    !Array.isArray(payload.result) ||
    payload.result.length < 2 ||
    !Number.isFinite(Number(payload.result[0]))
  ) {
    throw new Error('Redis returned an invalid rate-limit result');
  }
  return {
    count: Number(payload.result[0]),
    ttlMs: Math.max(1, Number(payload.result[1]) || windowMs),
  };
}

/**
 * Shared fixed-window limiter backed by a Redis REST endpoint when configured.
 * Local development falls back to the bounded in-memory implementation.
 */
export async function enforceDistributedWindowRateLimit(
  request: Request,
  opts: DistributedRateLimitOptions
): Promise<Response | null> {
  const windowMs = Math.max(1_000, Number(opts.windowMs) || 0);
  const max = Math.max(1, Math.floor(Number(opts.max) || 0));
  const key = buildWindowIdentity(request, opts);

  try {
    const result = await incrementRedisWindow(key, windowMs);
    if (!result) return enforceWindowRateLimit(request, opts);
    if (result.count <= max) return null;
    return tooManyRequests(Math.max(1, Math.ceil(result.ttlMs / 1000)));
  } catch (error) {
    await recordOperationalEvent({
      event: 'rate_limit_backend_failed',
      level: 'error',
      error,
    });
    if (!opts.failClosed) return enforceWindowRateLimit(request, opts);
    return Response.json(
      {
        error: 'rate_limit_unavailable',
        message: 'Request protection is temporarily unavailable.',
      },
      {
        status: 503,
        headers: { 'cache-control': 'no-store', 'retry-after': '5' },
      }
    );
  }
}
