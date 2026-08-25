import { describe, expect, it } from 'vitest';

import {
  catalogAnomalySeverity,
  evaluateCatalogDiscoveryAnomalies,
} from './discovery-monitor';

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
      )
    ).toEqual([
      {
        code: 'consecutive_failures',
        severity: 'error',
        message: 'Catalog synchronization has failed 2 consecutive times.',
      },
      {
        code: 'license_changed',
        severity: 'error',
        message: 'Catalog SPDX changed from MIT to GPL-3.0.',
      },
      {
        code: 'tree_delta_exceeded',
        severity: 'warning',
        message: 'Catalog tree changed by 31 exercises; threshold is 20.',
      },
      {
        code: 'candidate_delta_exceeded',
        severity: 'warning',
        message: 'Catalog candidate delta is 30; threshold is 20.',
      },
    ]);
  });

  it('treats delta spikes as warnings and hard failures as errors', () => {
    expect(catalogAnomalySeverity('tree_delta_exceeded')).toBe('warning');
    expect(catalogAnomalySeverity('candidate_delta_exceeded')).toBe('warning');
    expect(catalogAnomalySeverity('consecutive_failures')).toBe('error');
    expect(catalogAnomalySeverity('license_changed')).toBe('error');
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
