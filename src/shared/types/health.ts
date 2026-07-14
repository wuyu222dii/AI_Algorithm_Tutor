export type HealthCheckState = 'ok' | 'error';

export interface HealthCheckResult {
  status: HealthCheckState;
  code?: string;
  latencyMs?: number;
  details?: Record<string, boolean | number | string | string[]>;
}

export interface HealthStatus {
  status: HealthCheckState;
  kind: 'live' | 'ready';
  service: 'algocoach';
  version: string;
  timestamp: string;
  checks?: {
    configuration: HealthCheckResult;
    database: HealthCheckResult;
    migrations: HealthCheckResult;
    redis: HealthCheckResult;
    authentication: HealthCheckResult;
    ai: HealthCheckResult;
  };
}
