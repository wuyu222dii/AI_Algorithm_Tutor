import { describe, expect, it } from 'vitest';

import {
  toAssessmentProblemDetail,
  toProblemSummary,
  toPublicProblemDetail,
} from './problem-contracts';
import type { Problem } from './types';

const problem: Problem = {
  id: 'problem-alpha',
  slug: 'alpha',
  title: { zh: '示例题', en: 'Example' },
  description: { zh: '题面', en: 'Statement' },
  difficulty: 'easy',
  topics: ['array-hash'],
  languageConfigs: {
    javascript: { entryPoint: 'solve', template: 'function solve() {}' },
    typescript: { entryPoint: 'solve', template: 'function solve() {}' },
  },
  version: { contentVersion: 3, catalogVersion: 'catalog-v3' },
  tests: [
    { id: 'sample', args: [1], expected: 1, isSample: true },
    { id: 'private', args: [2], expected: 2, isSample: false },
  ],
  examples: [],
  constraints: [],
  hints: { zh: ['', '', ''], en: ['', '', ''] },
  reviewPoints: [],
  estimatedMinutes: 10,
};

describe('problem catalog contracts', () => {
  it('creates a detail-free summary and filters disabled languages', () => {
    const summary = toProblemSummary(problem, ['javascript', 'python']);

    expect(summary).toEqual({
      id: 'problem-alpha',
      slug: 'alpha',
      title: problem.title,
      description: problem.description,
      difficulty: 'easy',
      topics: ['array-hash'],
      estimatedMinutes: 10,
      contentVersion: 3,
      catalogVersion: 'catalog-v3',
      version: { contentVersion: 3, catalogVersion: 'catalog-v3' },
      supportedLanguages: ['javascript'],
    });
    expect(summary).not.toHaveProperty('tests');
    expect(summary).not.toHaveProperty('hints');
    expect(summary).not.toHaveProperty('languageConfigs');
  });

  it('creates a versioned public detail without private tests', () => {
    const detail = toPublicProblemDetail(problem, [
      'javascript',
      'typescript',
      'python',
    ]);

    expect(detail.version.contentVersion).toBe(3);
    expect(detail.supportedLanguages).toEqual(['javascript', 'typescript']);
    expect(detail.tests.map((test) => test.id)).toEqual(['sample']);
    expect(detail.languageConfigs.python).toBeUndefined();
  });

  it('keeps the pinned local tests only in the signed assessment contract', () => {
    const detail = toAssessmentProblemDetail(problem, [
      'javascript',
      'typescript',
      'python',
    ]);

    expect(detail.tests.map((test) => test.id)).toEqual(['sample', 'private']);
    expect(detail.version.contentVersion).toBe(3);
  });
});
