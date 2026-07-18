import { describe, expect, it } from 'vitest';

import {
  ASSESSMENT_DRAFT_KEY,
  claimGuestAssessmentDraft,
  clearAssessmentDraft,
  loadAssessmentDraft,
  saveAssessmentDraft,
} from './assessment-draft';
import type { AssessmentDraftV1 } from './types';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

function draft(): AssessmentDraftV1 {
  return {
    version: 1,
    assessmentId: 'assessment-1',
    kind: 'practice',
    token: 'x'.repeat(64),
    problemVersions: [
      { slug: 'two-sum', contentVersion: 1 },
      { slug: 'valid-brackets', contentVersion: 2 },
    ],
    startedAt: '2026-07-18T00:00:00.000Z',
    expiresAt: '2026-07-18T00:20:00.000Z',
    graceExpiresAt: '2026-07-18T00:25:00.000Z',
    serverOffsetMs: -300_000,
    language: 'javascript',
    codes: { 'two-sum': { javascript: 'function solve() {}' } },
    activeIndex: 1,
    sampleResults: {},
    updatedAt: '2026-07-18T00:01:00.000Z',
  };
}

describe('assessment draft persistence', () => {
  it('round-trips a scoped versioned draft', () => {
    const storage = memoryStorage();
    saveAssessmentDraft(draft(), 'user:user-1', storage);

    expect(loadAssessmentDraft('user:user-1', storage)).toEqual(draft());
    expect(storage.values.has(`${ASSESSMENT_DRAFT_KEY}:user:user-1`)).toBe(
      true
    );
  });

  it('removes malformed or unsupported drafts', () => {
    const storage = memoryStorage();
    storage.setItem(ASSESSMENT_DRAFT_KEY, JSON.stringify({ version: 2 }));

    expect(loadAssessmentDraft('guest', storage)).toBeNull();
    expect(storage.values.has(ASSESSMENT_DRAFT_KEY)).toBe(false);
  });

  it('migrates an earlier v1 draft to a zero clock offset until resume', () => {
    const storage = memoryStorage();
    const legacy = { ...draft() } as Partial<AssessmentDraftV1>;
    delete legacy.serverOffsetMs;
    storage.setItem(ASSESSMENT_DRAFT_KEY, JSON.stringify(legacy));

    expect(loadAssessmentDraft('guest', storage)?.serverOffsetMs).toBe(0);
  });

  it('clears only the requested storage scope', () => {
    const storage = memoryStorage();
    saveAssessmentDraft(draft(), 'guest', storage);
    saveAssessmentDraft(draft(), 'user:user-1', storage);

    clearAssessmentDraft('guest', storage);

    expect(loadAssessmentDraft('guest', storage)).toBeNull();
    expect(loadAssessmentDraft('user:user-1', storage)).not.toBeNull();
  });

  it('copies a guest assessment until the durable claim is acknowledged', () => {
    const storage = memoryStorage();
    saveAssessmentDraft(draft(), 'guest', storage);

    expect(
      claimGuestAssessmentDraft('user:user-1', storage as unknown as Storage, {
        clearGuest: false,
      })
    ).toBe(true);
    expect(loadAssessmentDraft('guest', storage)).not.toBeNull();
    expect(loadAssessmentDraft('user:user-1', storage)).toEqual(draft());

    clearAssessmentDraft('guest', storage);
    expect(loadAssessmentDraft('user:user-1', storage)).toEqual(draft());
  });
});
