import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  claimGuestCoachData,
  COACH_ANALYTICS_KEY,
  COACH_EXPERIMENT_KEY,
  COACH_GUEST_CLAIM_KEY,
  COACH_STORAGE_KEY,
  createCoachStorageScope,
  createInitialCoachState,
  getScopedStorageKey,
  loadCoachState,
  loadImportedProblem,
  saveCoachState,
  saveImportedProblem,
} from './storage';
import { CoachProvider, useCoachStore } from './store';
import { LearningArtifact, Problem, ProductEvent } from './types';

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

const reviewCard: LearningArtifact = {
  id: 'review_card_test',
  type: 'review_card',
  locale: 'zh',
  problemSlug: 'dependency-cycle',
  title: '复习卡片',
  summary: '依赖图成环复习要点',
  details: ['使用三色状态记录 DFS 路径。'],
  evidence: ['最近运行：4/4 通过。'],
  reviewCard: {
    front: '如何判断有向依赖图成环？',
    back: '访问到当前路径中的节点时存在环。',
    tags: ['dfs'],
  },
  createdAt: '2026-07-12T00:00:00.000Z',
};

const importedProblem: Problem = {
  id: 'imported-test',
  slug: 'imported-draft',
  title: { zh: '导入题', en: 'Imported problem' },
  description: { zh: '测试题目', en: 'Test problem' },
  difficulty: 'easy',
  topics: ['custom'],
  entryPoint: 'solve',
  templates: { javascript: 'function solve() {}', python: 'def solve(): pass' },
  tests: [],
  examples: [],
  constraints: [],
  hints: { zh: ['', '', ''], en: ['', '', ''] },
  reviewPoints: [],
  estimatedMinutes: 10,
};

const activationEvent: ProductEvent = {
  id: 'event_guest_activation',
  name: 'activated',
  timestamp: '2026-07-12T00:00:00.000Z',
  sessionId: 'session_guest',
};

describe('CoachProvider persistence', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: createMemoryStorage(),
    });
  });

  it('persists an added review card artifact to versioned localStorage', async () => {
    const { result } = renderHook(() => useCoachStore(), {
      wrapper: CoachProvider,
    });

    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.addArtifact(reviewCard));

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(COACH_STORAGE_KEY) ?? '{}'
      ) as { artifacts?: LearningArtifact[] };
      expect(stored.artifacts).toContainEqual(reviewCard);
    });
  });

  it('keeps the original storage key for guest compatibility', () => {
    const storage = createMemoryStorage();
    const guest = createInitialCoachState();
    guest.artifacts.push(reviewCard);

    saveCoachState(guest, storage);

    expect(storage.getItem(COACH_STORAGE_KEY)).toBeTruthy();
    expect(
      storage.getItem(
        getScopedStorageKey(COACH_STORAGE_KEY, createCoachStorageScope('a'))
      )
    ).toBeNull();
  });

  it('lets only the first account claim guest data and isolates later accounts', () => {
    const storage = createMemoryStorage();
    const guest = createInitialCoachState();
    guest.profile = {
      goal: 'interview',
      preferredLanguage: 'javascript',
      weeklyTarget: 5,
      onboardedAt: '2026-07-12T00:00:00.000Z',
    };
    guest.artifacts.push(reviewCard);
    saveCoachState(guest, storage);
    saveImportedProblem(importedProblem, storage);
    storage.setItem(COACH_ANALYTICS_KEY, JSON.stringify([activationEvent]));
    storage.setItem(COACH_EXPERIMENT_KEY, 'B');

    const accountA = createCoachStorageScope('account-a');
    const accountB = createCoachStorageScope('account-b');

    expect(claimGuestCoachData(accountA, storage)).toBe(true);
    expect(storage.getItem(COACH_GUEST_CLAIM_KEY)).toBe(accountA);
    expect(loadCoachState(storage, accountA).profile?.goal).toBe('interview');
    expect(loadCoachState(storage, accountA).artifacts).toContainEqual(
      reviewCard
    );
    expect(loadImportedProblem(storage, accountA)).toEqual(importedProblem);
    expect(
      JSON.parse(
        storage.getItem(getScopedStorageKey(COACH_ANALYTICS_KEY, accountA)) ??
          '[]'
      )
    ).toContainEqual(activationEvent);
    expect(
      storage.getItem(getScopedStorageKey(COACH_EXPERIMENT_KEY, accountA))
    ).toBe('B');

    expect(loadCoachState(storage).profile).toBeNull();
    expect(loadImportedProblem(storage)).toBeNull();

    const signedOutGuest = createInitialCoachState();
    signedOutGuest.profile = {
      goal: 'contest',
      preferredLanguage: 'python',
      weeklyTarget: 3,
      onboardedAt: '2026-07-13T00:00:00.000Z',
    };
    saveCoachState(signedOutGuest, storage);

    expect(claimGuestCoachData(accountB, storage)).toBe(false);
    expect(loadCoachState(storage, accountB).profile).toBeNull();
    expect(loadCoachState(storage, accountA).profile?.goal).toBe('interview');
    expect(loadCoachState(storage).profile?.goal).toBe('contest');
  });
});
