import { describe, expect, it } from 'vitest';

import { coachSyncMutationSchema } from './persistence-schema';
import {
  COACH_SYNC_QUEUE_KEY,
  createCoachStorageScope,
  createInitialCoachState,
  getScopedStorageKey,
  loadCoachSyncQueue,
  saveCoachSyncQueue,
} from './storage';
import {
  applyCoachSyncMutation,
  coachSyncRetryDelay,
  createCoachSyncMutation,
} from './sync';
import { LearningArtifact } from './types';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const artifact = (id: string, summary = id): LearningArtifact => ({
  id,
  type: 'hint',
  locale: 'en',
  problemSlug: 'dependency-cycle',
  title: 'Hint',
  summary,
  details: [],
  evidence: [],
  createdAt: '2026-07-13T00:00:00.000Z',
});

describe('coach incremental sync', () => {
  it('creates a field-level mutation and applies retries idempotently', () => {
    const previous = {
      state: createInitialCoachState(),
      importedProblem: null,
    };
    const next = {
      state: {
        ...previous.state,
        profile: {
          goal: 'interview' as const,
          preferredLanguage: 'javascript' as const,
          weeklyTarget: 4,
          onboardedAt: '2026-07-13T00:00:00.000Z',
        },
        artifacts: [artifact('artifact-1')],
      },
      importedProblem: null,
    };

    const mutation = createCoachSyncMutation(previous, next, 7, {
      id: 'mutation-1',
      createdAt: '2026-07-13T00:00:00.000Z',
    });

    expect(mutation).not.toBeNull();
    expect(mutation?.changes).toEqual({
      profile: next.state.profile,
      artifacts: [artifact('artifact-1')],
    });
    expect(coachSyncMutationSchema.safeParse(mutation).success).toBe(true);

    const applied = applyCoachSyncMutation(previous, mutation!);
    const replayed = applyCoachSyncMutation(applied, mutation!);
    expect(applied).toEqual(next);
    expect(replayed).toEqual(applied);
  });

  it('replays only queued local intent over remote conflict data', () => {
    const remote = createInitialCoachState();
    remote.activeAssessment = {
      id: 'remote-active',
      problemSlugs: ['dependency-cycle'],
      startedAt: '2026-07-13T00:00:00.000Z',
      durationMinutes: 20,
    };
    remote.artifacts = [artifact('remote')];

    const previous = {
      state: createInitialCoachState(),
      importedProblem: null,
    };
    const local = {
      state: { ...previous.state, artifacts: [artifact('local')] },
      importedProblem: null,
    };
    const mutation = createCoachSyncMutation(previous, local, 1)!;
    const merged = applyCoachSyncMutation(
      { state: remote, importedProblem: null },
      mutation
    );

    expect(merged.state.activeAssessment?.id).toBe('remote-active');
    expect(merged.state.artifacts.map((item) => item.id)).toEqual([
      'remote',
      'local',
    ]);
  });

  it('persists queues per account and caps exponential retry delay', () => {
    const storage = memoryStorage();
    const scope = createCoachStorageScope('account-a');
    const base = {
      state: createInitialCoachState(),
      importedProblem: null,
    };
    const changed = {
      ...base,
      state: { ...base.state, artifacts: [artifact('queued')] },
    };
    const mutation = createCoachSyncMutation(base, changed, 2, {
      id: 'queued-mutation',
      createdAt: '2026-07-13T00:00:00.000Z',
    })!;

    saveCoachSyncQueue([mutation], storage, scope);

    expect(loadCoachSyncQueue(storage, scope)).toEqual([mutation]);
    expect(
      loadCoachSyncQueue(storage, createCoachStorageScope('account-b'))
    ).toEqual([]);
    expect(
      storage.getItem(getScopedStorageKey(COACH_SYNC_QUEUE_KEY, scope))
    ).toBeTruthy();
    expect([0, 1, 2, 10].map(coachSyncRetryDelay)).toEqual([
      1000, 2000, 4000, 30_000,
    ]);
  });
});
