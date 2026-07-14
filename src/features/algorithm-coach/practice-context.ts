import {
  CoachStorageScope,
  getScopedStorageKey,
  GUEST_COACH_STORAGE_SCOPE,
} from './storage';
import type { CoachChatMessage } from './types';

const PRACTICE_CONTEXT_VERSION = 1;
export const PRACTICE_CONTEXT_KEY = `algocoach:practice-context:v${PRACTICE_CONTEXT_VERSION}`;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4_000;

export interface StoredPracticeMessage extends CoachChatMessage {
  id: string;
}

export interface StoredPracticeContext {
  version: typeof PRACTICE_CONTEXT_VERSION;
  messages: StoredPracticeMessage[];
  updatedAt: string;
}

function contextKey(problemSlug: string, scope: CoachStorageScope): string {
  return `${getScopedStorageKey(PRACTICE_CONTEXT_KEY, scope)}:${encodeURIComponent(problemSlug)}`;
}

function contextPrefix(scope: CoachStorageScope): string {
  return `${getScopedStorageKey(PRACTICE_CONTEXT_KEY, scope)}:`;
}

function validMessage(value: unknown): value is StoredPracticeMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredPracticeMessage>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    candidate.content.length > 0 &&
    candidate.content.length <= MAX_MESSAGE_LENGTH
  );
}

export function loadPracticeContext(
  problemSlug: string,
  storage: Storage | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): StoredPracticeContext | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(
      storage.getItem(contextKey(problemSlug, scope)) ?? 'null'
    ) as Partial<StoredPracticeContext> | null;
    if (!parsed || parsed.version !== PRACTICE_CONTEXT_VERSION) return null;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter(validMessage).slice(-MAX_MESSAGES)
      : [];
    if (!messages.length) return null;
    return {
      version: PRACTICE_CONTEXT_VERSION,
      messages,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function savePracticeContext(
  problemSlug: string,
  messages: StoredPracticeMessage[],
  storage: Storage | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  if (!storage) return;
  const safeMessages = messages.filter(validMessage).slice(-MAX_MESSAGES);
  if (!safeMessages.length) return;
  try {
    storage.setItem(
      contextKey(problemSlug, scope),
      JSON.stringify({
        version: PRACTICE_CONTEXT_VERSION,
        messages: safeMessages,
        updatedAt: new Date().toISOString(),
      } satisfies StoredPracticeContext)
    );
  } catch {
    // Practice remains usable in private or quota-restricted storage contexts.
  }
}

export function clearPracticeContexts(
  storage: Storage | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage,
  scope: CoachStorageScope = GUEST_COACH_STORAGE_SCOPE
): void {
  if (!storage) return;
  const prefix = contextPrefix(scope);
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    // Reset remains best-effort in restricted storage contexts.
  }
}

export function claimGuestPracticeContexts(
  scope: CoachStorageScope,
  storage: Storage | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage
): number {
  if (!storage || scope === GUEST_COACH_STORAGE_SCOPE) return 0;
  const guestPrefix = contextPrefix(GUEST_COACH_STORAGE_SCOPE);
  const accountPrefix = contextPrefix(scope);
  let claimed = 0;
  try {
    const guestKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(guestPrefix)) guestKeys.push(key);
    }
    for (const key of guestKeys) {
      const destination = `${accountPrefix}${key.slice(guestPrefix.length)}`;
      if (!storage.getItem(destination)) {
        const value = storage.getItem(key);
        if (value) storage.setItem(destination, value);
      }
      storage.removeItem(key);
      claimed += 1;
    }
  } catch {
    return claimed;
  }
  return claimed;
}
