import { scheduleReview } from './learning-progress';
import type {
  CodeRunResult,
  CorrectionAttempt,
  CorrectionEpisode,
  CorrectionFailureEvidence,
  DiagnosisCategory,
  EvidenceBasedReviewSchedule,
  LearningArtifact,
  LineDiffSummary,
  ReviewAttempt,
  ReviewGrade,
  ReviewItem,
  ReviewRating,
  ReviewRatingDecision,
} from './types';

const RATING_ORDER: ReviewRating[] = ['again', 'hard', 'good', 'easy'];
export const LOW_REVIEW_COVERAGE_THRESHOLD = 0.5;

export type {
  CorrectionAttempt,
  CorrectionEpisode,
  CorrectionFailureEvidence,
  EvidenceBasedReviewSchedule,
  LineDiffSummary,
  ReviewAttempt,
  ReviewGrade,
  ReviewRatingDecision,
} from './types';

type IndexedRun = {
  sequence: number;
  run: CodeRunResult;
  timestamp: number;
  version: number;
};

type IndexedDiagnosis = {
  artifact: LearningArtifact;
  timestamp: number;
  problemSlug: string;
  version: number;
};

type MutableCorrectionEpisode = {
  problemSlug: string;
  problemContentVersion: number;
  initialRun: IndexedRun;
  diagnoses: IndexedDiagnosis[];
  attempts: IndexedRun[];
  postDiagnosisRunCount: number;
  passingRunOrdinal?: number;
};

function normalizeContentVersion(value: number | undefined): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

function identityKey(problemSlug: string, version: number): string {
  return `${problemSlug}::v${version}`;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceLines(source: string): string[] {
  if (!source) return [];
  return source.replace(/\r\n?/g, '\n').split('\n');
}

function longestCommonSubsequenceLength(
  before: readonly string[],
  after: readonly string[]
): number {
  const [rows, columns] =
    before.length >= after.length ? [before, after] : [after, before];
  let previous = new Uint32Array(columns.length + 1);

  for (const row of rows) {
    const current = new Uint32Array(columns.length + 1);
    for (let column = 1; column <= columns.length; column += 1) {
      current[column] =
        row === columns[column - 1]
          ? previous[column - 1] + 1
          : Math.max(previous[column], current[column - 1]);
    }
    previous = current;
  }

  return previous[columns.length];
}

function boundedCommonLineCount(
  before: readonly string[],
  after: readonly string[]
): number {
  if (before.length * after.length <= 250_000) {
    return longestCommonSubsequenceLength(before, after);
  }

  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return prefix + suffix;
}

export function summarizeLineDiff(
  beforeSource: string,
  afterSource: string
): LineDiffSummary {
  const before = sourceLines(beforeSource);
  const after = sourceLines(afterSource);
  const unchangedLines = boundedCommonLineCount(before, after);
  const rawRemovedLines = before.length - unchangedLines;
  const rawAddedLines = after.length - unchangedLines;
  const changedLines = Math.min(rawRemovedLines, rawAddedLines);
  const addedLines = rawAddedLines - changedLines;
  const removedLines = rawRemovedLines - changedLines;

  return {
    beforeLines: before.length,
    afterLines: after.length,
    unchangedLines,
    changedLines,
    addedLines,
    removedLines,
    hasChanges: rawRemovedLines > 0 || rawAddedLines > 0,
  };
}

function failureEvidence(run: CodeRunResult): CorrectionFailureEvidence {
  return {
    runId: run.id,
    executedAt: run.executedAt,
    status: run.status,
    error: run.error,
    passedTests: run.passedTests,
    totalTests: run.totalTests,
    failedTests: run.testResults
      .filter((result) => !result.passed)
      .map((result) => ({
        testId: result.testId,
        error: result.error,
        expected: result.expected,
        actual: result.actual,
      })),
  };
}

function correctionAttempt(
  current: IndexedRun,
  previous?: IndexedRun
): CorrectionAttempt {
  const currentRun = current.run;
  const previousSnapshot = previous?.run.codeSnapshot;
  const currentSnapshot = currentRun.codeSnapshot;
  return {
    runId: currentRun.id,
    executedAt: currentRun.executedAt,
    language: currentRun.language,
    status: currentRun.status,
    passedTests: currentRun.passedTests,
    totalTests: currentRun.totalTests,
    durationMs: currentRun.durationMs,
    codeSnapshot: currentSnapshot,
    diffFromPrevious:
      typeof previousSnapshot === 'string' &&
      typeof currentSnapshot === 'string'
        ? summarizeLineDiff(previousSnapshot, currentSnapshot)
        : undefined,
  };
}

function finishEpisode(episode: MutableCorrectionEpisode): CorrectionEpisode {
  const firstDiagnosis = episode.diagnoses[0];
  const passingRun = episode.attempts.find(
    (attempt) =>
      attempt.timestamp >= firstDiagnosis.timestamp &&
      attempt.run.status === 'passed'
  );
  const lastAttempt = episode.attempts.at(-1) ?? episode.initialRun;
  const lastDiagnosis = episode.diagnoses.at(-1) ?? firstDiagnosis;
  const endTimestamp = passingRun
    ? passingRun.timestamp
    : Math.max(lastAttempt.timestamp, lastDiagnosis.timestamp);

  return {
    id: `${identityKey(episode.problemSlug, episode.problemContentVersion)}::${firstDiagnosis.artifact.id}`,
    problemSlug: episode.problemSlug,
    problemContentVersion: episode.problemContentVersion,
    startedAt: episode.initialRun.run.executedAt,
    diagnosedAt: firstDiagnosis.artifact.createdAt,
    endedAt: new Date(endTimestamp).toISOString(),
    initialFailure: failureEvidence(episode.initialRun.run),
    diagnosisCategory: firstDiagnosis.artifact.diagnosisCategory ?? 'unknown',
    diagnoses: episode.diagnoses.map(({ artifact }) => ({
      artifactId: artifact.id,
      runId: artifact.runId,
      category: artifact.diagnosisCategory ?? 'unknown',
      createdAt: artifact.createdAt,
    })),
    attempts: episode.attempts.map((attempt, index) =>
      correctionAttempt(attempt, episode.attempts[index - 1])
    ),
    resolved: Boolean(passingRun),
    resolvedAt: passingRun?.run.executedAt,
    passedWithinThreeRuns:
      episode.passingRunOrdinal !== undefined && episode.passingRunOrdinal <= 3,
    repairDurationMs: passingRun
      ? Math.max(0, passingRun.timestamp - episode.initialRun.timestamp)
      : undefined,
    repeatedDiagnosisCategories: [],
  };
}

function groupRuns(runs: readonly CodeRunResult[]): Map<string, IndexedRun[]> {
  const groups = new Map<string, IndexedRun[]>();
  runs.forEach((run, sequence) => {
    const runTimestamp = timestamp(run.executedAt);
    if (!run.problemSlug || runTimestamp === null) return;
    const version = normalizeContentVersion(run.problemContentVersion);
    const key = identityKey(run.problemSlug, version);
    const group = groups.get(key) ?? [];
    group.push({ sequence, run, timestamp: runTimestamp, version });
    groups.set(key, group);
  });
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.sequence - right.sequence
    );
  }
  return groups;
}

function diagnosisGroups(
  artifacts: readonly LearningArtifact[],
  runsByGroup: ReadonlyMap<string, IndexedRun[]>
): Map<string, IndexedDiagnosis[]> {
  const groups = new Map<string, IndexedDiagnosis[]>();
  const runsById = new Map<string, IndexedRun[]>();
  for (const runs of runsByGroup.values()) {
    for (const run of runs) {
      if (!run.run.id) continue;
      const matches = runsById.get(run.run.id) ?? [];
      matches.push(run);
      runsById.set(run.run.id, matches);
    }
  }

  for (const artifact of artifacts) {
    if (artifact.type !== 'diagnose') continue;
    const artifactTimestamp = timestamp(artifact.createdAt);
    if (artifactTimestamp === null) continue;

    let problemSlug = artifact.problemSlug?.trim();
    let version = normalizeContentVersion(artifact.problemContentVersion);
    const linkedRuns = artifact.runId
      ? (runsById.get(artifact.runId) ?? [])
      : [];

    if (!problemSlug) {
      const identities = new Map(
        linkedRuns.map((linked) => [
          identityKey(linked.run.problemSlug, linked.version),
          linked,
        ])
      );
      if (identities.size !== 1) continue;
      const linked = identities.values().next().value as IndexedRun;
      problemSlug = linked.run.problemSlug;
      version = linked.version;
    }

    const key = identityKey(problemSlug, version);
    if (
      artifact.runId &&
      !linkedRuns.some(
        (linked) =>
          linked.run.problemSlug === problemSlug && linked.version === version
      )
    ) {
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push({
      artifact,
      timestamp: artifactTimestamp,
      problemSlug,
      version,
    });
    groups.set(key, group);
  }

  return groups;
}

function markRepeatedDiagnoses(episodes: CorrectionEpisode[]): void {
  const seenByIdentity = new Map<string, Set<DiagnosisCategory>>();
  for (const episode of episodes) {
    const key = identityKey(episode.problemSlug, episode.problemContentVersion);
    const seen = seenByIdentity.get(key) ?? new Set<DiagnosisCategory>();
    const localCounts = new Map<DiagnosisCategory, number>();
    for (const diagnosis of episode.diagnoses) {
      localCounts.set(
        diagnosis.category,
        (localCounts.get(diagnosis.category) ?? 0) + 1
      );
    }
    episode.repeatedDiagnosisCategories = Array.from(localCounts.keys()).filter(
      (category) => seen.has(category) || (localCounts.get(category) ?? 0) > 1
    );
    for (const category of localCounts.keys()) seen.add(category);
    seenByIdentity.set(key, seen);
  }
}

export function buildCorrectionEpisodes(
  runs: readonly CodeRunResult[],
  artifacts: readonly LearningArtifact[]
): CorrectionEpisode[] {
  const runsByGroup = groupRuns(runs);
  const diagnosesByGroup = diagnosisGroups(artifacts, runsByGroup);
  const episodes: CorrectionEpisode[] = [];

  for (const [key, diagnoses] of diagnosesByGroup) {
    const groupRunsForProblem = runsByGroup.get(key) ?? [];
    const events = [
      ...groupRunsForProblem.map((run) => ({
        kind: 'run' as const,
        timestamp: run.timestamp,
        sequence: run.sequence,
        run,
      })),
      ...diagnoses.map((diagnosis, sequence) => ({
        kind: 'diagnosis' as const,
        timestamp: diagnosis.timestamp,
        sequence,
        diagnosis,
      })),
    ].sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        (left.kind === right.kind ? left.sequence - right.sequence : 0) ||
        (left.kind === 'run' ? -1 : 1)
    );

    const runsSeen: IndexedRun[] = [];
    let active: MutableCorrectionEpisode | undefined;

    for (const event of events) {
      if (event.kind === 'run') {
        runsSeen.push(event.run);
        if (!active || event.timestamp < active.diagnoses[0].timestamp) {
          continue;
        }
        if (!active.attempts.some((attempt) => attempt === event.run)) {
          active.attempts.push(event.run);
          active.postDiagnosisRunCount += 1;
        }
        if (event.run.run.status === 'passed') {
          active.passingRunOrdinal = active.postDiagnosisRunCount;
          episodes.push(finishEpisode(active));
          active = undefined;
        }
        continue;
      }

      const diagnosis = event.diagnosis;
      const linkedRun = diagnosis.artifact.runId
        ? runsSeen.findLast(
            (candidate) => candidate.run.id === diagnosis.artifact.runId
          )
        : undefined;
      const anchor =
        linkedRun ??
        runsSeen.findLast((candidate) => candidate.run.status !== 'passed');
      if (!anchor || anchor.run.status === 'passed') continue;

      const anchorIndex = runsSeen.indexOf(anchor);
      if (
        runsSeen
          .slice(anchorIndex + 1)
          .some((candidate) => candidate.run.status === 'passed')
      ) {
        continue;
      }

      if (active) {
        if (!active.attempts.includes(anchor)) continue;
        active.diagnoses.push(diagnosis);
        continue;
      }

      active = {
        problemSlug: diagnosis.problemSlug,
        problemContentVersion: diagnosis.version,
        initialRun: anchor,
        diagnoses: [diagnosis],
        attempts: [anchor],
        postDiagnosisRunCount: 0,
      };
    }

    if (active) episodes.push(finishEpisode(active));
  }

  episodes.sort(
    (left, right) =>
      Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
      left.id.localeCompare(right.id)
  );
  markRepeatedDiagnoses(episodes);
  return episodes;
}

function cappedRating(
  rating: ReviewRating,
  cap: ReviewRating | undefined
): ReviewRating {
  if (!cap) return rating;
  return RATING_ORDER[
    Math.min(RATING_ORDER.indexOf(rating), RATING_ORDER.indexOf(cap))
  ];
}

function matchingSubsequentPass(
  attempt: ReviewAttempt,
  runs: readonly CodeRunResult[]
): CodeRunResult | undefined {
  const submittedAt = timestamp(attempt.submittedAt);
  if (submittedAt === null) return undefined;
  return [...runs]
    .filter((run) => {
      const runTimestamp = timestamp(run.executedAt);
      return (
        run.problemSlug === attempt.problemSlug &&
        normalizeContentVersion(run.problemContentVersion) ===
          attempt.problemContentVersion &&
        run.status === 'passed' &&
        run.totalTests > 0 &&
        run.passedTests === run.totalTests &&
        runTimestamp !== null &&
        runTimestamp > submittedAt
      );
    })
    .sort(
      (left, right) =>
        Date.parse(left.executedAt) - Date.parse(right.executedAt)
    )[0];
}

export function resolveEffectiveReviewRating(
  attempt: ReviewAttempt,
  grade: ReviewGrade,
  subsequentRuns: readonly CodeRunResult[] = []
): ReviewRatingDecision {
  const selectedRating = attempt.ratingOverride ?? grade.suggestedRating;
  const coverage = Number.isFinite(grade.coverage)
    ? Math.min(1, Math.max(0, grade.coverage))
    : 0;
  const answerCap: ReviewRating | undefined = !attempt.answer.trim()
    ? 'again'
    : coverage < LOW_REVIEW_COVERAGE_THRESHOLD
      ? 'hard'
      : undefined;
  let effectiveRating = cappedRating(selectedRating, answerCap);
  const subsequentPass = matchingSubsequentPass(attempt, subsequentRuns);
  let adjustedForSubsequentPass = false;

  if (subsequentPass) {
    const currentIndex = RATING_ORDER.indexOf(effectiveRating);
    const raisedRating = RATING_ORDER[Math.min(currentIndex + 1, 3)];
    const adjustedRating = cappedRating(raisedRating, answerCap);
    adjustedForSubsequentPass = adjustedRating !== effectiveRating;
    effectiveRating = adjustedRating;
  }

  return {
    suggestedRating: grade.suggestedRating,
    selectedRating,
    selectionSource: attempt.ratingOverride ? 'override' : 'suggested',
    effectiveRating,
    answerCap,
    subsequentPassRunId: subsequentPass?.id,
    adjustedForSubsequentPass,
  };
}

export function scheduleReviewFromEvidence(
  item: ReviewItem,
  attempt: ReviewAttempt,
  grade: ReviewGrade,
  subsequentRuns: readonly CodeRunResult[] = [],
  reviewedAt = new Date(attempt.submittedAt)
): EvidenceBasedReviewSchedule {
  const decision = resolveEffectiveReviewRating(attempt, grade, subsequentRuns);
  return {
    ...scheduleReview(item, decision.effectiveRating, reviewedAt),
    decision,
  };
}
