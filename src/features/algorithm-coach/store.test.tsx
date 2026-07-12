import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { COACH_STORAGE_KEY } from './storage';
import { CoachProvider, useCoachStore } from './store';
import { LearningArtifact } from './types';

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
});
