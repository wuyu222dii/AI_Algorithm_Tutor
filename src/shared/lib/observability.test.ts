import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  operationalErrorDetails,
  recordOperationalEvent,
  sanitizeTelemetryProperties,
  sanitizeTelemetryText,
} from './observability';

describe('observability redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('removes credentials, user content, and nested sensitive fields', () => {
    const safe = sanitizeTelemetryProperties({
      provider: 'google',
      email: 'learner@example.test',
      accessToken: 'token-value',
      sourceCode: 'function solve() {}',
      nested: { authorization: 'Bearer secret', status: 502 },
      errorCode: 'channel_unavailable',
      fallbackFrom: undefined,
      latencyMs: 123,
    });

    expect(safe).toEqual({
      provider: 'google',
      nested: { status: 502 },
      errorCode: 'channel_unavailable',
      latencyMs: 123,
    });
  });

  it('extracts only a safe PostgreSQL code from a wrapped error cause', () => {
    const databaseError = Object.assign(new Error('private SQL details'), {
      code: '42P01',
      query: 'select private learner data',
    });
    const wrapped = Object.assign(new Error('query and connection URL'), {
      cause: databaseError,
    });

    expect(operationalErrorDetails(wrapped)).toEqual({
      name: 'Error',
      code: '42P01',
      category: 'missing_table',
    });
    expect(JSON.stringify(operationalErrorDetails(wrapped))).not.toContain(
      'private'
    );
  });

  it('redacts credentials and personal data embedded in error text', () => {
    const safe = sanitizeTelemetryText(
      'user learner@example.test failed with Bearer abc123 and code=oauth-code eyJ1234567890.abcdefghijk.zzzzzzzzzz postgresql://admin:db-password@database.internal/algocoach sk-1234567890abcdefghijklmnop'
    );

    expect(safe).not.toContain('learner@example.test');
    expect(safe).not.toContain('abc123');
    expect(safe).not.toContain('oauth-code');
    expect(safe).not.toContain('eyJ1234567890');
    expect(safe).not.toContain('db-password');
    expect(safe).not.toContain('sk-1234567890abcdefghijklmnop');
  });

  it('never exports operational error messages or stacks', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'https://otel.example/logs');
    vi.stubEnv('SENTRY_DSN', '');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const consoleMock = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);
    const error = new Error(
      'params: return secretSolution(input); full private problem statement'
    ) as Error & { code: string };
    error.code = 'database_unavailable';

    await recordOperationalEvent({
      event: 'coach_persistence_failed',
      error,
      properties: { errorCode: 'database_unavailable' },
    });

    const consolePayload = String(consoleMock.mock.calls[0]?.[0]);
    const otlpPayload = String(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body
    );
    expect(consolePayload).toContain('database_unavailable');
    expect(otlpPayload).toContain('database_unavailable');
    expect(consolePayload).not.toContain('secretSolution');
    expect(otlpPayload).not.toContain('secretSolution');
    expect(consolePayload).not.toContain('private problem statement');
    expect(otlpPayload).not.toContain('private problem statement');
  });
});
