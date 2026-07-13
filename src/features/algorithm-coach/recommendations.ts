import { problems } from './data/problems';
import { calculateTopicMastery } from './metrics';
import type { CoachState, LearningGoal, Problem, ProblemTopic } from './types';

export type RecommendationReason =
  | 'retry'
  | 'review-due'
  | 'weak-topic'
  | 'goal-fit'
  | 'continue';

export interface ProblemRecommendation {
  problem: Problem;
  reason: RecommendationReason;
  score: number;
}

const GOAL_TOPIC_WEIGHT: Record<
  LearningGoal,
  Partial<Record<ProblemTopic, number>>
> = {
  foundation: {
    'array-hash': 16,
    'two-pointers': 14,
    stack: 12,
    'linked-list': 10,
  },
  interview: {
    'array-hash': 14,
    'two-pointers': 14,
    'binary-search': 12,
    'linked-list': 10,
    'dynamic-programming': 10,
  },
  contest: {
    'dynamic-programming': 16,
    bfs: 14,
    dfs: 14,
    'binary-search': 12,
  },
};

function lastRunFor(state: CoachState, problem: Problem) {
  const runs = state.sessions[problem.slug]?.runs ?? [];
  return runs[runs.length - 1];
}

function reviewIntervalDays(hintLevel: number, mastery: number): number {
  if (hintLevel >= 2 || mastery < 45) return 2;
  if (hintLevel === 1 || mastery < 70) return 4;
  return 7;
}

function isReviewDue(
  state: CoachState,
  problem: Problem,
  topicMastery: Record<ProblemTopic, number>,
  now: Date
): boolean {
  const session = state.sessions[problem.slug];
  if (!session?.completedAt) return false;
  const masteryValues = problem.topics
    .filter((topic): topic is ProblemTopic => topic in topicMastery)
    .map((topic) => topicMastery[topic]);
  const mastery = masteryValues.length ? Math.min(...masteryValues) : 0;
  const intervalMs =
    reviewIntervalDays(session.hintLevel, mastery) * 24 * 60 * 60 * 1000;
  const lastActivity = Date.parse(session.updatedAt || session.completedAt);
  return (
    Number.isFinite(lastActivity) && now.getTime() >= lastActivity + intervalMs
  );
}

export function getProblemRecommendations(
  state: CoachState,
  options: { limit?: number; now?: Date } = {}
): ProblemRecommendation[] {
  const limit = Math.max(1, options.limit ?? 3);
  const now = options.now ?? new Date();
  const mastery = calculateTopicMastery(state);
  const goal = state.profile?.goal ?? 'foundation';

  const ranked = problems.map((problem, catalogIndex) => {
    const session = state.sessions[problem.slug];
    const lastRun = lastRunFor(state, problem);
    const completed = Boolean(session?.completedAt);
    const due = isReviewDue(state, problem, mastery, now);
    const knownTopics = problem.topics.filter(
      (topic): topic is ProblemTopic => topic in mastery
    );
    const weakestMastery = knownTopics.length
      ? Math.min(...knownTopics.map((topic) => mastery[topic]))
      : 0;
    const goalWeight = Math.max(
      0,
      ...knownTopics.map((topic) => GOAL_TOPIC_WEIGHT[goal][topic] ?? 0)
    );
    const failed = Boolean(lastRun && lastRun.status !== 'passed');

    let score = 100 - weakestMastery + goalWeight - catalogIndex * 0.01;
    if (!session) score += 18;
    if (failed) score += 70;
    if (due) score += 130;
    if (session?.hintLevel) score += session.hintLevel * 6;
    if (completed && !due) score -= 140;

    let reason: RecommendationReason = 'continue';
    if (failed) reason = 'retry';
    else if (due) reason = 'review-due';
    else if (weakestMastery < 60 && session) reason = 'weak-topic';
    else if (goalWeight > 0) reason = 'goal-fit';

    return { problem, reason, score };
  });

  return ranked.sort((left, right) => right.score - left.score).slice(0, limit);
}
