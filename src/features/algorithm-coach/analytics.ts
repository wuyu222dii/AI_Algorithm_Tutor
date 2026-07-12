import { calculateProductMetrics } from './metrics';
import {
  COACH_ANALYTICS_KEY,
  COACH_EXPERIMENT_KEY,
  COACH_SESSION_KEY,
  CoachStorageScope,
  getScopedStorageKey,
  GUEST_COACH_STORAGE_SCOPE,
} from './storage';
import { JsonValue, ProductEvent, ProductEventName } from './types';

const MAX_STORED_EVENTS = 300;
let activeStorageScope: CoachStorageScope | null = GUEST_COACH_STORAGE_SCOPE;

export function setProductAnalyticsScope(
  scope: CoachStorageScope | null
): void {
  activeStorageScope = scope;
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function getSessionId(scope: CoachStorageScope | null): string {
  if (typeof window === 'undefined') return 'server';
  if (!scope) return 'session_pending';
  try {
    const sessionKey = getScopedStorageKey(COACH_SESSION_KEY, scope);
    const existing = window.sessionStorage.getItem(sessionKey);
    if (existing) return existing;
    const next = randomId('session');
    window.sessionStorage.setItem(sessionKey, next);
    return next;
  } catch {
    return 'session_ephemeral';
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getExperimentVariant(
  subjectId?: string,
  scope: CoachStorageScope | null = activeStorageScope
): 'A' | 'B' {
  if (typeof window === 'undefined') {
    return subjectId && stableHash(subjectId) % 2 === 1 ? 'B' : 'A';
  }

  if (!scope) {
    return subjectId && stableHash(subjectId) % 2 === 1 ? 'B' : 'A';
  }

  try {
    const experimentKey = getScopedStorageKey(COACH_EXPERIMENT_KEY, scope);
    const existing = window.localStorage.getItem(experimentKey);
    if (existing === 'A' || existing === 'B') return existing;

    const assignment =
      stableHash(subjectId ?? getSessionId(scope)) % 2 === 1 ? 'B' : 'A';
    window.localStorage.setItem(experimentKey, assignment);
    return assignment;
  } catch {
    return subjectId && stableHash(subjectId) % 2 === 1 ? 'B' : 'A';
  }
}

export function createProductEvent(
  name: ProductEventName,
  options: {
    problemSlug?: string;
    properties?: Record<string, JsonValue>;
    sessionId?: string;
  } = {},
  scope: CoachStorageScope | null = activeStorageScope
): ProductEvent {
  return {
    id: randomId('event'),
    name,
    timestamp: new Date().toISOString(),
    sessionId: options.sessionId ?? getSessionId(scope),
    problemSlug: options.problemSlug,
    properties: options.properties,
  };
}

export function trackProductEvent(
  name: ProductEventName | string,
  options: {
    problemSlug?: string;
    properties?: Record<string, JsonValue>;
    problemId?: string;
    [key: string]: JsonValue | Record<string, JsonValue> | undefined;
  } = {},
  scope: CoachStorageScope | null = activeStorageScope
): ProductEvent {
  const aliases: Record<string, ProductEventName> = {
    activation: 'activated',
    code_submit: 'code_submitted',
    coach_diagnose: 'diagnosis_requested',
    coach_counterexample: 'counterexample_requested',
    coach_review_card: 'review_card_created',
    coach_chat: 'coach_chat_message',
  };
  const normalizedName = aliases[name] ?? (name as ProductEventName);
  const reserved = new Set(['problemSlug', 'problemId', 'properties']);
  const directProperties = Object.fromEntries(
    Object.entries(options).filter(([key]) => !reserved.has(key))
  ) as Record<string, JsonValue>;
  const event = createProductEvent(
    normalizedName,
    {
      problemSlug: options.problemSlug ?? options.problemId,
      properties:
        options.properties ??
        (Object.keys(directProperties).length ? directProperties : undefined),
    },
    scope
  );
  if (typeof window === 'undefined' || !scope) return event;

  try {
    const analyticsKey = getScopedStorageKey(COACH_ANALYTICS_KEY, scope);
    const current = JSON.parse(
      window.localStorage.getItem(analyticsKey) ?? '[]'
    ) as ProductEvent[];
    window.localStorage.setItem(
      analyticsKey,
      JSON.stringify([...current, event].slice(-MAX_STORED_EVENTS))
    );
    window.dispatchEvent(
      new CustomEvent<ProductEvent>('algocoach:product-event', {
        detail: event,
      })
    );
  } catch {
    // Analytics must never interrupt the learning workflow.
  }
  return event;
}

export function clearProductAnalytics(
  scope: CoachStorageScope | null = activeStorageScope
): void {
  if (typeof window === 'undefined' || !scope) return;
  try {
    window.localStorage.removeItem(
      getScopedStorageKey(COACH_ANALYTICS_KEY, scope)
    );
    window.localStorage.removeItem(
      getScopedStorageKey(COACH_EXPERIMENT_KEY, scope)
    );
    window.sessionStorage.removeItem(
      getScopedStorageKey(COACH_SESSION_KEY, scope)
    );
  } catch {
    // Reset remains best-effort in restricted browser storage contexts.
  }
}

export { calculateProductMetrics };
