import type { OperationalEvent } from '@/shared/types/observability';

import {
  sanitizeTelemetryProperties,
  sanitizeTelemetryText,
} from './telemetry-sanitize';

export { sanitizeTelemetryProperties, sanitizeTelemetryText };

const DATABASE_ERROR_CATEGORIES: Readonly<Record<string, string>> = {
  '28P01': 'credential_invalid',
  '3F000': 'missing_schema',
  '42501': 'permission_denied',
  '42703': 'missing_column',
  '42P01': 'missing_table',
  '53300': 'pool_exhausted',
  '57014': 'timeout',
};

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9_.:-]{1,80}$/i.test(value)
    ? value
    : undefined;
}

function databaseErrorCategory(code: string | undefined) {
  if (!code) return undefined;
  if (/^08[A-Z0-9]{3}$/i.test(code)) return 'connection_failed';
  return DATABASE_ERROR_CATEGORIES[code.toUpperCase()];
}

export function operationalErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const seen = new Set<object>();
  let current: unknown = error;
  let name = 'Error';
  let genericCode: string | undefined;
  let databaseCode: string | undefined;

  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) break;
    seen.add(current);
    const candidate = current as {
      name?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (depth === 0) name = safeErrorCode(candidate.name) ?? name;
    const code = safeErrorCode(candidate.code);
    if (code && /^[0-9A-Z]{5}$/i.test(code)) {
      databaseCode ??= code.toUpperCase();
    } else {
      genericCode ??= code;
    }
    current = candidate.cause;
  }

  const code = databaseCode ?? genericCode;
  const category = databaseErrorCategory(databaseCode);
  return {
    name,
    ...(code ? { code } : {}),
    ...(category ? { category } : {}),
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
  if (!process.env.SENTRY_DSN?.trim()) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.withScope((scope) => {
    scope.setTag('service', 'algocoach');
    if (record.traceId) scope.setTag('trace_id', String(record.traceId));
    scope.setExtras(record);
    Sentry.captureMessage(String(record.event), 'error');
  });
  await Sentry.flush(1_500);
}

export async function recordOperationalEvent(input: OperationalEvent) {
  const level = input.level ?? (input.error ? 'error' : 'info');
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event: input.event,
    traceId: input.traceId,
    ...sanitizeTelemetryProperties(input.properties ?? {}),
    error: operationalErrorDetails(input.error),
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
