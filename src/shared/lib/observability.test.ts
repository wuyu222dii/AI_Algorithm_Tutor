import { describe, expect, it } from 'vitest';

import {
  sanitizeTelemetryProperties,
  sanitizeTelemetryText,
} from './observability';

describe('observability redaction', () => {
  it('removes credentials, user content, and nested sensitive fields', () => {
    const safe = sanitizeTelemetryProperties({
      provider: 'google',
      email: 'learner@example.test',
      accessToken: 'token-value',
      sourceCode: 'function solve() {}',
      nested: { authorization: 'Bearer secret', status: 502 },
      latencyMs: 123,
    });

    expect(safe).toEqual({
      provider: 'google',
      nested: { status: 502 },
      latencyMs: 123,
    });
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
});
