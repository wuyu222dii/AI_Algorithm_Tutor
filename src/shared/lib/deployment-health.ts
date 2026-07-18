export type DeploymentHealthCheckName = 'live' | 'ready' | 'ai-relay';

export interface DeploymentHealthCheckResult {
  name: DeploymentHealthCheckName;
  status: 'ok' | 'error';
  latencyMs: number;
  httpStatus?: number;
  code?: string;
  remoteCode?: string;
}

export interface DeploymentHealthReport {
  status: 'ok' | 'error';
  origin: string;
  checkedAt: string;
  checks: DeploymentHealthCheckResult[];
  failedCheck?: DeploymentHealthCheckName;
}

export interface DeploymentHealthOptions {
  baseUrl: string;
  canaryToken: string;
  vercelProtectionBypass?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export class DeploymentHealthConfigurationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'DeploymentHealthConfigurationError';
  }
}

const MAX_RESPONSE_BYTES = 16 * 1024;

function deploymentOrigin(rawValue: string): URL {
  const raw = rawValue.trim();
  if (!raw) throw new DeploymentHealthConfigurationError('base_url_missing');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DeploymentHealthConfigurationError('base_url_invalid');
  }

  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new DeploymentHealthConfigurationError('base_url_must_use_https');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new DeploymentHealthConfigurationError('base_url_must_be_origin');
  }
  return new URL(url.origin);
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 10_000;
  if (!Number.isInteger(value) || value < 500 || value > 30_000) {
    throw new DeploymentHealthConfigurationError('timeout_invalid');
  }
  return value;
}

function validateCanaryToken(value: string): string {
  const token = value.trim();
  if (token.length < 32) {
    throw new DeploymentHealthConfigurationError('canary_token_invalid');
  }
  return token;
}

function safeRemoteCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)
    ? value
    : undefined;
}

async function responsePayload(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    return undefined;
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function matchesExpectedPayload(
  name: DeploymentHealthCheckName,
  payload: unknown
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as { status?: unknown; kind?: unknown };
  if (candidate.status !== 'ok') return false;
  if (name === 'live') return candidate.kind === 'live';
  if (name === 'ready') return candidate.kind === 'ready';
  return true;
}

function isTimeoutError(error: unknown, depth = 0): boolean {
  if (depth > 3 || !error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  return (
    candidate.name === 'AbortError' ||
    candidate.name === 'TimeoutError' ||
    (typeof candidate.message === 'string' &&
      /abort|timeout|timed out|deadline/i.test(candidate.message)) ||
    isTimeoutError(candidate.cause, depth + 1)
  );
}

async function runCheck(
  fetcher: typeof fetch,
  origin: URL,
  name: DeploymentHealthCheckName,
  timeoutMs: number,
  canaryToken: string,
  vercelProtectionBypass?: string
): Promise<DeploymentHealthCheckResult> {
  const startedAt = performance.now();
  const isCanary = name === 'ai-relay';
  try {
    const requestHeaders: Record<string, string> = {};
    if (vercelProtectionBypass) {
      requestHeaders['x-vercel-protection-bypass'] = vercelProtectionBypass;
    }
    if (isCanary) requestHeaders.authorization = `Bearer ${canaryToken}`;
    const response = await fetcher(
      new URL(
        name === 'live'
          ? '/api/health/live'
          : name === 'ready'
            ? '/api/health/ready'
            : '/api/health/ai-relay',
        origin
      ),
      {
        method: isCanary ? 'POST' : 'GET',
        headers: Object.keys(requestHeaders).length
          ? requestHeaders
          : undefined,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const payload = await responsePayload(response);
    const remoteCode =
      payload && typeof payload === 'object'
        ? safeRemoteCode((payload as { code?: unknown }).code)
        : undefined;
    if (!response.ok) {
      return {
        name,
        status: 'error',
        latencyMs,
        httpStatus: response.status,
        code: 'http_error',
        ...(remoteCode ? { remoteCode } : {}),
      };
    }
    if (!matchesExpectedPayload(name, payload)) {
      return {
        name,
        status: 'error',
        latencyMs,
        httpStatus: response.status,
        code: 'invalid_response',
      };
    }
    return {
      name,
      status: 'ok',
      latencyMs,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      name,
      status: 'error',
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      code: isTimeoutError(error) ? 'timeout' : 'network_error',
    };
  }
}

/**
 * Checks the deployed application in dependency order. The canary credential is
 * sent only to the fixed same-origin AI endpoint and is never returned.
 */
export async function checkDeploymentHealth(
  options: DeploymentHealthOptions
): Promise<DeploymentHealthReport> {
  const origin = deploymentOrigin(options.baseUrl);
  const canaryToken = validateCanaryToken(options.canaryToken);
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const fetcher = options.fetcher ?? globalThis.fetch;
  const checks: DeploymentHealthCheckResult[] = [];

  for (const name of ['live', 'ready', 'ai-relay'] as const) {
    const result = await runCheck(
      fetcher,
      origin,
      name,
      timeoutMs,
      canaryToken,
      options.vercelProtectionBypass?.trim() || undefined
    );
    checks.push(result);
    if (result.status === 'error') {
      return {
        status: 'error',
        origin: origin.origin,
        checkedAt: (options.now?.() ?? new Date()).toISOString(),
        checks,
        failedCheck: name,
      };
    }
  }

  return {
    status: 'ok',
    origin: origin.origin,
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
    checks,
  };
}
