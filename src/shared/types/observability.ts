export type OperationalLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AuthProviderEventName =
  | 'auth_provider_started'
  | 'auth_provider_succeeded'
  | 'auth_provider_failed'
  | 'auth_account_linked';

export interface AuthProviderEvent {
  event: AuthProviderEventName;
  provider: 'google';
  level?: OperationalLogLevel;
  traceId?: string;
  outcome?: 'started' | 'succeeded' | 'failed' | 'linked';
  reason?: string;
}

export interface OperationalEvent {
  event: string;
  level?: OperationalLogLevel;
  traceId?: string;
  properties?: Record<string, unknown>;
  error?: unknown;
}
