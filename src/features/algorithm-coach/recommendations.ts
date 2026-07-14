import {
  calculateTopicMasterySnapshots,
  createInitialReviewProgress,
  getProblemPracticeSession,
  isPracticeSessionCompleted,
  reconcileReviewProgress,
  ReviewItem,
} from './learning-progress';
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
  const runs = getProblemPracticeSession(state, problem)?.runs ?? [];
  return runs[runs.length - 1];
}

function isReviewDue(
  problem: Problem,
  reviewItems: Record<string, ReviewItem>
): boolean {
  return (
    (reviewItems[problem.slug] ?? reviewItems[problem.id])?.status === 'due'
  );
}

export function getProblemRecommendations(
  state: CoachState,
  options: {
    limit?: number;
    now?: Date;
    reviewItems?: Record<string, ReviewItem>;
    maxMinutes?: number;
    catalog?: readonly Problem[];
  } = {}
): ProblemRecommendation[] {
  const limit = Math.max(1, options.limit ?? 3);
  const now = options.now ?? new Date();
  const reviewProgress = reconcileReviewProgress(
    state,
    {
      ...createInitialReviewProgress(),
      items: options.reviewItems ?? {},
    },
    { now, catalog: options.catalog }
  );
  const masterySnapshots = calculateTopicMasterySnapshots(
    state,
    reviewProgress.items,
    options.catalog
  );
  const mastery = Object.fromEntries(
    Object.entries(masterySnapshots).map(([topic, snapshot]) => [
      topic,
      snapshot.value,
    ])
  ) as Record<ProblemTopic, number>;
  const goal = state.profile?.goal ?? 'foundation';
  const assessmentWeakTopics = new Set(
    state.assessments.at(-1)?.weakTopics ?? []
  );

  const ranked = (options.catalog ?? []).map((problem, catalogIndex) => {
    const session = getProblemPracticeSession(state, problem);
    const lastRun = lastRunFor(state, problem);
    const completed = isPracticeSessionCompleted(session);
    const due = isReviewDue(problem, reviewProgress.items);
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
    const assessmentWeak = knownTopics.some((topic) =>
      assessmentWeakTopics.has(topic)
    );

    let score = 100 - weakestMastery + goalWeight - catalogIndex * 0.01;
    if (!session) score += 18;
    if (failed) score += 70;
    if (due) score += 130;
    if (assessmentWeak) score += 55;
    if (session?.hintLevel) score += session.hintLevel * 6;
    if (completed && !due) score -= 140;

    let reason: RecommendationReason = 'continue';
    if (failed) reason = 'retry';
    else if (due) reason = 'review-due';
    else if (assessmentWeak || (weakestMastery < 60 && session))
      reason = 'weak-topic';
    else if (goalWeight > 0) reason = 'goal-fit';

    return { problem, reason, score };
  });

  const sorted = ranked.sort((left, right) => right.score - left.score);
  const maxMinutes = Math.max(0, options.maxMinutes ?? 0);
  if (!maxMinutes) return sorted.slice(0, limit);

  const selected: ProblemRecommendation[] = [];
  let scheduledMinutes = 0;
  for (const recommendation of sorted) {
    if (selected.length >= limit) break;
    const nextMinutes =
      scheduledMinutes + recommendation.problem.estimatedMinutes;
    if (selected.length > 0 && nextMinutes > maxMinutes) continue;
    selected.push(recommendation);
    scheduledMinutes = nextMinutes;
  }
  return selected;
}
