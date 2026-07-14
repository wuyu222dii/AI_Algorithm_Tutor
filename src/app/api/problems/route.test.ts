import type { PublishedProblem } from '@/features/algorithm-coach/catalog-repository.server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  listRuntimeProblems: vi.fn(),
  runtimeEnabledLanguages: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/algorithm-coach/catalog-runtime.server', () => ({
  listRuntimeProblems: mocks.listRuntimeProblems,
  runtimeEnabledLanguages: mocks.runtimeEnabledLanguages,
}));

function problem(slug: string, version = 1): PublishedProblem {
  return {
    id: `problem-${slug}`,
    slug,
    title: { zh: slug, en: slug },
    description: { zh: '题面', en: 'Statement' },
    difficulty: 'easy',
    topics: ['array-hash'],
    languageConfigs: {
      javascript: { entryPoint: 'solve', template: 'function solve() {}' },
      typescript: {
        entryPoint: 'solve',
        template: 'function solve(): unknown {}',
      },
      python: { entryPoint: 'solve', template: 'def solve(): pass' },
    },
    version: { contentVersion: version, catalogVersion: 'catalog-v1' },
    tests: [],
    examples: [],
    constraints: [],
    hints: { zh: ['', '', ''], en: ['', '', ''] },
    reviewPoints: [],
    estimatedMinutes: 10,
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
    mocks.listRuntimeProblems.mockResolvedValue([
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
    expect(body.data.nextCursor).toBeTruthy();
    expect(mocks.listRuntimeProblems).toHaveBeenCalledWith({
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
    expect(mocks.listRuntimeProblems).not.toHaveBeenCalled();
  });

  it('does not advertise or accept a disabled TypeScript runtime', async () => {
    mocks.runtimeEnabledLanguages.mockReturnValue(['javascript', 'python']);

    const listResponse = await GET(
      new Request('http://localhost/api/problems')
    );
    const listBody = await listResponse.json();
    expect(listBody.data.items[0].supportedLanguages).toEqual([
      'javascript',
      'python',
    ]);

    mocks.listRuntimeProblems.mockClear();
    const filteredResponse = await GET(
      new Request('http://localhost/api/problems?language=typescript')
    );
    expect(filteredResponse.status).toBe(400);
    expect(mocks.listRuntimeProblems).not.toHaveBeenCalled();
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
});
