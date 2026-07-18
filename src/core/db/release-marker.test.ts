import { describe, expect, it } from 'vitest';

import {
  createDatabaseReleaseMarker,
  databaseReleaseMarkerMatches,
} from './release-marker';

const SHA = 'A'.repeat(40);

describe('database release markers', () => {
  it('binds a normalized commit to one release channel', () => {
    expect(createDatabaseReleaseMarker('staging', SHA)).toBe(
      `algocoach-release:staging:${SHA.toLowerCase()}`
    );
    expect(
      databaseReleaseMarkerMatches(
        `algocoach-release:staging:${SHA.toLowerCase()}`,
        'staging',
        SHA
      )
    ).toBe(true);
    expect(
      databaseReleaseMarkerMatches(
        `algocoach-release:staging:${SHA.toLowerCase()}`,
        'production',
        SHA
      )
    ).toBe(false);
  });

  it.each([
    ['preview', SHA],
    ['staging', 'short'],
    ['production', 'z'.repeat(40)],
  ])('fails closed for channel %s and release %s', (channel, releaseId) => {
    expect(() => createDatabaseReleaseMarker(channel, releaseId)).toThrow();
    expect(databaseReleaseMarkerMatches(null, channel, releaseId)).toBe(false);
  });
});
