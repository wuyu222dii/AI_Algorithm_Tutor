import type { PublishedProblem } from '@/features/algorithm-coach/catalog-repository.server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  getRuntimeProblem: vi.fn(),
  runtimeEnabledLanguages: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/algorithm-coach/catalog-runtime.server', () => ({
  getRuntimeProblem: mocks.getRuntimeProblem,
  runtimeEnabledLanguages: mocks.runtimeEnabledLanguages,
}));

const fixture: PublishedProblem = {
  id: 'problem-alpha',
  slug: 'alpha-problem',
  title: { zh: '示例题', en: 'Example problem' },
  description: { zh: '题面', en: 'Statement' },
  difficulty: 'easy',
  topics: ['array-hash'],
  languageConfigs: {
    javascript: { entryPoint: 'solve', template: 'function solve() {}' },
    typescript: {
      entryPoint: 'solve',
      template: 'function solve(): unknown {}',
    },
  },
  version: { contentVersion: 2 },
  tests: [
    {
      id: 'sample-1',
      args: [[1, 2]],
      expected: 3,
      isSample: true,
    },
    {
      id: 'hidden-1',
      args: [[40, 2]],
      expected: 42,
      isSample: false,
    },
  ],
  examples: [],
  constraints: [],
  hints: { zh: ['', '', ''], en: ['', '', ''] },
  reviewPoints: [],
  estimatedMinutes: 10,
};

describe('GET /api/problems/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeEnabledLanguages.mockReturnValue([
      'javascript',
      'typescript',
      'python',
    ]);
    mocks.getRuntimeProblem.mockResolvedValue(fixture);
  });

  it('loads an immutable version and never returns hidden tests', async () => {
    const response = await GET(
      new Request('http://localhost/api/problems/alpha-problem?version=2'),
      { params: Promise.resolve({ slug: 'alpha-problem' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getRuntimeProblem).toHaveBeenCalledWith('alpha-problem', 2);
    expect(body.data.tests).toEqual([
      expect.objectContaining({ id: 'sample-1', isSample: true }),
    ]);
    expect(body.data.supportedLanguages).toEqual(['javascript', 'typescript']);
    expect(JSON.stringify(body)).not.toContain('hidden-1');
    expect(JSON.stringify(body)).not.toContain('42');
  });

  it('returns 404 without exposing repository details', async () => {
    mocks.getRuntimeProblem.mockResolvedValue(undefined);
    const response = await GET(
      new Request('http://localhost/api/problems/missing-problem'),
      { params: Promise.resolve({ slug: 'missing-problem' }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Problem not found.' },
    });
  });

  it('omits disabled language contracts from problem details', async () => {
    mocks.runtimeEnabledLanguages.mockReturnValue(['javascript', 'python']);
    const response = await GET(
      new Request('http://localhost/api/problems/alpha-problem?version=2'),
      { params: Promise.resolve({ slug: 'alpha-problem' }) }
    );
    const body = await response.json();

    expect(body.data.languageConfigs.javascript).toBeTruthy();
    expect(body.data.languageConfigs.typescript).toBeUndefined();
  });

  it('rejects an invalid version before querying the repository', async () => {
    const response = await GET(
      new Request('http://localhost/api/problems/alpha-problem?version=0'),
      { params: Promise.resolve({ slug: 'alpha-problem' }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.getRuntimeProblem).not.toHaveBeenCalled();
  });
});
