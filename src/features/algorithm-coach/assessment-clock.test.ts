import { describe, expect, it } from 'vitest';

import {
  assessmentSecondsUntil,
  calculateServerOffsetMs,
} from './assessment-clock';

describe('assessment server clock calibration', () => {
  it.each([-5 * 60_000, 5 * 60_000])(
    'keeps countdown error within two seconds for a %i ms device skew',
    (deviceSkewMs) => {
      const serverRequestAt = Date.parse('2026-07-18T00:00:00.000Z');
      const networkRoundTripMs = 800;
      const localRequestAt = serverRequestAt + deviceSkewMs;
      const localResponseAt =
        serverRequestAt + networkRoundTripMs + deviceSkewMs;
      const serverNow = new Date(
        serverRequestAt + networkRoundTripMs
      ).toISOString();
      const offset = calculateServerOffsetMs(
        serverNow,
        localRequestAt,
        localResponseAt
      );
      const expiry = serverRequestAt + 20 * 60_000;

      const secondsLeft = assessmentSecondsUntil(
        expiry,
        offset,
        localResponseAt
      );
      const actualSecondsLeft = Math.ceil(
        (expiry - (serverRequestAt + networkRoundTripMs)) / 1000
      );

      expect(Math.abs(secondsLeft - actualSecondsLeft)).toBeLessThanOrEqual(1);
    }
  );

  it('rejects malformed server timestamps and implausible offsets', () => {
    expect(() => calculateServerOffsetMs('invalid', 0, 10)).toThrow();
    expect(() =>
      calculateServerOffsetMs('2026-07-18T00:00:00.000Z', 10, 0)
    ).toThrow();
    expect(() =>
      calculateServerOffsetMs('2026-07-18T00:00:00.000Z', 0, 1)
    ).toThrow(/out of range/);
  });
});
