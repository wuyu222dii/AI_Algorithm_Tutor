import { calculateProductMetrics } from './metrics';
import { JsonValue, ProductEvent, ProductEventName } from './types';

const ANALYTICS_KEY = 'algocoach:events:v1';
const SESSION_KEY = 'algocoach:session-id';
const EXPERIMENT_KEY = 'algocoach:hint-copy-variant';
const MAX_STORED_EVENTS = 300;

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function getSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = randomId('session');
    window.sessionStorage.setItem(SESSION_KEY, next);
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

export function getExperimentVariant(subjectId?: string): 'A' | 'B' {
  if (typeof window === 'undefined') {
    return subjectId && stableHash(subjectId) % 2 === 1 ? 'B' : 'A';
  }

  try {
    const existing = window.localStorage.getItem(EXPERIMENT_KEY);
    if (existing === 'A' || existing === 'B') return existing;

    const assignment =
      stableHash(subjectId ?? getSessionId()) % 2 === 1 ? 'B' : 'A';
    window.localStorage.setItem(EXPERIMENT_KEY, assignment);
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
  } = {}
): ProductEvent {
  return {
    id: randomId('event'),
    name,
    timestamp: new Date().toISOString(),
    sessionId: options.sessionId ?? getSessionId(),
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
  } = {}
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
  const event = createProductEvent(normalizedName, {
    problemSlug: options.problemSlug ?? options.problemId,
    properties:
      options.properties ??
      (Object.keys(directProperties).length ? directProperties : undefined),
  });
  if (typeof window === 'undefined') return event;

  try {
    const current = JSON.parse(
      window.localStorage.getItem(ANALYTICS_KEY) ?? '[]'
    ) as ProductEvent[];
    window.localStorage.setItem(
      ANALYTICS_KEY,
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

export function clearProductAnalytics(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ANALYTICS_KEY);
    window.localStorage.removeItem(EXPERIMENT_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Reset remains best-effort in restricted browser storage contexts.
  }
}

export { calculateProductMetrics };
