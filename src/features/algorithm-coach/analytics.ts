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
const COACH_GUEST_ID_COOKIE = 'algocoach_guest_id';
const COACH_ANONYMOUS_EVENT_OUTBOX_KEY = 'algocoach:anonymous-event-outbox:v1';
const COACH_ANONYMOUS_EVENT_CHECKPOINT_KEY =
  'algocoach:anonymous-event-checkpoint:v1';
const ANONYMOUS_EVENT_FLUSH_DELAY_MS = 250;
const ANONYMOUS_EVENT_MAX_AGE_MS = 23 * 60 * 60 * 1000;
const ANONYMOUS_EVENT_MAX_FUTURE_MS = 4 * 60 * 1000;
const ANONYMOUS_FUNNEL_EVENTS = new Set<ProductEventName>([
  'visitor_started',
  'onboarding_started',
  'activated',
  'practice_started',
  'first_code_run',
  'first_problem_passed',
  'code_run',
  'code_submitted',
  'corrected_after_diagnosis',
  'review_completed',
  'assessment_completed',
  'baseline_completed',
  'checkpoint_completed',
  'daily_plan_task_completed',
  'language_selected',
  'typescript_transpile_failed',
  'experiment_exposed',
]);
let activeStorageScope: CoachStorageScope | null = GUEST_COACH_STORAGE_SCOPE;
let anonymousFlushTimer: ReturnType<typeof setTimeout> | null = null;
let anonymousFlushInFlight: Promise<boolean> | null = null;

interface AnonymousEventPayload {
  id: string;
  name: ProductEventName;
  timestamp: string;
  problemSlug?: string;
}

interface AnonymousEventCheckpoint {
  sequence: number;
  generatedTotal: number;
  deliveredTotal: number;
}

const EMPTY_ANONYMOUS_CHECKPOINT: AnonymousEventCheckpoint = {
  sequence: 0,
  generatedTotal: 0,
  deliveredTotal: 0,
};

function loadAnonymousEventCheckpoint(): AnonymousEventCheckpoint {
  if (typeof window === 'undefined') return EMPTY_ANONYMOUS_CHECKPOINT;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(COACH_ANONYMOUS_EVENT_CHECKPOINT_KEY) ??
        'null'
    ) as Partial<AnonymousEventCheckpoint> | null;
    const sequence = Number(value?.sequence);
    const generatedTotal = Number(value?.generatedTotal);
    const deliveredTotal = Number(value?.deliveredTotal);
    if (
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      !Number.isInteger(generatedTotal) ||
      generatedTotal < 0 ||
      !Number.isInteger(deliveredTotal) ||
      deliveredTotal < 0 ||
      deliveredTotal > generatedTotal
    ) {
      return EMPTY_ANONYMOUS_CHECKPOINT;
    }
    return { sequence, generatedTotal, deliveredTotal };
  } catch {
    return EMPTY_ANONYMOUS_CHECKPOINT;
  }
}

function saveAnonymousEventCheckpoint(
  checkpoint: AnonymousEventCheckpoint
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      COACH_ANONYMOUS_EVENT_CHECKPOINT_KEY,
      JSON.stringify(checkpoint)
    );
  } catch {
    // The outbox remains retryable even when checkpoint persistence is blocked.
  }
}

function loadAnonymousEventOutbox(): AnonymousEventPayload[] {
  if (typeof window === 'undefined') return [];
  try {
    const now = Date.now();
    const parsed = JSON.parse(
      window.localStorage.getItem(COACH_ANONYMOUS_EVENT_OUTBOX_KEY) ?? '[]'
    ) as unknown;
    const events = Array.isArray(parsed)
      ? (parsed as AnonymousEventPayload[]).filter((event) => {
          const timestamp = Date.parse(event?.timestamp);
          return (
            Boolean(event) &&
            typeof event.id === 'string' &&
            event.id.length >= 8 &&
            event.id.length <= 160 &&
            ANONYMOUS_FUNNEL_EVENTS.has(event.name) &&
            Number.isFinite(timestamp) &&
            timestamp >= now - ANONYMOUS_EVENT_MAX_AGE_MS &&
            timestamp <= now + ANONYMOUS_EVENT_MAX_FUTURE_MS &&
            (event.problemSlug === undefined ||
              /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.problemSlug))
          );
        })
      : [];
    if (!Array.isArray(parsed) || events.length !== parsed.length) {
      saveAnonymousEventOutbox(events);
    }
    return events;
  } catch {
    saveAnonymousEventOutbox([]);
    return [];
  }
}

function saveAnonymousEventOutbox(events: AnonymousEventPayload[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (!events.length) {
      window.localStorage.removeItem(COACH_ANONYMOUS_EVENT_OUTBOX_KEY);
    } else {
      window.localStorage.setItem(
        COACH_ANONYMOUS_EVENT_OUTBOX_KEY,
        JSON.stringify(events)
      );
    }
  } catch {
    // Analytics delivery remains best-effort in restricted storage contexts.
  }
}

export function clearAnonymousProductEventOutbox(): void {
  saveAnonymousEventOutbox([]);
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(COACH_ANONYMOUS_EVENT_CHECKPOINT_KEY);
  }
}

async function flushOneAnonymousEventBatch(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function')
    return false;
  const batch = loadAnonymousEventOutbox().slice(0, 50);
  if (!batch.length) return true;
  const currentCheckpoint = loadAnonymousEventCheckpoint();
  const checkpoint: AnonymousEventCheckpoint = {
    sequence: currentCheckpoint.sequence + 1,
    generatedTotal: Math.max(
      currentCheckpoint.generatedTotal,
      currentCheckpoint.deliveredTotal + loadAnonymousEventOutbox().length
    ),
    deliveredTotal: Math.min(
      Math.max(
        currentCheckpoint.generatedTotal,
        currentCheckpoint.deliveredTotal + loadAnonymousEventOutbox().length
      ),
      currentCheckpoint.deliveredTotal + batch.length
    ),
  };
  try {
    const response = await fetch('/api/coach/events/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ events: batch, checkpoint }),
    });
    if (!response.ok) return false;
    const deliveredIds = new Set(batch.map((event) => event.id));
    const remaining = loadAnonymousEventOutbox().filter(
      (event) => !deliveredIds.has(event.id)
    );
    saveAnonymousEventOutbox(remaining);
    saveAnonymousEventCheckpoint(checkpoint);
    return true;
  } catch {
    // The durable outbox retries on the next event or page load.
    return false;
  }
}

export async function flushAnonymousProductEventOutbox(
  options: {
    drain?: boolean;
  } = {}
): Promise<boolean> {
  if (anonymousFlushTimer) {
    clearTimeout(anonymousFlushTimer);
    anonymousFlushTimer = null;
  }
  do {
    if (!anonymousFlushInFlight) {
      anonymousFlushInFlight = flushOneAnonymousEventBatch().finally(() => {
        anonymousFlushInFlight = null;
      });
    }
    const flushed = await anonymousFlushInFlight;
    if (!flushed) return false;
    if (!options.drain) {
      if (loadAnonymousEventOutbox().length) scheduleAnonymousEventFlush(0);
      return true;
    }
  } while (loadAnonymousEventOutbox().length);
  return true;
}

function scheduleAnonymousEventFlush(
  delayMs = ANONYMOUS_EVENT_FLUSH_DELAY_MS
): void {
  if (typeof window === 'undefined' || anonymousFlushTimer) return;
  anonymousFlushTimer = setTimeout(() => {
    anonymousFlushTimer = null;
    void flushAnonymousProductEventOutbox();
  }, delayMs);
}

function enqueueAnonymousProductEvent(event: ProductEvent): void {
  const payload: AnonymousEventPayload = {
    id: event.id,
    name: event.name,
    timestamp: event.timestamp,
    problemSlug: event.problemSlug,
  };
  const current = loadAnonymousEventOutbox();
  const existing = current.some((item) => item.id === payload.id);
  const byId = new Map([...current, payload].map((item) => [item.id, item]));
  saveAnonymousEventOutbox(Array.from(byId.values()));
  if (!existing) {
    const checkpoint = loadAnonymousEventCheckpoint();
    saveAnonymousEventCheckpoint({
      ...checkpoint,
      generatedTotal: checkpoint.generatedTotal + 1,
    });
  }
  scheduleAnonymousEventFlush(byId.size >= 50 ? 0 : undefined);
}

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

export function ensureCoachGuestIdentity(): string {
  if (typeof document === 'undefined') return 'server';
  const existing = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COACH_GUEST_ID_COOKIE}=`))
    ?.slice(COACH_GUEST_ID_COOKIE.length + 1);
  if (existing && /^[A-Za-z0-9_-]{8,160}$/.test(existing)) {
    if (loadAnonymousEventOutbox().length) scheduleAnonymousEventFlush();
    return existing;
  }

  const identity = randomId('guest');
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COACH_GUEST_ID_COOKIE}=${identity}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  return identity;
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
  if (typeof window !== 'undefined') ensureCoachGuestIdentity();
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
    if (
      scope === GUEST_COACH_STORAGE_SCOPE &&
      ANONYMOUS_FUNNEL_EVENTS.has(event.name) &&
      typeof fetch === 'function'
    ) {
      enqueueAnonymousProductEvent(event);
    }
  } catch {
    // Analytics must never interrupt the learning workflow.
  }
  return event;
}

export function loadProductAnalytics(
  scope: CoachStorageScope | null = activeStorageScope
): ProductEvent[] {
  if (typeof window === 'undefined' || !scope) return [];
  try {
    const analyticsKey = getScopedStorageKey(COACH_ANALYTICS_KEY, scope);
    const value = JSON.parse(
      window.localStorage.getItem(analyticsKey) ?? '[]'
    ) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (event): event is ProductEvent =>
          Boolean(event) &&
          typeof event === 'object' &&
          typeof (event as ProductEvent).id === 'string' &&
          typeof (event as ProductEvent).name === 'string' &&
          typeof (event as ProductEvent).timestamp === 'string' &&
          typeof (event as ProductEvent).sessionId === 'string'
      )
      .slice(-MAX_STORED_EVENTS);
  } catch {
    return [];
  }
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
    if (scope === GUEST_COACH_STORAGE_SCOPE) {
      window.localStorage.removeItem(COACH_ANONYMOUS_EVENT_OUTBOX_KEY);
    }
  } catch {
    // Reset remains best-effort in restricted browser storage contexts.
  }
}

export { calculateProductMetrics };
