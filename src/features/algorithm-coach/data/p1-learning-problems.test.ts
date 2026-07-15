import { describe, expect, it } from 'vitest';

import type { JsonValue, ProblemTopic } from '../types';
import { p1LearningProblems } from './p1-learning-problems';

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value).every(isJsonValue);
};

describe('P1 learning problem expansion', () => {
  it('contains the requested topic distribution and keeps the final four hard', () => {
    expect(p1LearningProblems).toHaveLength(15);

    const counts = p1LearningProblems.reduce<
      Partial<Record<ProblemTopic, number>>
    >((result, problem) => {
      const topic = problem.topics[0] as ProblemTopic;
      result[topic] = (result[topic] ?? 0) + 1;
      return result;
    }, {});

    expect(counts).toMatchObject({
      'binary-search': 4,
      'linked-list': 4,
      stack: 3,
      'dynamic-programming': 2,
      bfs: 1,
      dfs: 1,
    });
    expect(
      p1LearningProblems
        .slice(0, 11)
        .every((item) => item.difficulty !== 'hard')
    ).toBe(true);
    expect(
      p1LearningProblems.slice(-4).every((item) => item.difficulty === 'hard')
    ).toBe(true);
  });

  it('uses unique identities and complete bilingual learning metadata', () => {
    const ids = p1LearningProblems.map(({ id }) => id);
    const slugs = p1LearningProblems.map(({ slug }) => slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const problem of p1LearningProblems) {
      expect(problem.title.zh).toBeTruthy();
      expect(problem.title.en).toBeTruthy();
      expect(problem.description.zh).toBeTruthy();
      expect(problem.description.en).toBeTruthy();
      expect(problem.constraints.length).toBeGreaterThan(0);
      expect(problem.hints.zh).toHaveLength(3);
      expect(problem.hints.en).toHaveLength(3);
      expect(problem.reviewPoints.length).toBeGreaterThan(0);
      expect(problem.learningObjectives.length).toBeGreaterThan(0);
      expect(problem.prerequisiteTopics.length).toBeGreaterThan(0);
      expect(problem.solutionPatterns.length).toBeGreaterThan(0);
      expect(problem.estimatedMinutes).toBeGreaterThan(0);
    }
  });

  it('provides three runnable language configurations with matching signatures', () => {
    for (const problem of p1LearningProblems) {
      expect(Object.keys(problem.languageConfigs ?? {}).sort()).toEqual([
        'javascript',
        'python',
        'typescript',
      ]);

      for (const language of ['javascript', 'python', 'typescript'] as const) {
        const config = problem.languageConfigs?.[language];
        expect(config?.entryPoint).toBeTruthy();
        expect(config?.template).toContain(config?.entryPoint);
        expect(config?.signature).toEqual(problem.signature);
        expect(config?.monacoId).toBe(language);
        expect(config?.runtimeVersion).toBeTruthy();
      }
    }
  });

  it('ships reliable JSON function tests with samples and unique test ids', () => {
    for (const problem of p1LearningProblems) {
      expect(problem.tests.length).toBeGreaterThanOrEqual(3);
      expect(problem.tests.some(({ isSample }) => isSample)).toBe(true);
      expect(problem.tests.some(({ isSample }) => !isSample)).toBe(true);
      expect(new Set(problem.tests.map(({ id }) => id)).size).toBe(
        problem.tests.length
      );

      const parameterCount = problem.signature!.parameters.length;
      for (const test of problem.tests) {
        expect(test.args).toHaveLength(parameterCount);
        expect(isJsonValue(test.args)).toBe(true);
        expect(isJsonValue(test.expected)).toBe(true);
      }
    }
  });
});
