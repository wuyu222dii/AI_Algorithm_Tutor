import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getRuntimeCoachProblem,
  getRuntimeProblem,
  listRuntimeProblems,
  resetRuntimeProblemCacheForTests,
} from './catalog-runtime.server';
import type { Problem } from './types';

const mocks = vi.hoisted(() => ({
  getPublishedCoachProblemBySlug: vi.fn(),
  getPublishedProblemBySlug: vi.fn(),
  listPublishedProblems: vi.fn(),
}));

vi.mock('./catalog-repository.server', () => ({
  getPublishedCoachProblemBySlug: mocks.getPublishedCoachProblemBySlug,
  getPublishedProblemBySlug: mocks.getPublishedProblemBySlug,
  listPublishedProblems: mocks.listPublishedProblems,
}));

function problem(tests: Problem['tests']): Problem {
  return {
    id: 'problem-1',
    slug: 'problem-one',
    title: { zh: '题目一', en: 'Problem one' },
    description: { zh: '描述', en: 'Description' },
    difficulty: 'easy',
    topics: ['array-hash'],
    languageConfigs: {},
    version: { contentVersion: 1 },
    tests,
    examples: [],
    constraints: [],
    hints: { zh: ['提示一', '提示二', '提示三'], en: ['One', 'Two', 'Three'] },
    reviewPoints: [],
    estimatedMinutes: 10,
  };
}

describe('runtime revision caches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DB_CATALOG_ENABLED', 'true');
    resetRuntimeProblemCacheForTests();
  });

  afterEach(() => {
    resetRuntimeProblemCacheForTests();
    vi.unstubAllEnvs();
  });

  it('never serves a test-free AI context as a full practice problem', async () => {
    const context = problem([]);
    const full = problem([
      { id: 'test-1', args: [[1, 2]], expected: 3, isSample: true },
    ]);
    mocks.getPublishedCoachProblemBySlug.mockResolvedValue(context);
    mocks.getPublishedProblemBySlug.mockResolvedValue(full);

    await expect(
      getRuntimeCoachProblem('problem-one', 1)
    ).resolves.toMatchObject({ tests: [] });
    expect(mocks.getPublishedCoachProblemBySlug).toHaveBeenCalledTimes(1);
    await expect(getRuntimeProblem('problem-one', 1)).resolves.toMatchObject({
      tests: [{ id: 'test-1' }],
    });
    expect(mocks.getPublishedProblemBySlug).toHaveBeenCalledTimes(1);
  });

  it('reuses a full immutable revision for subsequent AI context', async () => {
    const full = problem([
      { id: 'test-1', args: [[1, 2]], expected: 3, isSample: true },
    ]);
    mocks.listPublishedProblems.mockResolvedValue([full]);

    const [listed] = await listRuntimeProblems();
    await expect(getRuntimeCoachProblem('problem-one', 1)).resolves.toBe(
      listed
    );
    expect(mocks.getPublishedCoachProblemBySlug).not.toHaveBeenCalled();
  });
});
