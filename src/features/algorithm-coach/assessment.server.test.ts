import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  completeSignedAssessment,
  createSignedAssessmentSession,
  readSignedAssessmentSession,
  selectAssessmentProblems,
  verifyAssessmentSession,
} from './assessment.server';
import { problems } from './data/problems';

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
      })),
      problems,
      now: new Date('2026-07-13T00:10:00.000Z'),
    });

    expect(result.score).toBe(50);
    expect(result.correctCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.weakTopics.length).toBeGreaterThan(0);
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
