import { problemSupportsLanguage } from './languages';
import {
  ALL_PROBLEM_TOPICS,
  calculateTopicMasterySnapshots,
  getProblemPracticeSession,
  getReviewItemForProblem,
  isPracticeSessionCompleted,
} from './learning-progress';
import { normalizeProblemContentVersion } from './sync';
import type {
  CoachState,
  DailyLearningPlan,
  DailyPlanTask,
  DailyPlanTaskKind,
  DailyPlanTaskReason,
  Difficulty,
  Language,
  LearningGoal,
  LearningProfile,
  Problem,
  ProblemTopic,
  ReviewItem,
} from './types';

export type {
  DailyLearningPlan,
  DailyPlanTask,
  DailyPlanTaskKind,
  DailyPlanTaskReason,
} from './types';

export interface DailyPlanInput {
  state: CoachState;
  reviewItems: Record<string, ReviewItem>;
  catalog: readonly Problem[];
  date: Date | string;
  timeZone: string;
  profile?: LearningProfile | null;
  enabledLanguages?: readonly Language[];
}

type Candidate = {
  problem: Problem;
  primaryTopic: ProblemTopic;
  reason: DailyPlanTaskReason;
  dueAt?: string;
  score: number;
  catalogIndex: number;
};

type SelectionContext = {
  state: CoachState;
  profile: LearningProfile | null;
  preferredLanguage?: Language;
  catalog: Problem[];
  planDate: string;
  timeZone: string;
  estimates: Record<Difficulty, number | undefined>;
  dueProblemSlugs: Set<string>;
  candidates: Record<DailyPlanTaskKind, Candidate[]>;
};

const DEFAULT_DAILY_MINUTES = 30;
const MAX_DAILY_MINUTES = 180;

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

const KNOWN_TOPICS = new Set<string>(ALL_PROBLEM_TOPICS);

function parseDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Daily plan date must be a valid date.');
  }
  return date;
}

function normalizeTimeZone(timeZone: string): string {
  const normalized = timeZone.trim() || 'UTC';
  // Intl performs the platform-specific IANA validation for us.
  new Intl.DateTimeFormat('en', { timeZone: normalized }).format(0);
  return normalized;
}

export function getDailyPlanDateKey(
  value: Date | string,
  timeZone: string
): string {
  const date = parseDate(value);
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function contentVersion(problem: Problem): number {
  return normalizeProblemContentVersion(problem.version?.contentVersion);
}

function primaryTopic(problem: Problem): ProblemTopic | undefined {
  return problem.topics.find((topic): topic is ProblemTopic =>
    KNOWN_TOPICS.has(topic)
  );
}

function currentCatalog(catalog: readonly Problem[]): Problem[] {
  const bySlug = new Map<string, { problem: Problem; index: number }>();
  catalog.forEach((problem, index) => {
    const current = bySlug.get(problem.slug);
    if (!current || contentVersion(problem) > contentVersion(current.problem)) {
      bySlug.set(problem.slug, { problem, index: current?.index ?? index });
    }
  });
  return [...bySlug.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ problem }) => problem);
}

function supportsLanguage(
  problem: Problem,
  language: Language | undefined
): boolean {
  return !language || problemSupportsLanguage(problem, language);
}

function catalogProblemForSession(
  catalog: readonly Problem[],
  problemSlug: string,
  problemContentVersion: number
): Problem | undefined {
  return catalog.find(
    (problem) =>
      (problem.slug === problemSlug || problem.id === problemSlug) &&
      contentVersion(problem) === problemContentVersion
  );
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function historicalDifficultyEstimates(
  state: CoachState,
  catalog: readonly Problem[]
): Record<Difficulty, number | undefined> {
  const durations: Record<Difficulty, number[]> = {
    easy: [],
    medium: [],
    hard: [],
  };
  const observedSessions = new Set<string>();

  for (const session of Object.values(state.sessions)) {
    if (!session.completedAt) continue;
    const problem = catalogProblemForSession(
      catalog,
      session.problemSlug,
      normalizeProblemContentVersion(session.problemContentVersion)
    );
    if (!problem) continue;
    const startedAt = Date.parse(session.startedAt);
    const completedAt = Date.parse(session.completedAt);
    if (!Number.isFinite(startedAt) || completedAt <= startedAt) continue;
    const identity = [
      session.problemSlug,
      normalizeProblemContentVersion(session.problemContentVersion),
      session.startedAt,
      session.completedAt,
    ].join('|');
    if (observedSessions.has(identity)) continue;
    observedSessions.add(identity);

    const elapsedMinutes = Math.min(
      MAX_DAILY_MINUTES,
      Math.max(1, (completedAt - startedAt) / 60_000)
    );
    durations[problem.difficulty].push(elapsedMinutes);
  }

  return {
    easy: median(durations.easy),
    medium: median(durations.medium),
    hard: median(durations.hard),
  };
}

export function estimateDailyPlanProblemMinutes(
  problem: Problem,
  state: CoachState,
  catalog: readonly Problem[]
): number {
  const historical = historicalDifficultyEstimates(state, catalog)[
    problem.difficulty
  ];
  return Math.max(
    1,
    Math.round(historical ?? Math.max(1, problem.estimatedMinutes))
  );
}

function hasAnyPractice(state: CoachState, problem: Problem): boolean {
  if (
    state.completedProblemIds.includes(problem.slug) ||
    state.completedProblemIds.includes(problem.id)
  ) {
    return true;
  }
  return Object.values(state.sessions).some(
    (session) =>
      session.problemSlug === problem.slug || session.problemSlug === problem.id
  );
}

function latestAssessmentWeakTopics(state: CoachState): Set<ProblemTopic> {
  const latest = [...state.assessments]
    .filter((assessment) => Number.isFinite(Date.parse(assessment.completedAt)))
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt)
    )[0];
  return new Set(latest?.weakTopics ?? []);
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return right.score - left.score || left.catalogIndex - right.catalogIndex;
}

function buildSelectionContext(
  input: DailyPlanInput,
  planProfile?: Pick<DailyLearningPlan, 'preferredLanguage' | 'goal'>
): SelectionContext {
  const date = parseDate(input.date);
  const timeZone = normalizeTimeZone(input.timeZone);
  const planDate = getDailyPlanDateKey(date, timeZone);
  const profile =
    input.profile === undefined ? input.state.profile : input.profile;
  const requestedLanguage =
    planProfile?.preferredLanguage ?? profile?.preferredLanguage;
  const goal = planProfile?.goal ?? profile?.goal ?? 'foundation';
  const currentProblems = currentCatalog(input.catalog);
  const preferredLanguage = input.enabledLanguages
    ? requestedLanguage &&
      input.enabledLanguages.includes(requestedLanguage) &&
      currentProblems.some((problem) =>
        supportsLanguage(problem, requestedLanguage)
      )
      ? requestedLanguage
      : input.enabledLanguages.find((language) =>
          currentProblems.some((problem) => supportsLanguage(problem, language))
        )
    : requestedLanguage;
  const catalog =
    input.enabledLanguages && !preferredLanguage
      ? []
      : currentProblems.filter((problem) =>
          supportsLanguage(problem, preferredLanguage)
        );
  const mastery = calculateTopicMasterySnapshots(
    input.state,
    input.reviewItems,
    catalog
  );
  const assessmentWeakTopics = latestAssessmentWeakTopics(input.state);
  const dueProblemSlugs = new Set<string>();

  const dueReview = catalog
    .map((problem, catalogIndex): Candidate | undefined => {
      const topic = primaryTopic(problem);
      const reviewItem = getReviewItemForProblem(input.reviewItems, problem);
      if (
        !topic ||
        !reviewItem ||
        reviewItem.status !== 'due' ||
        getDailyPlanDateKey(reviewItem.dueAt, timeZone) > planDate
      ) {
        return undefined;
      }
      dueProblemSlugs.add(problem.slug);
      return {
        problem,
        primaryTopic: topic,
        reason: 'review-due',
        dueAt: reviewItem.dueAt,
        score: -Date.parse(reviewItem.dueAt),
        catalogIndex,
      };
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort((left, right) => {
      const dueOrder =
        Date.parse(left.dueAt ?? '') - Date.parse(right.dueAt ?? '');
      return dueOrder || left.catalogIndex - right.catalogIndex;
    });

  const weakTopic = catalog
    .map((problem, catalogIndex): Candidate | undefined => {
      const topic = primaryTopic(problem);
      if (!topic || dueProblemSlugs.has(problem.slug)) return undefined;
      const snapshot = mastery[topic];
      const assessmentWeak = assessmentWeakTopics.has(topic);
      if (!assessmentWeak && snapshot.evidenceCount === 0) return undefined;
      const session = getProblemPracticeSession(input.state, problem);
      const completed = isPracticeSessionCompleted(session);
      const latestRun = session?.runs.at(-1);
      return {
        problem,
        primaryTopic: topic,
        reason: assessmentWeak ? 'assessment-weak' : 'weak-mastery',
        score:
          (assessmentWeak ? 1_000 : 0) +
          (100 - snapshot.value) * 10 +
          (latestRun && latestRun.status !== 'passed' ? 220 : 0) +
          (completed ? 0 : 80),
        catalogIndex,
      };
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort(compareCandidates);

  const newTopic = catalog
    .map((problem, catalogIndex): Candidate | undefined => {
      const topic = primaryTopic(problem);
      if (
        !topic ||
        dueProblemSlugs.has(problem.slug) ||
        hasAnyPractice(input.state, problem)
      ) {
        return undefined;
      }
      const snapshot = mastery[topic];
      return {
        problem,
        primaryTopic: topic,
        reason: 'new-topic',
        score:
          (snapshot.evidenceCount === 0 ? 200 : 0) +
          (GOAL_TOPIC_WEIGHT[goal][topic] ?? 0) * 10 +
          (100 - snapshot.value),
        catalogIndex,
      };
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort(compareCandidates);

  return {
    state: input.state,
    profile,
    preferredLanguage,
    catalog,
    planDate,
    timeZone,
    estimates: historicalDifficultyEstimates(input.state, catalog),
    dueProblemSlugs,
    candidates: {
      'due-review': dueReview,
      'weak-topic': weakTopic,
      'new-topic': newTopic,
    },
  };
}

function dailyBudget(profile: LearningProfile | null): number {
  const value = Number(profile?.dailyMinutes ?? DEFAULT_DAILY_MINUTES);
  return Number.isFinite(value) && value > 0
    ? Math.min(MAX_DAILY_MINUTES, Math.round(value))
    : DEFAULT_DAILY_MINUTES;
}

function candidateEstimate(
  candidate: Candidate,
  context: SelectionContext
): number {
  return Math.max(
    1,
    Math.round(
      context.estimates[candidate.problem.difficulty] ??
        Math.max(1, candidate.problem.estimatedMinutes)
    )
  );
}

function selectCandidate(
  candidates: readonly Candidate[],
  context: SelectionContext,
  constraints: {
    excludedSlugs: Set<string>;
    usedTopics: Set<ProblemTopic>;
    hardCount: number;
    remainingMinutes: number;
  }
): Candidate | undefined {
  return candidates.find((candidate) => {
    if (constraints.excludedSlugs.has(candidate.problem.slug)) return false;
    if (constraints.usedTopics.has(candidate.primaryTopic)) return false;
    if (candidate.problem.difficulty === 'hard' && constraints.hardCount >= 1) {
      return false;
    }
    return (
      candidateEstimate(candidate, context) <= constraints.remainingMinutes
    );
  });
}

function taskFromCandidate(
  planId: string,
  kind: DailyPlanTaskKind,
  candidate: Candidate,
  context: SelectionContext
): DailyPlanTask {
  return {
    id: `${planId}:${kind}`,
    kind,
    status: 'pending',
    problemId: candidate.problem.id,
    problemSlug: candidate.problem.slug,
    problemContentVersion: contentVersion(candidate.problem),
    primaryTopic: candidate.primaryTopic,
    difficulty: candidate.problem.difficulty,
    reason: candidate.reason,
    estimatedMinutes: candidateEstimate(candidate, context),
    dueAt: candidate.dueAt,
  };
}

function totalEstimatedMinutes(tasks: readonly DailyPlanTask[]): number {
  return tasks
    .filter((task) => task.status !== 'skipped')
    .reduce((total, task) => total + task.estimatedMinutes, 0);
}

export function createDailyLearningPlan(
  input: DailyPlanInput
): DailyLearningPlan {
  const context = buildSelectionContext(input);
  const budgetMinutes = dailyBudget(context.profile);
  const planId = `daily-plan:${encodeURIComponent(context.timeZone)}:${context.planDate}`;
  const tasks: DailyPlanTask[] = [];
  const excludedSlugs = new Set<string>();
  const usedTopics = new Set<ProblemTopic>();
  let hardCount = 0;
  let remainingMinutes = budgetMinutes;

  for (const kind of [
    'due-review',
    'weak-topic',
    'new-topic',
  ] satisfies DailyPlanTaskKind[]) {
    const candidate = selectCandidate(context.candidates[kind], context, {
      excludedSlugs,
      usedTopics,
      hardCount,
      remainingMinutes,
    });
    if (!candidate) continue;
    const task = taskFromCandidate(planId, kind, candidate, context);
    tasks.push(task);
    excludedSlugs.add(task.problemSlug);
    usedTopics.add(task.primaryTopic);
    hardCount += task.difficulty === 'hard' ? 1 : 0;
    remainingMinutes -= task.estimatedMinutes;
  }

  return {
    id: planId,
    localDate: context.planDate,
    timeZone: context.timeZone,
    budgetMinutes,
    estimatedMinutes: totalEstimatedMinutes(tasks),
    preferredLanguage: context.preferredLanguage,
    goal: context.profile?.goal ?? 'foundation',
    tasks,
    changes: [],
  };
}

function operationReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) {
    throw new TypeError('A non-empty daily plan change reason is required.');
  }
  return normalized;
}

function operationTime(value: Date | string): string {
  return parseDate(value).toISOString();
}

function assertOperationOnPlanDate(
  plan: DailyLearningPlan,
  occurredAt: Date | string
): void {
  if (getDailyPlanDateKey(occurredAt, plan.timeZone) !== plan.localDate) {
    throw new RangeError('A daily plan can only be changed on its local date.');
  }
}

function changeId(plan: DailyLearningPlan): string {
  return `${plan.id}:change:${plan.changes.length + 1}`;
}

export function skipDailyPlanTask(
  plan: DailyLearningPlan,
  taskId: string,
  reason: string,
  occurredAt: Date | string
): DailyLearningPlan {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new RangeError(`Unknown daily plan task: ${taskId}`);
  if (task.status !== 'pending') {
    throw new RangeError('Only pending daily plan tasks can be skipped.');
  }
  assertOperationOnPlanDate(plan, occurredAt);
  const normalizedReason = operationReason(reason);
  const timestamp = operationTime(occurredAt);
  const tasks = plan.tasks.map((candidate) =>
    candidate.id === taskId
      ? {
          ...candidate,
          status: 'skipped' as const,
          skipReason: normalizedReason,
          skippedAt: timestamp,
        }
      : candidate
  );
  return {
    ...plan,
    tasks,
    estimatedMinutes: totalEstimatedMinutes(tasks),
    changes: [
      ...plan.changes,
      {
        id: changeId(plan),
        action: 'skipped',
        taskId,
        reason: normalizedReason,
        occurredAt: timestamp,
        fromProblemSlug: task.problemSlug,
        fromProblemContentVersion: task.problemContentVersion,
      },
    ],
  };
}

export function swapDailyPlanTask(
  plan: DailyLearningPlan,
  taskId: string,
  reason: string,
  occurredAt: Date | string,
  input: DailyPlanInput
): DailyLearningPlan {
  const taskIndex = plan.tasks.findIndex(
    (candidate) => candidate.id === taskId
  );
  const task = plan.tasks[taskIndex];
  if (!task) throw new RangeError(`Unknown daily plan task: ${taskId}`);
  if (task.status !== 'pending') {
    throw new RangeError('Only pending daily plan tasks can be swapped.');
  }
  assertOperationOnPlanDate(plan, occurredAt);
  const normalizedReason = operationReason(reason);
  const timestamp = operationTime(occurredAt);
  const context = buildSelectionContext(input, plan);
  if (
    context.planDate !== plan.localDate ||
    context.timeZone !== plan.timeZone
  ) {
    throw new RangeError('A daily plan can only be changed on its local date.');
  }

  const otherActiveTasks = plan.tasks.filter(
    (candidate) => candidate.id !== taskId && candidate.status !== 'skipped'
  );
  const excludedSlugs = new Set(
    plan.tasks.map((candidate) => candidate.problemSlug)
  );
  for (const change of plan.changes) {
    excludedSlugs.add(change.fromProblemSlug);
    if (change.toProblemSlug) excludedSlugs.add(change.toProblemSlug);
  }
  const replacement = selectCandidate(context.candidates[task.kind], context, {
    excludedSlugs,
    usedTopics: new Set(
      otherActiveTasks.map((candidate) => candidate.primaryTopic)
    ),
    hardCount: otherActiveTasks.filter(
      (candidate) => candidate.difficulty === 'hard'
    ).length,
    remainingMinutes:
      plan.budgetMinutes - totalEstimatedMinutes(otherActiveTasks),
  });
  const baseChange = {
    id: changeId(plan),
    taskId,
    reason: normalizedReason,
    occurredAt: timestamp,
    fromProblemSlug: task.problemSlug,
    fromProblemContentVersion: task.problemContentVersion,
  };

  if (!replacement) {
    return {
      ...plan,
      changes: [
        ...plan.changes,
        { ...baseChange, action: 'swap-unavailable' as const },
      ],
    };
  }

  const replacementTask = taskFromCandidate(
    plan.id,
    task.kind,
    replacement,
    context
  );
  const tasks = plan.tasks.map((candidate, index) =>
    index === taskIndex ? replacementTask : candidate
  );
  return {
    ...plan,
    tasks,
    estimatedMinutes: totalEstimatedMinutes(tasks),
    changes: [
      ...plan.changes,
      {
        ...baseChange,
        action: 'swapped',
        toProblemSlug: replacementTask.problemSlug,
        toProblemContentVersion: replacementTask.problemContentVersion,
      },
    ],
  };
}
