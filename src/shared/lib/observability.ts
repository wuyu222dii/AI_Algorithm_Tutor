import type { OperationalEvent } from '@/shared/types/observability';

const SENSITIVE_KEY =
  /authorization|cookie|email|password|secret|token|code|prompt|message|content/i;
const MAX_PROPERTIES = 40;
const MAX_STRING_LENGTH = 500;

export function sanitizeTelemetryText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(code|token|secret|key|password)=[^&\s]+/gi, '$1=[redacted]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g,
      '[redacted-jwt]'
    )
    .slice(0, MAX_STRING_LENGTH);
}

function safeValue(value: unknown, depth = 0): unknown {
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
    return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
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
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .slice(0, MAX_PROPERTIES)
      .map(([key, value]) => [key, safeValue(value, depth)])
  );
}

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  return {
    name: error.name,
    message: sanitizeTelemetryText(error.message),
    stack: error.stack
      ? sanitizeTelemetryText(error.stack.split('\n').slice(0, 8).join('\n'))
      : undefined,
  };
}

function otlpBody(record: Record<string, unknown>) {
  const attributes = Object.entries(record)
    .filter(([key]) => !['timestamp', 'level', 'event'].includes(key))
    .map(([key, value]) => ({
      key,
      value: {
        stringValue: typeof value === 'string' ? value : JSON.stringify(value),
      },
    }));
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'algocoach' } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'algocoach.operational-events' },
            logRecords: [
              {
                timeUnixNano: `${Date.now()}000000`,
                severityText: String(record.level ?? 'info').toUpperCase(),
                body: { stringValue: String(record.event) },
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };
}

async function exportOtlp(record: Record<string, unknown>) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim();
  if (!endpoint) return;
  await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? { authorization: process.env.OTEL_EXPORTER_OTLP_HEADERS }
        : {}),
    },
    body: JSON.stringify(otlpBody(record)),
    signal: AbortSignal.timeout(2_000),
  });
}

async function exportSentry(record: Record<string, unknown>) {
  if (record.level !== 'error') return;
  const rawDsn = process.env.SENTRY_DSN?.trim();
  if (!rawDsn) return;
  const dsn = new URL(rawDsn);
  const projectId = dsn.pathname.split('/').filter(Boolean).at(-1);
  if (!dsn.username || !projectId) return;
  const eventId = crypto.randomUUID().replaceAll('-', '');
  const sentAt = new Date().toISOString();
  const envelopeHeader = { event_id: eventId, dsn: rawDsn, sent_at: sentAt };
  const itemHeader = { type: 'event', content_type: 'application/json' };
  const payload = {
    event_id: eventId,
    timestamp: sentAt,
    platform: 'javascript',
    level: 'error',
    message: String(record.event),
    tags: { service: 'algocoach', trace_id: record.traceId },
    extra: record,
  };
  const envelope = [
    JSON.stringify(envelopeHeader),
    JSON.stringify(itemHeader),
    JSON.stringify(payload),
  ].join('\n');
  await fetch(`${dsn.protocol}//${dsn.host}/api/${projectId}/envelope/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-sentry-envelope' },
    body: envelope,
    signal: AbortSignal.timeout(2_000),
  });
}

export async function recordOperationalEvent(input: OperationalEvent) {
  const level = input.level ?? (input.error ? 'error' : 'info');
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event: input.event,
    traceId: input.traceId,
    ...sanitizeTelemetryProperties(input.properties ?? {}),
    error: errorDetails(input.error),
  };
  const logger =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
  logger(JSON.stringify(record));
  await Promise.allSettled([exportOtlp(record), exportSentry(record)]);
}
