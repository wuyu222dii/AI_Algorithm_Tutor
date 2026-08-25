export interface CatalogDiscoveryMonitorState {
  consecutiveFailures: number;
  previousLicenseSpdx?: string;
  previousLicenseContentHash?: string;
  latestLicenseSpdx?: string;
  latestLicenseContentHash?: string;
  previousTreeExercises?: number;
  latestTreeExercises?: number;
  latestCandidateDelta?: number;
}

export type CatalogDiscoveryAnomalySeverity = 'error' | 'warning';

export interface CatalogDiscoveryAnomaly {
  code:
    | 'consecutive_failures'
    | 'license_changed'
    | 'tree_delta_exceeded'
    | 'candidate_delta_exceeded';
  severity: CatalogDiscoveryAnomalySeverity;
  message: string;
}

/** Hard failures that should fail the monitor gate. Delta spikes are warnings. */
export function catalogAnomalySeverity(
  code: CatalogDiscoveryAnomaly['code']
): CatalogDiscoveryAnomalySeverity {
  return code === 'tree_delta_exceeded' || code === 'candidate_delta_exceeded'
    ? 'warning'
    : 'error';
}

export function evaluateCatalogDiscoveryAnomalies(
  state: CatalogDiscoveryMonitorState,
  deltaThreshold: number
): CatalogDiscoveryAnomaly[] {
  if (!Number.isInteger(deltaThreshold) || deltaThreshold < 1) {
    throw new Error(
      'Catalog anomaly delta threshold must be a positive integer.'
    );
  }
  const anomalies: CatalogDiscoveryAnomaly[] = [];
  if (state.consecutiveFailures >= 2) {
    anomalies.push({
      code: 'consecutive_failures',
      severity: 'error',
      message: `Catalog synchronization has failed ${state.consecutiveFailures} consecutive times.`,
    });
  }
  if (
    state.previousLicenseSpdx !== undefined &&
    state.latestLicenseSpdx !== undefined &&
    state.previousLicenseSpdx !== state.latestLicenseSpdx
  ) {
    anomalies.push({
      code: 'license_changed',
      severity: 'error',
      message: `Catalog SPDX changed from ${state.previousLicenseSpdx} to ${state.latestLicenseSpdx}.`,
    });
  } else if (
    state.previousLicenseContentHash !== undefined &&
    state.latestLicenseContentHash !== undefined &&
    state.previousLicenseContentHash !== state.latestLicenseContentHash
  ) {
    anomalies.push({
      code: 'license_changed',
      severity: 'error',
      message: 'Catalog MIT LICENSE content hash changed.',
    });
  }
  if (
    state.previousTreeExercises !== undefined &&
    state.latestTreeExercises !== undefined
  ) {
    const delta = Math.abs(
      state.latestTreeExercises - state.previousTreeExercises
    );
    if (delta > deltaThreshold) {
      anomalies.push({
        code: 'tree_delta_exceeded',
        severity: 'warning',
        message: `Catalog tree changed by ${delta} exercises; threshold is ${deltaThreshold}.`,
      });
    }
  }
  if (
    state.latestCandidateDelta !== undefined &&
    state.latestCandidateDelta > deltaThreshold
  ) {
    anomalies.push({
      code: 'candidate_delta_exceeded',
      severity: 'warning',
      message: `Catalog candidate delta is ${state.latestCandidateDelta}; threshold is ${deltaThreshold}.`,
    });
  }
  return anomalies;
}
