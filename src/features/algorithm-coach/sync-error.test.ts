import { describe, expect, it } from 'vitest';

import {
  classifyCoachSyncFailure,
  CoachSyncFailure,
  coachSyncFailureForResponse,
} from './sync-error';

describe('coach sync error classification', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [409, 'conflict'],
    [500, 'server'],
    [503, 'server'],
  ] as const)('classifies HTTP %s as %s', (status, expected) => {
    expect(
      classifyCoachSyncFailure(
        coachSyncFailureForResponse(new Response(null, { status }))
      )
    ).toBe(expected);
  });

  it('keeps a failed conflict recovery classified as a conflict', () => {
    expect(
      coachSyncFailureForResponse(
        new Response(null, { status: 502 }),
        'conflict'
      ).kind
    ).toBe('conflict');
  });

  it('classifies transport and offline failures as network errors', () => {
    expect(classifyCoachSyncFailure(new TypeError('fetch failed'), true)).toBe(
      'network'
    );
    expect(classifyCoachSyncFailure(new Error('unknown'), false)).toBe(
      'network'
    );
  });

  it('preserves explicit classifications and defaults unknown errors to server', () => {
    expect(
      classifyCoachSyncFailure(new CoachSyncFailure('conflict', 'conflict'))
    ).toBe('conflict');
    expect(classifyCoachSyncFailure(new Error('invalid payload'), true)).toBe(
      'server'
    );
  });
});
