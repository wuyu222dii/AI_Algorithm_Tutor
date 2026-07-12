import { md5 } from '@/shared/lib/hash';

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

const MAX_RATE_LIMIT_ENTRIES = 10_000;

declare global {
  var __minIntervalRateLimitStore: Store | undefined;
  var __windowRateLimitStore: WindowStore | undefined;
}

function getClientIpFromRequest(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    // x-forwarded-for can be "client, proxy1, proxy2"
    return xff.split(',')[0]?.trim() || '';
  }

  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    ''
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
  const key = `${opts.keyPrefix || 'window'}|${request.method}|${url.pathname}|${identityKey}`;
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

  entry.count += 1;
  store.set(key, entry);
  return null;
}
