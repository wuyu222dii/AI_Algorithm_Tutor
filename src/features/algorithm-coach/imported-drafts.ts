import type { CoachStorageScope } from './storage';
import type { ImportedDraftRecord, Problem } from './types';

export type { ImportedDraftRecord } from './types';

export const COACH_IMPORTED_DRAFTS_KEY = 'algocoach:imported-drafts:v1';
export const COACH_IMPORTED_DRAFTS_DROPPED_KEY =
  'algocoach:imported-drafts-claim-dropped:v1';
export const MAX_IMPORTED_DRAFTS = 20;
const MAX_DRAFT_CLOCK_SKEW_MS = 5 * 60 * 1000;

function comparableTimestamp(value: string, now = Date.now()): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(parsed, now + MAX_DRAFT_CLOCK_SKEW_MS);
}

export function isImportedDraftSlug(slug: string): boolean {
  return (
    slug === 'imported-draft' ||
    /^imported-draft-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  );
}

function getStorage(storage?: Storage): Storage | undefined {
  return (
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  );
}

function scopedKey(scope: CoachStorageScope): string {
  return scope === 'guest'
    ? COACH_IMPORTED_DRAFTS_KEY
    : `${COACH_IMPORTED_DRAFTS_KEY}:${scope}`;
}

function scopedDroppedKey(scope: CoachStorageScope): string {
  return scope === 'guest'
    ? COACH_IMPORTED_DRAFTS_DROPPED_KEY
    : `${COACH_IMPORTED_DRAFTS_DROPPED_KEY}:${scope}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isProblem(value: unknown): value is Problem {
  return Boolean(
    isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.slug === 'string' &&
      isImportedDraftSlug(value.slug) &&
      isRecord(value.title) &&
      typeof value.title.zh === 'string' &&
      typeof value.title.en === 'string' &&
      isRecord(value.description) &&
      typeof value.description.zh === 'string' &&
      typeof value.description.en === 'string' &&
      ['easy', 'medium', 'hard'].includes(String(value.difficulty)) &&
      Array.isArray(value.topics) &&
      typeof value.entryPoint === 'string' &&
      isRecord(value.templates) &&
      typeof value.templates.javascript === 'string' &&
      typeof value.templates.python === 'string' &&
      Array.isArray(value.tests) &&
      Array.isArray(value.examples) &&
      Array.isArray(value.constraints) &&
      isRecord(value.hints) &&
      Array.isArray(value.hints.zh) &&
      Array.isArray(value.hints.en) &&
      Array.isArray(value.reviewPoints) &&
      typeof value.estimatedMinutes === 'number'
  );
}

function parseRecords(raw: string | null): ImportedDraftRecord[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(isRecord)
      .filter(
        (item) =>
          isProblem(item.problem) &&
          typeof item.createdAt === 'string' &&
          typeof item.updatedAt === 'string'
      )
      .map((item) => item as unknown as ImportedDraftRecord)
      .slice(0, MAX_IMPORTED_DRAFTS);
  } catch {
    return [];
  }
}

function writeRecords(
  records: ImportedDraftRecord[],
  storage: Storage,
  scope: CoachStorageScope
): ImportedDraftRecord[] {
  const next = records.slice(0, MAX_IMPORTED_DRAFTS);
  storage.setItem(scopedKey(scope), JSON.stringify(next));
  return next;
}

export function saveImportedDraftCollection(
  records: ImportedDraftRecord[],
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): ImportedDraftRecord[] {
  const target = getStorage(storage);
  if (!target) return records.slice(0, MAX_IMPORTED_DRAFTS);
  try {
    return writeRecords(records, target, scope);
  } catch {
    return loadImportedDrafts(target, scope);
  }
}

export function mergeImportedDraftRecords(
  current: ImportedDraftRecord[],
  incoming: ImportedDraftRecord[]
): ImportedDraftRecord[] {
  const bySlug = new Map(
    current.map((record) => [record.problem.slug, record])
  );
  const priority = new Map(
    current.map((record, index) => [record.problem.slug, index])
  );
  const comparisonTime = Date.now();
  for (const [index, record] of incoming.entries()) {
    const existing = bySlug.get(record.problem.slug);
    if (
      !existing ||
      comparableTimestamp(record.updatedAt, comparisonTime) >=
        comparableTimestamp(existing.updatedAt, comparisonTime)
    ) {
      bySlug.set(record.problem.slug, record);
      priority.set(record.problem.slug, current.length + index);
    }
  }
  return Array.from(bySlug.values())
    .sort((left, right) => {
      const timestampOrder =
        comparableTimestamp(right.updatedAt, comparisonTime) -
        comparableTimestamp(left.updatedAt, comparisonTime);
      return (
        timestampOrder ||
        (priority.get(right.problem.slug) ?? 0) -
          (priority.get(left.problem.slug) ?? 0)
      );
    })
    .slice(0, MAX_IMPORTED_DRAFTS);
}

export function removeImportedDraftRecords(
  current: ImportedDraftRecord[],
  slugs: string[]
): ImportedDraftRecord[] {
  if (!slugs.length) return current;
  const removed = new Set(slugs);
  return current.filter((record) => !removed.has(record.problem.slug));
}

export function upsertImportedDraftRecords(
  current: ImportedDraftRecord[],
  incoming: ImportedDraftRecord[]
): ImportedDraftRecord[] {
  if (!incoming.length) return current;
  const incomingSlugs = new Set(incoming.map((record) => record.problem.slug));
  const incomingIds = new Set(incoming.map((record) => record.problem.id));
  return mergeImportedDraftRecords(
    current.filter(
      (record) =>
        !incomingIds.has(record.problem.id) ||
        incomingSlugs.has(record.problem.slug)
    ),
    incoming
  );
}

export function hasImportedDraftCollection(
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): boolean {
  const target = getStorage(storage);
  if (!target) return false;
  try {
    return target.getItem(scopedKey(scope)) !== null;
  } catch {
    return false;
  }
}

export function hasImportedDrafts(
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): boolean {
  return loadImportedDrafts(storage, scope).length > 0;
}

export function loadImportedDrafts(
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): ImportedDraftRecord[] {
  const target = getStorage(storage);
  if (!target) return [];
  try {
    return parseRecords(target.getItem(scopedKey(scope)));
  } catch {
    return [];
  }
}

/** Creates the collection once, migrating the legacy single active draft. */
export function initializeImportedDrafts(
  activeProblem: Problem | null,
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): ImportedDraftRecord[] {
  const target = getStorage(storage);
  if (!target) return [];
  try {
    if (target.getItem(scopedKey(scope)) !== null) {
      return loadImportedDrafts(target, scope);
    }
    const timestamp = new Date().toISOString();
    return writeRecords(
      activeProblem
        ? [
            {
              problem: activeProblem,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]
        : [],
      target,
      scope
    );
  } catch {
    return [];
  }
}

export function createImportedDraftSlug(
  drafts: ImportedDraftRecord[],
  timestamp = Date.now(),
  nonce?: string
): string {
  if (!drafts.some((draft) => draft.problem.slug === 'imported-draft')) {
    return 'imported-draft';
  }

  const randomPart = (
    nonce ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10))
  )
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  const base = `imported-draft-${timestamp.toString(36)}-${randomPart || 'draft'}`;
  let slug = base;
  let suffix = 2;
  const occupied = new Set(drafts.map((draft) => draft.problem.slug));
  while (occupied.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

export function saveImportedDraft(
  problem: Problem,
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): ImportedDraftRecord[] {
  const target = getStorage(storage);
  if (!target) return [];
  try {
    const current = loadImportedDrafts(target, scope);
    const existing = current.find(
      (draft) =>
        draft.problem.id === problem.id || draft.problem.slug === problem.slug
    );
    const timestamp = new Date().toISOString();
    return saveImportedDraftCollection(
      upsertImportedDraftRecords(current, [
        {
          problem,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        },
      ]),
      target,
      scope
    );
  } catch {
    return loadImportedDrafts(target, scope);
  }
}

export function deleteImportedDraft(
  slug: string,
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): ImportedDraftRecord[] {
  const target = getStorage(storage);
  if (!target) return [];
  try {
    return saveImportedDraftCollection(
      removeImportedDraftRecords(loadImportedDrafts(target, scope), [slug]),
      target,
      scope
    );
  } catch {
    return loadImportedDrafts(target, scope);
  }
}

export function clearImportedDrafts(
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.removeItem(scopedKey(scope));
    target.removeItem(scopedDroppedKey(scope));
  } catch {
    // Reset remains best-effort when browser storage is restricted.
  }
}

export function consumeImportedDraftClaimDropCount(
  scope: CoachStorageScope,
  storage?: Storage
): number {
  const target = getStorage(storage);
  if (!target) return 0;
  try {
    const key = scopedDroppedKey(scope);
    const count = loadImportedDraftClaimDropCount(scope, target);
    target.removeItem(key);
    return count;
  } catch {
    return 0;
  }
}

export function loadImportedDraftClaimDropCount(
  scope: CoachStorageScope,
  storage?: Storage
): number {
  const target = getStorage(storage);
  if (!target) return 0;
  try {
    const count = Number(target.getItem(scopedDroppedKey(scope)) ?? 0);
    return Number.isInteger(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

/** Moves private guest drafts into the first authenticated namespace. */
export function claimGuestImportedDrafts(
  scope: CoachStorageScope,
  storage?: Storage
): boolean {
  if (scope === 'guest') return false;
  const target = getStorage(storage);
  if (!target) return false;
  try {
    if (!hasImportedDraftCollection(target, 'guest')) return false;
    const guest = loadImportedDrafts(target, 'guest');
    const current = loadImportedDrafts(target, scope);
    const merged = [...current];

    for (const record of guest) {
      if (merged.some((item) => item.problem.id === record.problem.id))
        continue;
      const conflictingSlug = merged.some(
        (item) => item.problem.slug === record.problem.slug
      );
      merged.push(
        conflictingSlug
          ? {
              ...record,
              problem: {
                ...record.problem,
                slug: createImportedDraftSlug(
                  merged,
                  Date.now(),
                  record.problem.id
                ),
              },
            }
          : record
      );
    }

    const retained = mergeImportedDraftRecords([], merged);
    const droppedCount = Math.max(0, merged.length - retained.length);
    writeRecords(retained, target, scope);
    if (droppedCount) {
      target.setItem(scopedDroppedKey(scope), String(droppedCount));
    }
    clearImportedDrafts(target, 'guest');
    return guest.length > 0;
  } catch {
    return false;
  }
}
