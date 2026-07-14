import {
  calculateLearningStreak,
  calculateTopicMasterySnapshots,
  isPracticeSessionCompleted,
  ReviewItem,
  selectCurrentPracticeSessions,
} from './learning-progress';
import { CoachState, Problem, ProblemTopic, ProductMetrics } from './types';

export function calculateTopicMastery(
  state: CoachState,
  reviewItems: Record<string, ReviewItem> = {},
  catalog: readonly Problem[] = []
): Record<ProblemTopic, number> {
  const snapshots = calculateTopicMasterySnapshots(state, reviewItems, catalog);
  return Object.fromEntries(
    Object.entries(snapshots).map(([topic, snapshot]) => [
      topic,
      snapshot.value,
    ])
  ) as Record<ProblemTopic, number>;
}

export function calculateProductMetrics(
  state: CoachState,
  reviewItems: Record<string, ReviewItem> = {},
  options: {
    now?: Date;
    timeZone?: string;
    catalog?: readonly Problem[];
  } = {}
): ProductMetrics {
  const sessions = selectCurrentPracticeSessions(state, options.catalog);
  const attempted = sessions.filter((session) => session.runs.length > 0);
  const completed = attempted.filter(isPracticeSessionCompleted);
  const hinted = attempted.filter((session) => session.hintLevel > 0);
  const diagnosed = attempted.filter((session) => session.diagnosisCount > 0);
  const corrected = diagnosed.filter(
    (session) => session.correctedAfterDiagnosis
  );
  const assessmentAverage = state.assessments.length
    ? state.assessments.reduce((sum, item) => sum + item.score, 0) /
      state.assessments.length
    : 0;

  return {
    activated: Boolean(state.profile),
    completedProblems: completed.length,
    attemptedProblems: attempted.length,
    hintedProblems: hinted.length,
    diagnosedProblems: diagnosed.length,
    correctedProblems: corrected.length,
    practiceCompletionRate: attempted.length
      ? completed.length / attempted.length
      : 0,
    hintUsageRate: attempted.length ? hinted.length / attempted.length : 0,
    correctionEffectiveness: diagnosed.length
      ? corrected.length / diagnosed.length
      : 0,
    assessmentAverage: Math.round(assessmentAverage),
    currentStreak: calculateLearningStreak(state, options),
    topicMastery: calculateTopicMastery(state, reviewItems, options.catalog),
  };
}
