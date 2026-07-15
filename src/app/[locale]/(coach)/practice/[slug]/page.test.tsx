import { beforeEach, describe, expect, it, vi } from 'vitest';

import Page from './page';

const mocks = vi.hoisted(() => ({
  getRuntimeProblem: vi.fn(),
}));

vi.mock('@/features/algorithm-coach/catalog-runtime.server', () => ({
  getRuntimeProblem: mocks.getRuntimeProblem,
}));

vi.mock('@/features/algorithm-coach/imported-drafts', () => ({
  isImportedDraftSlug: (slug: string) => slug === 'imported-draft',
}));

vi.mock('@/features/algorithm-coach/components/practice-workspace', () => ({
  PracticeWorkspace: () => null,
}));

describe('versioned practice page', () => {
  beforeEach(() => {
    mocks.getRuntimeProblem.mockReset();
  });

  it('loads and pins an explicitly requested problem revision', async () => {
    const revision = {
      id: 'problem-one',
      slug: 'problem-one',
      version: { contentVersion: 2 },
    };
    mocks.getRuntimeProblem.mockResolvedValue(revision);

    const element = await Page({
      params: Promise.resolve({ slug: 'problem-one' }),
      searchParams: Promise.resolve({ version: '2' }),
    });

    expect(mocks.getRuntimeProblem).toHaveBeenCalledWith('problem-one', 2);
    expect(element.props).toMatchObject({
      slug: 'problem-one',
      initialProblem: revision,
      requestedContentVersion: 2,
      versionUnavailable: false,
    });
  });

  it('reports a missing or invalid revision instead of loading current content', async () => {
    mocks.getRuntimeProblem.mockResolvedValue(undefined);

    const missing = await Page({
      params: Promise.resolve({ slug: 'problem-one' }),
      searchParams: Promise.resolve({ version: '7' }),
    });
    const invalid = await Page({
      params: Promise.resolve({ slug: 'problem-one' }),
      searchParams: Promise.resolve({ version: 'latest' }),
    });

    expect(missing.props).toMatchObject({
      requestedContentVersion: 7,
      versionUnavailable: true,
    });
    expect(invalid.props).toMatchObject({
      requestedContentVersion: undefined,
      versionUnavailable: true,
    });
    expect(mocks.getRuntimeProblem).toHaveBeenCalledTimes(1);
  });

  it('leaves the unversioned route on the normal current-catalog path', async () => {
    const element = await Page({
      params: Promise.resolve({ slug: 'problem-one' }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.getRuntimeProblem).not.toHaveBeenCalled();
    expect(element.props).toMatchObject({
      slug: 'problem-one',
      requestedContentVersion: undefined,
      versionUnavailable: false,
    });
  });
});
