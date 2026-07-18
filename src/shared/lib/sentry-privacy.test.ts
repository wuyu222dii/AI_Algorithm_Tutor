import { describe, expect, it } from 'vitest';

import { sanitizeSentryEvent } from './sentry-privacy';

describe('Sentry privacy boundary', () => {
  it('removes exception text, source context, request data, and user identity', () => {
    const event = sanitizeSentryEvent({
      message: 'learner code: return secretSolution(input)',
      user: { email: 'learner@example.test' },
      request: {
        url: 'https://algocoach.test/practice/demo?code=private',
        data: 'full problem statement',
        headers: { cookie: 'session=secret' },
      },
      exception: {
        values: [
          {
            type: 'DrizzleQueryError',
            value: 'params: return secretSolution(input)',
            stacktrace: {
              frames: [
                {
                  filename: 'persistence.server.ts',
                  context_line: 'const code = learnerInput;',
                  pre_context: ['full statement'],
                  post_context: ['secret token'],
                  vars: { code: 'return secretSolution(input)' },
                },
              ],
            },
          },
        ],
      },
    });

    expect(event.user).toBeUndefined();
    expect(event.message).toBeUndefined();
    expect(event.request).toEqual({
      method: undefined,
      url: 'https://algocoach.test/practice/demo',
    });
    const exception = event.exception?.values?.[0];
    expect(exception?.type).toBe('DrizzleQueryError');
    expect(exception?.value).toBeUndefined();
    expect(exception?.stacktrace?.frames?.[0]).toMatchObject({
      filename: 'persistence.server.ts',
      context_line: undefined,
      vars: undefined,
    });
    expect(JSON.stringify(event)).not.toContain('secretSolution');
    expect(JSON.stringify(event)).not.toContain('full problem statement');
  });

  it('keeps sanitized operational capture messages without exception payloads', () => {
    const event = sanitizeSentryEvent({
      message: 'coach_provider_failed Bearer private-token',
      extra: { errorCode: 'timeout', userCode: 'private code' },
    });

    expect(event.message).toBe('coach_provider_failed Bearer [redacted]');
    expect(event.extra).toEqual({ errorCode: 'timeout' });
  });
});
