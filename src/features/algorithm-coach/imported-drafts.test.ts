import { describe, expect, it } from 'vitest';

import {
  clearImportedDrafts,
  consumeImportedDraftClaimDropCount,
  createImportedDraftSlug,
  deleteImportedDraft,
  hasImportedDraftCollection,
  initializeImportedDrafts,
  loadImportedDraftClaimDropCount,
  loadImportedDrafts,
  MAX_IMPORTED_DRAFTS,
  saveImportedDraft,
} from './imported-drafts';
import { claimGuestCoachData, type CoachStorageScope } from './storage';
import type { Problem } from './types';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function problem(id: string, slug: string, sourceUrl?: string): Problem {
  return {
    id,
    slug,
    title: { zh: `草稿 ${id}`, en: `Draft ${id}` },
    description: { zh: '题目描述', en: 'Problem statement' },
    difficulty: 'medium',
    topics: ['custom'],
    entryPoint: 'solve',
    templates: {
      javascript: 'function solve(input) { return input; }',
      python: 'def solve(input):\n    return input',
    },
    tests: [],
    examples: [],
    constraints: [],
    hints: { zh: ['', '', ''], en: ['', '', ''] },
    reviewPoints: [],
    estimatedMinutes: 20,
    sourceStatement: `Source statement ${id}`,
    sourceUrl,
  };
}

describe('imported draft storage', () => {
  it('migrates the legacy active draft while keeping the compatibility slug', () => {
    const storage = createMemoryStorage();
    const legacy = problem(
      'legacy',
      'imported-draft',
      'https://example.com/problem'
    );

    const drafts = initializeImportedDrafts(legacy, storage);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.problem).toMatchObject({
      id: 'legacy',
      slug: 'imported-draft',
      sourceStatement: 'Source statement legacy',
      sourceUrl: 'https://example.com/problem',
    });
  });

  it('allocates unique routes after the first draft and retains at most 20', () => {
    const storage = createMemoryStorage();
    let drafts = saveImportedDraft(
      problem('draft-0', 'imported-draft'),
      storage
    );
    expect(createImportedDraftSlug(drafts, 100, 'fixed')).toBe(
      'imported-draft-2s-fixed'
    );

    for (let index = 1; index <= MAX_IMPORTED_DRAFTS + 3; index += 1) {
      drafts = saveImportedDraft(
        problem(`draft-${index}`, `imported-draft-${index}`),
        storage
      );
    }

    expect(drafts).toHaveLength(MAX_IMPORTED_DRAFTS);
    expect(drafts[0]?.problem.id).toBe(`draft-${MAX_IMPORTED_DRAFTS + 3}`);
    expect(new Set(drafts.map((item) => item.problem.slug)).size).toBe(
      MAX_IMPORTED_DRAFTS
    );
  });

  it('keeps an empty collection after deletion instead of remigrating stale data', () => {
    const storage = createMemoryStorage();
    const legacy = problem('legacy', 'imported-draft');
    initializeImportedDrafts(legacy, storage);

    expect(deleteImportedDraft(legacy.slug, storage)).toEqual([]);
    expect(hasImportedDraftCollection(storage)).toBe(true);
    expect(initializeImportedDrafts(legacy, storage)).toEqual([]);
  });

  it('claims guest drafts without overwriting an account draft', () => {
    const storage = createMemoryStorage();
    const account = 'user:account-a' as CoachStorageScope;
    saveImportedDraft(problem('guest', 'imported-draft'), storage, 'guest');
    saveImportedDraft(problem('account', 'imported-draft'), storage, account);

    expect(claimGuestCoachData(account, storage)).toBe(true);

    const accountDrafts = loadImportedDrafts(storage, account);
    expect(accountDrafts.map((item) => item.problem.id)).toEqual(
      expect.arrayContaining(['account', 'guest'])
    );
    expect(
      accountDrafts.find((item) => item.problem.id === 'account')?.problem.slug
    ).toBe('imported-draft');
    expect(
      accountDrafts.find((item) => item.problem.id === 'guest')?.problem.slug
    ).toMatch(/^imported-draft-/);
    expect(loadImportedDrafts(storage, 'guest')).toEqual([]);
    expect(hasImportedDraftCollection(storage, 'guest')).toBe(false);
  });

  it('clears only the selected account namespace', () => {
    const storage = createMemoryStorage();
    const account = 'user:account-a' as CoachStorageScope;
    saveImportedDraft(problem('guest', 'imported-draft'), storage, 'guest');
    saveImportedDraft(problem('account', 'imported-draft'), storage, account);

    clearImportedDrafts(storage, account);

    expect(loadImportedDrafts(storage, account)).toEqual([]);
    expect(loadImportedDrafts(storage, 'guest')).toHaveLength(1);
  });

  it('keeps the most recent claimed drafts and records capacity drops', () => {
    const storage = createMemoryStorage();
    const account = 'user:capacity-account' as CoachStorageScope;
    for (let index = 0; index < MAX_IMPORTED_DRAFTS; index += 1) {
      saveImportedDraft(
        problem(
          `account-${index}`,
          index === 0 ? 'imported-draft' : `imported-draft-account-${index}`
        ),
        storage,
        account
      );
    }
    saveImportedDraft(
      problem('guest-first', 'imported-draft'),
      storage,
      'guest'
    );
    saveImportedDraft(
      problem('guest-second', 'imported-draft-guest-second'),
      storage,
      'guest'
    );

    expect(claimGuestCoachData(account, storage)).toBe(true);

    const retainedIds = loadImportedDrafts(storage, account).map(
      (record) => record.problem.id
    );
    expect(retainedIds).toHaveLength(MAX_IMPORTED_DRAFTS);
    expect(retainedIds).toEqual(
      expect.arrayContaining(['guest-first', 'guest-second'])
    );
    expect(loadImportedDraftClaimDropCount(account, storage)).toBe(2);
    expect(loadImportedDraftClaimDropCount(account, storage)).toBe(2);
    expect(consumeImportedDraftClaimDropCount(account, storage)).toBe(2);
    expect(consumeImportedDraftClaimDropCount(account, storage)).toBe(0);
  });
});
