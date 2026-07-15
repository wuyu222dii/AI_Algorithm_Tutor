import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  completeSignedAssessment,
  createSignedAssessmentSession,
  readSignedAssessmentSession,
  selectAssessmentProblems,
  verifyAssessmentSession,
} from './assessment.server';
import { problems } from './data/problems';
import { problemSupportsLanguage } from './languages';

describe('signed assessment sessions', () => {
  beforeEach(() => {
    process.env.ASSESSMENT_SIGNING_SECRET =
      'test-assessment-secret-with-at-least-32-characters';
  });

  afterEach(() => {
    delete process.env.ASSESSMENT_SIGNING_SECRET;
  });

  it('selects a deterministic, distinct, versioned problem pair', () => {
    const first = selectAssessmentProblems('assessment-test', problems);
    const second = selectAssessmentProblems('assessment-test', problems);
    expect(first).toEqual(second);
    expect(new Set(first.map((problem) => problem.slug)).size).toBe(2);
  });

  it('creates an eight-minute language-aware baseline for the learning goal', () => {
    const session = createSignedAssessmentSession({
      id: 'baseline-interview-typescript',
      kind: 'baseline',
      preferredLanguage: 'typescript',
      goal: 'interview',
      problems,
      now: new Date('2026-07-13T00:00:00.000Z'),
    });

    expect(session.kind).toBe('baseline');
    expect(session.durationMinutes).toBe(8);
    expect(session.problemVersions).toHaveLength(2);
    for (const reference of session.problemVersions) {
      const problem = problems.find((item) => item.slug === reference.slug)!;
      expect(problem.difficulty).not.toBe('hard');
      expect(problemSupportsLanguage(problem, 'typescript')).toBe(true);
      expect(
        problem.topics.some((topic) =>
          [
            'array-hash',
            'two-pointers',
            'binary-search',
            'linked-list',
            'dynamic-programming',
          ].includes(topic)
        )
      ).toBe(true);
    }
  });

  it('pins a checkpoint to comparable new revisions and its baseline id', () => {
    const baseline = createSignedAssessmentSession({
      id: 'baseline-for-checkpoint',
      kind: 'baseline',
      preferredLanguage: 'javascript',
      goal: 'foundation',
      problems,
      now: new Date('2026-07-01T00:00:00.000Z'),
    });
    const checkpoint = createSignedAssessmentSession({
      id: 'checkpoint-after-two-weeks',
      kind: 'checkpoint',
      preferredLanguage: 'javascript',
      goal: 'foundation',
      baselineAssessmentId: baseline.id,
      baselineProblemVersions: baseline.problemVersions,
      problems,
      now: new Date('2026-07-15T00:00:00.000Z'),
    });

    expect(checkpoint.kind).toBe('checkpoint');
    expect(checkpoint.baselineAssessmentId).toBe(baseline.id);
    expect(checkpoint.durationMinutes).toBe(8);
    expect(checkpoint.problemSlugs).not.toEqual(
      expect.arrayContaining(baseline.problemSlugs)
    );
    const baselineProblems = baseline.problemVersions.map(
      (reference) =>
        problems.find((problem) => problem.slug === reference.slug)!
    );
    const baselineTopics = new Set(
      baselineProblems.flatMap((problem) => problem.topics)
    );
    const baselineDifficulties = new Set(
      baselineProblems.map((problem) => problem.difficulty)
    );
    for (const reference of checkpoint.problemVersions) {
      const problem = problems.find((item) => item.slug === reference.slug)!;
      expect(baselineDifficulties.has(problem.difficulty)).toBe(true);
      expect(problem.topics.some((topic) => baselineTopics.has(topic))).toBe(
        true
      );
    }
  });

  it('rejects a tampered or expired session token', () => {
    const session = createSignedAssessmentSession({
      id: 'assessment-test',
      problems,
      now: new Date('2026-07-13T00:00:00.000Z'),
    });
    expect(() =>
      verifyAssessmentSession(
        `${session.token}x`,
        problems,
        new Date('2026-07-13T00:01:00.000Z')
      )
    ).toThrow(/signature|malformed/);
    expect(() =>
      verifyAssessmentSession(
        session.token,
        problems,
        new Date('2026-07-13T01:00:00.000Z')
      )
    ).toThrow(/expired/);
  });

  it('computes and signs the result for the signed problem set', () => {
    const session = createSignedAssessmentSession({
      id: 'assessment-test',
      problems,
      now: new Date('2026-07-13T00:00:00.000Z'),
    });
    const result = completeSignedAssessment({
      token: session.token,
      runs: session.problemSlugs.map((problemSlug, index) => ({
        problemSlug,
        passed: index === 0,
        durationMs: 500,
        status: index === 0 ? ('passed' as const) : ('syntax_error' as const),
      })),
      problems,
      now: new Date('2026-07-13T00:10:00.000Z'),
    });

    expect(result.score).toBe(50);
    expect(result.correctCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.weakTopics.length).toBeGreaterThan(0);
    expect(result.errorCategories).toEqual(['syntax']);
    expect(result.verificationToken).toContain('.');
  });

  it('exposes signed version references before loading historical revisions', () => {
    const session = createSignedAssessmentSession({
      id: 'assessment-version-pinning',
      problems,
      now: new Date('2026-07-13T00:00:00.000Z'),
    });
    const references = readSignedAssessmentSession(
      session.token,
      new Date('2026-07-13T00:05:00.000Z')
    ).problemVersions;

    expect(references).toEqual(session.problemVersions);
    const upgradedCatalog = problems.map((problem) => ({
      ...problem,
      version: { contentVersion: 2 },
    }));
    expect(() =>
      verifyAssessmentSession(
        session.token,
        upgradedCatalog,
        new Date('2026-07-13T00:05:00.000Z')
      )
    ).toThrow(/problem set/);
    expect(() =>
      completeSignedAssessment({
        token: session.token,
        runs: session.problemSlugs.map((problemSlug) => ({
          problemSlug,
          passed: true,
          durationMs: 500,
        })),
        problems,
        now: new Date('2026-07-13T00:05:00.000Z'),
      })
    ).not.toThrow();
  });
});
