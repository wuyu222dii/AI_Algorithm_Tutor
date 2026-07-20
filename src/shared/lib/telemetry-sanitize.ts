const MAX_PROPERTIES = 40;
const MAX_STRING_LENGTH = 500;
const SAFE_CODE_KEYS = new Set([
  'error_code',
  'status_code',
  'http_code',
  'result_code',
  'exit_code',
]);
const SENSITIVE_SEGMENTS = new Set([
  'authorization',
  'cookie',
  'email',
  'password',
  'secret',
  'token',
  'code',
  'prompt',
  'message',
  'content',
]);

function normalizedTelemetryKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}

export function isSensitiveTelemetryKey(value: string): boolean {
  const normalized = normalizedTelemetryKey(value);
  if (SAFE_CODE_KEYS.has(normalized)) return false;
  return normalized
    .split('_')
    .filter(Boolean)
    .some((segment) => SENSITIVE_SEGMENTS.has(segment));
}

export function sanitizeTelemetryText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-api-key]')
    .replace(/\b(code|token|secret|key|password)=[^&\s]+/gi, '$1=[redacted]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g,
      '[redacted-jwt]'
    )
    .slice(0, MAX_STRING_LENGTH);
}

function safeValue(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined;
  if (depth > 3) return '[truncated]';
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') return sanitizeTelemetryText(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => safeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    return sanitizeTelemetryProperties(
      value as Record<string, unknown>,
      depth + 1
    );
  }
  return sanitizeTelemetryText(String(value));
}

export function sanitizeTelemetryProperties(
  properties: Record<string, unknown>,
  depth = 0
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(
        ([key, value]) => value !== undefined && !isSensitiveTelemetryKey(key)
      )
      .slice(0, MAX_PROPERTIES)
      .map(([key, value]) => [key, safeValue(value, depth)])
  );
}
