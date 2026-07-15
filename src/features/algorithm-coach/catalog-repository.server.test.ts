import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPublishedProblemBySlug,
  listPublishedProblems,
} from './catalog-repository.server';

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then: (
    resolve: (value: unknown[]) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise<unknown>;
}

const mocks = vi.hoisted(() => ({
  queryResults: [] as unknown[][],
  builders: [] as MockQueryBuilder[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/core/db', () => ({
  dbPostgres: () => {
    const result = mocks.queryResults.shift() ?? [];
    const builder = {} as MockQueryBuilder;
    const chain = vi.fn(() => builder);
    builder.select = chain;
    builder.from = chain;
    builder.innerJoin = chain;
    builder.leftJoin = chain;
    builder.where = chain;
    builder.orderBy = chain;
    builder.limit = chain;
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    mocks.builders.push(builder);
    return builder;
  },
}));

const revisionRow = {
  id: 'ac-001',
  slug: 'first-unique-position',
  source: 'curated',
  version: 1,
  title: { zh: '首个唯一元素', en: 'First unique value' },
  description: { zh: '题面', en: 'Statement' },
  difficulty: 'easy',
  topics: ['array-hash'],
  entryPoint: 'firstUniquePosition',
  templates: {
    javascript: 'function firstUniquePosition(values) {}',
    python: 'def first_unique_position(values): pass',
  },
  languageConfigs: {
    javascript: {
      entryPoint: 'firstUniquePosition',
      template: 'function firstUniquePosition(values) {}',
      runtimeVersion: 'quickjs@test',
    },
    typescript: {
      entryPoint: 'firstUniquePosition',
      template: 'function firstUniquePosition(values: number[]) {}',
      runtimeVersion: 'typescript@test',
    },
  },
  signature: {
    parameters: [
      {
        name: 'values',
        type: { kind: 'array', items: { kind: 'number' } },
      },
    ],
    returns: { kind: 'number' },
  },
  examples: [],
  constraints: [],
  hints: { zh: ['', '', ''], en: ['', '', ''] },
  reviewPoints: [],
  learningObjectives: [{ zh: '掌握边界搜索', en: 'Master boundary search' }],
  prerequisiteTopics: ['binary-search'],
  solutionPatterns: ['lower-bound'],
  estimatedMinutes: 12,
  sourceStatement: null,
  sourceUrl: null,
  sourceRevision: 'legacy-static-catalog',
  catalogVersion: 'legacy-v1',
  revisionContentHash: 'sha256:revision-v1',
  revisionId: 'revision-ac-001-v1',
  originExternalId: 'two-fer',
  originUpstreamUrl: 'https://example.test/two-fer',
  originLicenseSpdx: 'MIT',
  originAttribution: 'Exercism contributors',
  originSourceRevision: 'abc123',
  originContentHash: 'sha256:123',
  originFetchedAt: new Date('2026-07-14T00:00:00.000Z'),
  originProvider: 'exercism',
};

describe('PostgreSQL catalog repository', () => {
  beforeEach(() => {
    mocks.queryResults = [];
    mocks.builders = [];
  });

  it('hydrates immutable revisions, language contracts, origin, and all tests', async () => {
    mocks.queryResults.push(
      [revisionRow],
      [
        {
          revisionId: revisionRow.revisionId,
          id: 'sample-1',
          args: [[1, 2, 1]],
          expected: 1,
          isSample: true,
          label: null,
        },
        {
          revisionId: revisionRow.revisionId,
          id: 'hidden-1',
          args: [[2, 2]],
          expected: -1,
          isSample: false,
          label: null,
        },
      ]
    );

    const problems = await listPublishedProblems({
      language: 'typescript',
      limit: 20,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      slug: 'first-unique-position',
      version: {
        contentVersion: 1,
        catalogVersion: 'legacy-v1',
        runtimeVersions: {
          javascript: 'quickjs@test',
          typescript: 'typescript@test',
        },
      },
      origin: {
        provider: 'exercism',
        licenseSpdx: 'MIT',
        sourceRevision: 'legacy-static-catalog',
        contentHash: 'sha256:revision-v1',
      },
      learningObjectives: [
        { zh: '掌握边界搜索', en: 'Master boundary search' },
      ],
      prerequisiteTopics: ['binary-search'],
      solutionPatterns: ['lower-bound'],
    });
    expect(problems[0].tests.map((test) => test.id)).toEqual([
      'sample-1',
      'hidden-1',
    ]);
    expect(mocks.builders[0].limit).toHaveBeenCalledWith(20);
  });

  it('does not query tests when a requested version does not exist', async () => {
    mocks.queryResults.push([]);

    await expect(
      getPublishedProblemBySlug('first-unique-position', 99)
    ).resolves.toBeUndefined();
    expect(mocks.builders).toHaveLength(1);
  });

  it('hydrates an explicitly requested historical revision', async () => {
    mocks.queryResults.push(
      [{ ...revisionRow, version: 2, revisionId: 'revision-ac-001-v2' }],
      [
        {
          revisionId: 'revision-ac-001-v2',
          id: 'historical-test',
          args: [[1]],
          expected: 0,
          isSample: true,
          label: null,
        },
      ]
    );

    const problem = await getPublishedProblemBySlug('first-unique-position', 2);

    expect(problem).toMatchObject({
      slug: 'first-unique-position',
      version: { contentVersion: 2 },
      tests: [{ id: 'historical-test' }],
    });
    expect(mocks.builders).toHaveLength(2);
  });

  it('prefers immutable revision provenance over the mutable current origin', async () => {
    mocks.queryResults.push(
      [
        {
          ...revisionRow,
          sourceUrl: 'https://example.test/two-fer/v1',
          sourceRevision: 'revision-sha-v1',
          revisionSourceExternalId: 'two-fer',
          revisionSourceStatementPath: 'exercises/two-fer/instructions.md',
          revisionSourceLicenseSpdx: 'MIT',
          revisionSourceLicenseHash: 'sha256:license-v1',
          revisionSourceAttribution: 'Revision one attribution',
          revisionSourceFetchedAt: new Date('2026-06-01T00:00:00.000Z'),
          originUpstreamUrl: 'https://example.test/two-fer/current',
          originSourceRevision: 'revision-sha-current',
          originAttribution: 'Current attribution',
        },
      ],
      []
    );

    const problem = await getPublishedProblemBySlug('first-unique-position', 1);

    expect(problem?.origin).toEqual({
      provider: 'exercism',
      externalId: 'two-fer',
      upstreamUrl: 'https://example.test/two-fer/v1',
      licenseSpdx: 'MIT',
      attribution: 'Revision one attribution',
      sourceRevision: 'revision-sha-v1',
      contentHash: 'sha256:revision-v1',
      fetchedAt: '2026-06-01T00:00:00.000Z',
      statementPath: 'exercises/two-fer/instructions.md',
      licenseHash: 'sha256:license-v1',
    });
  });
});
