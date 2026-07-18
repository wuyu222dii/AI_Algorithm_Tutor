import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AnonymousIdentityConfigurationError,
  deriveGuestSubject,
  isValidAnonymousEventCheckpoint,
  readGuestIdentity,
  validateAnonymousEventTimes,
} from './anonymous-events.server';

vi.mock('server-only', () => ({}));

describe('anonymous event identity protection', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('derives a stable HMAC without exposing the cookie value', () => {
    vi.stubEnv(
      'AUTH_SECRET',
      'test-auth-secret-that-is-definitely-longer-than-32-characters'
    );
    const raw = 'guest_private_cookie_value';
    const first = deriveGuestSubject(raw);

    expect(first).toBe(deriveGuestSubject(raw));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(raw);
  });

  it('requires a production-strength HMAC secret', () => {
    vi.stubEnv('AUTH_SECRET', 'short');
    expect(() => deriveGuestSubject('guest_identity_123')).toThrow(
      AnonymousIdentityConfigurationError
    );
  });

  it('reads only a bounded guest cookie and enforces event time bounds', () => {
    const request = new Request('http://localhost', {
      headers: { cookie: 'other=x; algocoach_guest_id=guest_identity_123' },
    });
    const now = Date.now();

    expect(readGuestIdentity(request)).toBe('guest_identity_123');
    expect(
      validateAnonymousEventTimes(
        [
          {
            id: 'event_12345678',
            name: 'code_run',
            timestamp: new Date(now).toISOString(),
          },
        ],
        now
      )
    ).toBe(true);
    expect(
      validateAnonymousEventTimes(
        [
          {
            id: 'event_12345678',
            name: 'code_run',
            timestamp: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
        now
      )
    ).toBe(false);
  });

  it('accepts monotonic checkpoints and rejects inflated or stale counters', () => {
    expect(
      isValidAnonymousEventCheckpoint(
        null,
        { sequence: 1, generatedTotal: 51, deliveredTotal: 50 },
        50
      )
    ).toBe(true);
    expect(
      isValidAnonymousEventCheckpoint(
        { sequence: 1, generatedTotal: 51, deliveredTotal: 50 },
        { sequence: 2, generatedTotal: 51, deliveredTotal: 51 },
        1
      )
    ).toBe(true);
    expect(
      isValidAnonymousEventCheckpoint(
        null,
        { sequence: 1, generatedTotal: 10_000_000, deliveredTotal: 0 },
        1
      )
    ).toBe(false);
    expect(
      isValidAnonymousEventCheckpoint(
        { sequence: 3, generatedTotal: 60, deliveredTotal: 60 },
        { sequence: 2, generatedTotal: 100, deliveredTotal: 100 },
        40
      )
    ).toBe(false);
    expect(
      isValidAnonymousEventCheckpoint(
        { sequence: 3, generatedTotal: 60, deliveredTotal: 60 },
        { sequence: 3, generatedTotal: 60, deliveredTotal: 60 },
        40
      )
    ).toBe(true);
  });
});
