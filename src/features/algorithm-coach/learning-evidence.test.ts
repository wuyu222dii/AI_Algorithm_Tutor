import { describe, expect, it } from 'vitest';

import {
  buildCorrectionEpisodes,
  resolveEffectiveReviewRating,
  scheduleReviewFromEvidence,
  summarizeLineDiff,
  type ReviewAttempt,
  type ReviewGrade,
} from './learning-evidence';
import type {
  CodeRunResult,
  DiagnosisCategory,
  LearningArtifact,
  ReviewItem,
} from './types';

function run(
  id: string,
  status: CodeRunResult['status'],
  executedAt: string,
  options: {
    slug?: string;
    version?: number;
    code?: string;
  } = {}
): CodeRunResult {
  const passed = status === 'passed';
  return {
    id,
    problemSlug: options.slug ?? 'pair-sum',
    problemContentVersion: options.version ?? 1,
    language: 'javascript',
    status,
    passedTests: passed ? 2 : 1,
    totalTests: 2,
    testResults: [
      {
        testId: 'sample-1',
        passed,
        expected: 1,
        actual: passed ? 1 : 0,
        durationMs: 1,
      },
    ],
    console: [],
    durationMs: 5,
    executedAt,
    codeSnapshot: options.code ?? `return ${passed ? '1' : '0'};`,
    testScope: 'full',
    runnerMode: 'browser-worker',
    runtimeVersion: 'quickjs-test',
  };
}

function diagnosis(
  id: string,
  runId: string,
  createdAt: string,
  category: DiagnosisCategory = 'wrong-answer',
  options: { slug?: string; version?: number } = {}
): LearningArtifact {
  return {
    id,
    type: 'diagnose',
    locale: 'zh',
    problemSlug: options.slug ?? 'pair-sum',
    problemContentVersion: options.version ?? 1,
    runId,
    title: '诊断',
    summary: '基于真实运行结果',
    details: [],
    evidence: [],
    diagnosisCategory: category,
    createdAt,
  };
}

const reviewItem: ReviewItem = {
  problemSlug: 'pair-sum',
  status: 'due',
  source: 'mistake',
  dueAt: '2026-07-15T00:00:00.000Z',
  intervalDays: 3,
  repetitions: 0,
  easeFactor: 2.5,
  updatedAt: '2026-07-15T00:00:00.000Z',
};

const reviewAttempt: ReviewAttempt = {
  id: 'review-1',
  problemSlug: 'pair-sum',
  problemContentVersion: 2,
  answer: 'Use a hash map and check the complement.',
  submittedAt: '2026-07-15T10:00:00.000Z',
};

const reviewGrade: ReviewGrade = {
  suggestedRating: 'good',
  coverage: 0.8,
  matchedPoints: ['hash map'],
  missingPoints: [],
};

describe('correction episode evidence', () => {
  it('never associates diagnosis or passing evidence across content versions', () => {
    const episodes = buildCorrectionEpisodes(
      [
        run('v1-fail', 'failed', '2026-07-15T10:00:00.000Z'),
        run('v2-pass', 'passed', '2026-07-15T10:03:00.000Z', {
          version: 2,
        }),
      ],
      [
        diagnosis(
          'mismatched-diagnosis',
          'v1-fail',
          '2026-07-15T10:01:00.000Z',
          'wrong-answer',
          { version: 2 }
        ),
        diagnosis('v1-diagnosis', 'v1-fail', '2026-07-15T10:02:00.000Z'),
      ]
    );

    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      problemContentVersion: 1,
      resolved: false,
      passedWithinThreeRuns: false,
    });
    expect(episodes[0].diagnoses.map((item) => item.artifactId)).toEqual([
      'v1-diagnosis',
    ]);
  });

  it('summarizes adjacent line changes and attaches them to ordered attempts', () => {
    const before = ['function solve() {', '  return 0;', '}'].join('\n');
    const after = [
      'function solve() {',
      '  const answer = 1;',
      '  return answer;',
      '}',
    ].join('\n');
    const episodes = buildCorrectionEpisodes(
      [
        run('fail', 'failed', '2026-07-15T10:00:00.000Z', { code: before }),
        run('pass', 'passed', '2026-07-15T10:02:00.000Z', { code: after }),
      ],
      [diagnosis('diagnosis', 'fail', '2026-07-15T10:01:00.000Z')]
    );

    expect(summarizeLineDiff(before, after)).toMatchObject({
      beforeLines: 3,
      afterLines: 4,
      unchangedLines: 2,
      changedLines: 1,
      addedLines: 1,
      removedLines: 0,
      hasChanges: true,
    });
    expect(episodes[0].attempts.map((attempt) => attempt.runId)).toEqual([
      'fail',
      'pass',
    ]);
    expect(episodes[0].attempts[0].diffFromPrevious).toBeUndefined();
    expect(episodes[0].attempts[1].diffFromPrevious).toMatchObject({
      changedLines: 1,
      addedLines: 1,
    });
  });

  it('marks a pass on the third post-diagnosis run and measures repair time', () => {
    const episodes = buildCorrectionEpisodes(
      [
        run('initial', 'failed', '2026-07-15T10:00:00.000Z'),
        run('attempt-1', 'failed', '2026-07-15T10:02:00.000Z'),
        run('attempt-2', 'failed', '2026-07-15T10:03:00.000Z'),
        run('attempt-3', 'passed', '2026-07-15T10:04:00.000Z'),
      ],
      [diagnosis('diagnosis', 'initial', '2026-07-15T10:01:00.000Z')]
    );

    expect(episodes[0]).toMatchObject({
      resolved: true,
      resolvedAt: '2026-07-15T10:04:00.000Z',
      passedWithinThreeRuns: true,
      repairDurationMs: 4 * 60 * 1000,
    });
    expect(episodes[0].attempts).toHaveLength(4);
  });

  it('does not count a pass on the fourth post-diagnosis run as a 3-run fix', () => {
    const episodes = buildCorrectionEpisodes(
      [
        run('initial', 'failed', '2026-07-15T10:00:00.000Z'),
        run('attempt-1', 'failed', '2026-07-15T10:02:00.000Z'),
        run('attempt-2', 'failed', '2026-07-15T10:03:00.000Z'),
        run('attempt-3', 'failed', '2026-07-15T10:04:00.000Z'),
        run('attempt-4', 'passed', '2026-07-15T10:05:00.000Z'),
      ],
      [diagnosis('diagnosis', 'initial', '2026-07-15T10:01:00.000Z')]
    );

    expect(episodes[0]).toMatchObject({
      resolved: true,
      passedWithinThreeRuns: false,
    });
  });

  it('leaves an episode unresolved when no later run passes', () => {
    const episodes = buildCorrectionEpisodes(
      [
        run('initial', 'failed', '2026-07-15T10:00:00.000Z'),
        run('retry', 'runtime_error', '2026-07-15T10:02:00.000Z'),
      ],
      [diagnosis('diagnosis', 'initial', '2026-07-15T10:01:00.000Z')]
    );

    expect(episodes[0]).toMatchObject({
      resolved: false,
      endedAt: '2026-07-15T10:02:00.000Z',
      passedWithinThreeRuns: false,
    });
    expect(episodes[0].repairDurationMs).toBeUndefined();
  });

  it('flags a diagnosis category repeated in a later correction episode', () => {
    const episodes = buildCorrectionEpisodes(
      [
        run('fail-1', 'failed', '2026-07-15T10:00:00.000Z'),
        run('pass-1', 'passed', '2026-07-15T10:02:00.000Z'),
        run('fail-2', 'failed', '2026-07-15T11:00:00.000Z'),
        run('pass-2', 'passed', '2026-07-15T11:02:00.000Z'),
      ],
      [
        diagnosis('diagnosis-1', 'fail-1', '2026-07-15T10:01:00.000Z'),
        diagnosis('diagnosis-2', 'fail-2', '2026-07-15T11:01:00.000Z'),
      ]
    );

    expect(episodes).toHaveLength(2);
    expect(episodes[0].repeatedDiagnosisCategories).toEqual([]);
    expect(episodes[1].repeatedDiagnosisCategories).toEqual(['wrong-answer']);
  });
});

describe('evidence-based active recall scheduling', () => {
  it('caps a blank answer at again even when the user overrides the grade', () => {
    const decision = resolveEffectiveReviewRating(
      { ...reviewAttempt, answer: '   ', ratingOverride: 'easy' },
      reviewGrade,
      [
        run('later-pass', 'passed', '2026-07-15T10:05:00.000Z', {
          version: 2,
        }),
      ]
    );

    expect(decision).toMatchObject({
      selectedRating: 'easy',
      selectionSource: 'override',
      answerCap: 'again',
      effectiveRating: 'again',
      adjustedForSubsequentPass: false,
    });
  });

  it('caps low coverage at hard', () => {
    const decision = resolveEffectiveReviewRating(
      { ...reviewAttempt, ratingOverride: 'easy' },
      { ...reviewGrade, coverage: 0.2 }
    );

    expect(decision).toMatchObject({
      answerCap: 'hard',
      effectiveRating: 'hard',
    });
  });

  it('uses only a later real pass for the same problem version and raises one level', () => {
    const mismatchedPass = run(
      'wrong-version',
      'passed',
      '2026-07-15T10:01:00.000Z',
      { version: 1 }
    );
    const matchingPass = run(
      'matching-version',
      'passed',
      '2026-07-15T10:02:00.000Z',
      { version: 2 }
    );
    const decision = resolveEffectiveReviewRating(
      reviewAttempt,
      { ...reviewGrade, suggestedRating: 'hard' },
      [mismatchedPass, matchingPass]
    );

    expect(decision).toMatchObject({
      selectedRating: 'hard',
      effectiveRating: 'good',
      subsequentPassRunId: 'matching-version',
      adjustedForSubsequentPass: true,
    });
  });

  it('feeds the effective rating into the existing spaced-review scheduler', () => {
    const result = scheduleReviewFromEvidence(
      reviewItem,
      reviewAttempt,
      { ...reviewGrade, suggestedRating: 'hard' },
      [
        run('matching-version', 'passed', '2026-07-15T10:02:00.000Z', {
          version: 2,
        }),
      ]
    );

    expect(result.decision.effectiveRating).toBe('good');
    expect(result.item.lastRating).toBe('good');
    expect(result.intervalDays).toBe(3);
    expect(result.nextReviewAt).toBe('2026-07-18T10:00:00.000Z');
  });
});
