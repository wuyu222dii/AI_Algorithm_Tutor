import type { Event } from '@sentry/nextjs';

import {
  sanitizeTelemetryProperties,
  sanitizeTelemetryText,
} from './telemetry-sanitize';

function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, 'https://algocoach.invalid');
    return url.origin === 'https://algocoach.invalid'
      ? url.pathname
      : `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

export function sanitizeSentryEvent<T extends Event>(event: T): T {
  const sanitized = {
    ...event,
    user: undefined,
    breadcrumbs: undefined,
    request: event.request
      ? {
          method: event.request.method,
          url: safeUrl(event.request.url),
        }
      : undefined,
    extra: event.extra
      ? sanitizeTelemetryProperties(event.extra as Record<string, unknown>)
      : undefined,
  } as T;

  if (sanitized.exception?.values) {
    sanitized.exception.values = sanitized.exception.values.map((value) => ({
      ...value,
      value: undefined,
      stacktrace: value.stacktrace
        ? {
            ...value.stacktrace,
            frames: value.stacktrace.frames?.map((frame) => ({
              ...frame,
              vars: undefined,
              pre_context: undefined,
              context_line: undefined,
              post_context: undefined,
            })),
          }
        : undefined,
    }));
  }
  if (sanitized.exception?.values?.length) {
    sanitized.message = undefined;
  } else if (sanitized.message) {
    sanitized.message = sanitizeTelemetryText(sanitized.message);
  }
  return sanitized;
}
