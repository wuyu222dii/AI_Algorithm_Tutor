import { describe, expect, it } from 'vitest';

import { persistedCoachStateSchema } from './persistence-schema';
import { createInitialCoachState } from './storage';

describe('public learning-state evidence boundary', () => {
  it('accepts local self-assessment evidence and rejects remote verification claims', () => {
    const state = createInitialCoachState();
    const assessment = {
      id: 'assessment_123',
      kind: 'practice' as const,
      problemSlugs: ['two-value-target'],
      problemVersions: [{ slug: 'two-value-target', contentVersion: 1 }],
      score: 100,
      correctCount: 1,
      totalCount: 1,
      weakTopics: [],
      recommendation: 'Continue practicing.',
      averageDurationMs: 1_000,
      startedAt: '2026-07-18T00:00:00.000Z',
      completedAt: '2026-07-18T00:01:00.000Z',
      evidenceMode: 'browser_local' as const,
    };

    expect(
      persistedCoachStateSchema.safeParse({
        ...state,
        assessments: [assessment],
      }).success
    ).toBe(true);
    expect(
      persistedCoachStateSchema.safeParse({
        ...state,
        assessments: [
          { ...assessment, evidenceMode: 'remote_verified' as const },
        ],
      }).success
    ).toBe(false);
  });
});
