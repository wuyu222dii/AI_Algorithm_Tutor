import { describe, expect, it } from 'vitest';

import { evaluateCatalogDiscoveryAnomalies } from './discovery-monitor';

describe('catalog discovery anomaly monitor', () => {
  it('reports repeated failures, license changes, and excessive deltas', () => {
    expect(
      evaluateCatalogDiscoveryAnomalies(
        {
          consecutiveFailures: 2,
          previousLicenseSpdx: 'MIT',
          latestLicenseSpdx: 'GPL-3.0',
          previousLicenseContentHash: 'sha256:old',
          latestLicenseContentHash: 'sha256:new',
          previousTreeExercises: 100,
          latestTreeExercises: 131,
          latestCandidateDelta: 30,
        },
        20
      ).map((item) => item.code)
    ).toEqual([
      'consecutive_failures',
      'license_changed',
      'tree_delta_exceeded',
      'candidate_delta_exceeded',
    ]);
  });

  it('accepts stable catalog history', () => {
    expect(
      evaluateCatalogDiscoveryAnomalies(
        {
          consecutiveFailures: 0,
          previousLicenseSpdx: 'MIT',
          latestLicenseSpdx: 'MIT',
          previousLicenseContentHash: 'sha256:same',
          latestLicenseContentHash: 'sha256:same',
          previousTreeExercises: 150,
          latestTreeExercises: 151,
          latestCandidateDelta: 10,
        },
        20
      )
    ).toEqual([]);
  });
});
