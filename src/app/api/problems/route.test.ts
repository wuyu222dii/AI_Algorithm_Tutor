import type { ProblemSummary } from '@/features/algorithm-coach/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  listRuntimeProblemSummaries: vi.fn(),
  runtimeEnabledLanguages: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/algorithm-coach/catalog-runtime.server', () => ({
  listRuntimeProblemSummaries: mocks.listRuntimeProblemSummaries,
  runtimeEnabledLanguages: mocks.runtimeEnabledLanguages,
}));

function problem(slug: string, version = 1): ProblemSummary {
  return {
    id: `problem-${slug}`,
    slug,
    title: { zh: slug, en: slug },
    description: { zh: `${slug} 描述`, en: `${slug} description` },
    difficulty: 'easy',
    topics: ['array-hash'],
    estimatedMinutes: 10,
    contentVersion: version,
    catalogVersion: 'catalog-v1',
    version: { contentVersion: version, catalogVersion: 'catalog-v1' },
    supportedLanguages: ['javascript', 'typescript', 'python'],
  };
}

describe('GET /api/problems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeEnabledLanguages.mockReturnValue([
      'javascript',
      'typescript',
      'python',
    ]);
    mocks.listRuntimeProblemSummaries.mockResolvedValue([
      problem('alpha-problem'),
      problem('beta-problem'),
    ]);
  });

  it('returns cursor-paginated summaries and forwards validated filters', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/problems?limit=1&difficulty=easy&topic=array-hash&language=typescript'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      slug: 'alpha-problem',
      contentVersion: 1,
      supportedLanguages: ['javascript', 'typescript', 'python'],
    });
    expect(body.data.items[0].description.en).toBe('alpha-problem description');
    expect(body.data.items[0]).not.toHaveProperty('languageConfigs');
    expect(body.data.items[0]).not.toHaveProperty('tests');
    expect(body.data.items[0]).not.toHaveProperty('hints');
    expect(body.data.nextCursor).toBeTruthy();
    expect(mocks.listRuntimeProblemSummaries).toHaveBeenCalledWith({
      difficulty: 'easy',
      language: 'typescript',
      topic: 'array-hash',
      afterSlug: undefined,
      limit: 2,
    });
  });

  it('rejects malformed filters before accessing PostgreSQL', async () => {
    const response = await GET(
      new Request('http://localhost/api/problems?difficulty=impossible')
    );

    expect(response.status).toBe(400);
    expect(mocks.listRuntimeProblemSummaries).not.toHaveBeenCalled();
  });

  it('does not advertise or accept a disabled TypeScript runtime', async () => {
    mocks.runtimeEnabledLanguages.mockReturnValue(['javascript', 'python']);
    mocks.listRuntimeProblemSummaries.mockResolvedValue([
      {
        ...problem('alpha-problem'),
        supportedLanguages: ['javascript', 'python'],
      },
    ]);

    const listResponse = await GET(
      new Request('http://localhost/api/problems')
    );
    const listBody = await listResponse.json();
    expect(listBody.data.items[0].supportedLanguages).toEqual([
      'javascript',
      'python',
    ]);

    mocks.listRuntimeProblemSummaries.mockClear();
    const filteredResponse = await GET(
      new Request('http://localhost/api/problems?language=typescript')
    );
    expect(filteredResponse.status).toBe(400);
    expect(mocks.listRuntimeProblemSummaries).not.toHaveBeenCalled();
  });

  it('supports conditional requests with a stable ETag', async () => {
    const first = await GET(new Request('http://localhost/api/problems'));
    const second = await GET(
      new Request('http://localhost/api/problems', {
        headers: { 'if-none-match': first.headers.get('etag') ?? '' },
      })
    );

    expect(first.headers.get('etag')).toBeTruthy();
    expect(second.status).toBe(304);
  });

  it('returns an empty page when valid filters have no matches', async () => {
    mocks.listRuntimeProblemSummaries.mockResolvedValue([]);

    const response = await GET(
      new Request('http://localhost/api/problems?topic=dfs')
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { items: [], nextCursor: null },
    });
  });
});
