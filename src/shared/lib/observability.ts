import type { OperationalEvent } from '@/shared/types/observability';

import {
  sanitizeTelemetryProperties,
  sanitizeTelemetryText,
} from './telemetry-sanitize';

export { sanitizeTelemetryProperties, sanitizeTelemetryText };

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const code = (error as Error & { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === 'string' && /^[a-z0-9_.:-]{1,80}$/i.test(code)
      ? { code }
      : {}),
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
