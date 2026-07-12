import { problems } from './data/problems';
import { CoachState, ProblemTopic, ProductMetrics } from './types';

const ALL_TOPICS: ProblemTopic[] = [
  'array-hash',
  'two-pointers',
  'stack',
  'binary-search',
  'linked-list',
  'dynamic-programming',
  'bfs',
  'dfs',
];

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

function calculateStreak(state: CoachState): number {
  const activeDates = new Set(
    Object.values(state.sessions)
      .filter((session) => session.runs.length > 0)
      .map((session) => session.updatedAt.slice(0, 10))
  );
  if (activeDates.size === 0) return 0;

  const cursor = new Date();
  const today = cursor.toISOString().slice(0, 10);
  if (!activeDates.has(today)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  while (activeDates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function calculateTopicMastery(
  state: CoachState
): Record<ProblemTopic, number> {
  const totals = Object.fromEntries(
    ALL_TOPICS.map((topic) => [topic, { score: 0, count: 0 }])
  ) as Record<ProblemTopic, { score: number; count: number }>;

  for (const problem of problems) {
    const session = state.sessions[problem.slug];
    if (!session || session.runs.length === 0) continue;

    const latest = session.runs[session.runs.length - 1];
    const passRatio = latest.totalTests
      ? latest.passedTests / latest.totalTests
      : 0;
    const completionBonus = session.completedAt ? 25 : 0;
    const independentBonus = session.hintLevel === 0 ? 10 : 0;
    const retryPenalty = Math.min(15, Math.max(0, session.runs.length - 1) * 3);
    const score = clamp(
      passRatio * 65 + completionBonus + independentBonus - retryPenalty
    );

    for (const topic of problem.topics) {
      if (!(topic in totals)) continue;
      const knownTopic = topic as ProblemTopic;
      totals[knownTopic].score += score;
      totals[knownTopic].count += 1;
    }
  }

  return Object.fromEntries(
    ALL_TOPICS.map((topic) => [
      topic,
      totals[topic].count
        ? Math.round(totals[topic].score / totals[topic].count)
        : 0,
    ])
  ) as Record<ProblemTopic, number>;
}

export function calculateProductMetrics(state: CoachState): ProductMetrics {
  const sessions = Object.values(state.sessions);
  const attempted = sessions.filter((session) => session.runs.length > 0);
  const completed = attempted.filter((session) => Boolean(session.completedAt));
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
    practiceCompletionRate: attempted.length
      ? completed.length / attempted.length
      : 0,
    hintUsageRate: attempted.length
      ? attempted.filter((session) => session.hintLevel > 0).length /
        attempted.length
      : 0,
    correctionEffectiveness: diagnosed.length
      ? corrected.length / diagnosed.length
      : 0,
    assessmentAverage: Math.round(assessmentAverage),
    currentStreak: calculateStreak(state),
    topicMastery: calculateTopicMastery(state),
  };
}
