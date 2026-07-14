import { problems } from './data/problems';
import type { CoachStorageScope } from './storage';
import type {
  CoachState,
  CodeRunResult,
  PracticeSession,
  Problem,
  ProblemTopic,
  ReviewItem,
  ReviewProgressState,
  ReviewRating,
  ReviewScheduleResult,
  ReviewStatus,
} from './types';

export type {
  ReviewItem,
  ReviewProgressState,
  ReviewRating,
  ReviewScheduleResult,
  ReviewStatus,
} from './types';

export const REVIEW_PROGRESS_VERSION = 1;
export const REVIEW_PROGRESS_STORAGE_KEY = `algocoach:review-progress:v${REVIEW_PROGRESS_VERSION}`;

export const ALL_PROBLEM_TOPICS: ProblemTopic[] = [
  'array-hash',
  'two-pointers',
  'stack',
  'binary-search',
  'linked-list',
  'dynamic-programming',
  'bfs',
  'dfs',
];

export const TOPIC_LABELS: Record<ProblemTopic, { zh: string; en: string }> = {
  'array-hash': { zh: '数组与哈希', en: 'Arrays & hashing' },
  'two-pointers': { zh: '双指针', en: 'Two pointers' },
  stack: { zh: '栈', en: 'Stack' },
  'binary-search': { zh: '二分查找', en: 'Binary search' },
  'linked-list': { zh: '链表', en: 'Linked list' },
  'dynamic-programming': { zh: '动态规划', en: 'Dynamic programming' },
  bfs: { zh: '广度优先搜索', en: 'Breadth-first search' },
  dfs: { zh: '深度优先搜索', en: 'Depth-first search' },
};

export interface TopicMasterySnapshot {
  topic: ProblemTopic;
  value: number;
  confidence: number;
  evidenceCount: number;
  completedCount: number;
  totalCount: number;
  updatedAt: string | null;
}

type WeekOptions = {
  now?: Date;
  timeZone?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fallback;
  }
  return new Date(value).toISOString();
}

function scopedReviewKey(scope: CoachStorageScope): string {
  return scope === 'guest'
    ? REVIEW_PROGRESS_STORAGE_KEY
    : `${REVIEW_PROGRESS_STORAGE_KEY}:${scope}`;
}

function getStorage(storage?: Storage): Storage | undefined {
  return (
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  );
}

export function createInitialReviewProgress(): ReviewProgressState {
  return { version: REVIEW_PROGRESS_VERSION, items: {} };
}

export function migrateReviewProgress(value: unknown): ReviewProgressState {
  const initial = createInitialReviewProgress();
  if (!isRecord(value) || !isRecord(value.items)) return initial;

  const items: Record<string, ReviewItem> = {};
  for (const [key, raw] of Object.entries(value.items)) {
    if (!isRecord(raw)) continue;
    const problemSlug = String(raw.problemSlug ?? key).trim();
    if (!problemSlug) continue;
    const fallback = new Date(0).toISOString();
    const updatedAt = validDate(raw.updatedAt, fallback);
    const status: ReviewStatus = ['due', 'resolved', 'mastered'].includes(
      String(raw.status)
    )
      ? (raw.status as ReviewStatus)
      : 'due';
    const rating = ['again', 'hard', 'good', 'easy'].includes(
      String(raw.lastRating)
    )
      ? (raw.lastRating as ReviewRating)
      : undefined;

    items[problemSlug] = {
      problemSlug,
      status,
      source: raw.source === 'completion' ? 'completion' : 'mistake',
      dueAt: validDate(raw.dueAt, updatedAt),
      intervalDays: clamp(Number(raw.intervalDays) || 1, 1, 365),
      repetitions: clamp(Math.round(Number(raw.repetitions) || 0), 0, 1000),
      easeFactor: clamp(Number(raw.easeFactor) || 2.5, 1.3, 3.2),
      updatedAt,
      lastObservedRunAt:
        typeof raw.lastObservedRunAt === 'string'
          ? validDate(raw.lastObservedRunAt, updatedAt)
          : undefined,
      lastFailureAt:
        typeof raw.lastFailureAt === 'string'
          ? validDate(raw.lastFailureAt, updatedAt)
          : undefined,
      lastReviewedAt:
        typeof raw.lastReviewedAt === 'string'
          ? validDate(raw.lastReviewedAt, updatedAt)
          : undefined,
      lastRating: rating,
    };
  }

  return { version: REVIEW_PROGRESS_VERSION, items };
}

export function loadReviewProgress(
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): ReviewProgressState {
  const target = getStorage(storage);
  if (!target) return createInitialReviewProgress();
  try {
    const raw = target.getItem(scopedReviewKey(scope));
    return raw
      ? migrateReviewProgress(JSON.parse(raw))
      : createInitialReviewProgress();
  } catch {
    return createInitialReviewProgress();
  }
}

export function saveReviewProgress(
  progress: ReviewProgressState,
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.setItem(
      scopedReviewKey(scope),
      JSON.stringify({ ...progress, version: REVIEW_PROGRESS_VERSION })
    );
  } catch {
    // Review persistence remains best-effort when browser storage is restricted.
  }
}

export function clearReviewProgress(
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.removeItem(scopedReviewKey(scope));
  } catch {
    // Reset still clears in-memory review progress when storage is unavailable.
  }
}

export function mergeReviewProgress(
  current: ReviewProgressState,
  inherited: ReviewProgressState
): ReviewProgressState {
  const items = { ...inherited.items };
  for (const [slug, item] of Object.entries(current.items)) {
    const inheritedItem = items[slug];
    items[slug] =
      inheritedItem &&
      Date.parse(inheritedItem.updatedAt) > Date.parse(item.updatedAt)
        ? inheritedItem
        : item;
  }
  return { version: REVIEW_PROGRESS_VERSION, items };
}

export function hasReviewProgress(
  storage?: Storage,
  scope: CoachStorageScope = 'guest'
): boolean {
  const target = getStorage(storage);
  if (!target) return false;
  try {
    return Boolean(target.getItem(scopedReviewKey(scope)));
  } catch {
    return false;
  }
}

export function claimGuestReviewProgress(
  scope: CoachStorageScope,
  storage?: Storage
): boolean {
  if (scope === 'guest') return false;
  const target = getStorage(storage);
  if (!target || !hasReviewProgress(target, 'guest')) return false;
  const merged = mergeReviewProgress(
    loadReviewProgress(target, scope),
    loadReviewProgress(target, 'guest')
  );
  saveReviewProgress(merged, target, scope);
  clearReviewProgress(target, 'guest');
  return true;
}

function resolvedTimeZone(timeZone?: string): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format();
      return timeZone;
    } catch {
      return 'UTC';
    }
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function zonedCalendarDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day)
  );
}

function mondayCalendarDay(date: Date, timeZone: string): number {
  const localDay = zonedCalendarDay(date, timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);
  const daysFromMonday =
    (
      { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<
        string,
        number
      >
    )[weekday] ?? 0;
  return localDay - daysFromMonday * DAY_MS;
}

function runPassed(run: CodeRunResult): boolean {
  return run.status === 'passed';
}

function verifiedPass(run: CodeRunResult): boolean {
  if (!runPassed(run)) return false;
  return run.testScope !== 'sample';
}

export function isPracticeSessionCompleted(
  session: Pick<PracticeSession, 'runs' | 'completedAt'> | undefined
): boolean {
  if (!session) return false;
  const hasVerifiedPass = session.runs.some(verifiedPass);
  const hasExplicitSamplePass = session.runs.some(
    (run) => runPassed(run) && run.testScope === 'sample'
  );
  return Boolean(
    hasVerifiedPass || (session.completedAt && !hasExplicitSamplePass)
  );
}

function runTimestamp(run: CodeRunResult): number {
  const timestamp = Date.parse(run.executedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function runsForProblem(state: CoachState, problem: Problem): CodeRunResult[] {
  const sessionRuns = [
    ...(state.sessions[problem.slug]?.runs ?? []),
    ...(problem.id === problem.slug
      ? []
      : (state.sessions[problem.id]?.runs ?? [])),
  ];
  const flatRuns = state.runs.filter(
    (run) => run.problemSlug === problem.slug || run.problemSlug === problem.id
  );
  const seen = new Set<string>();
  return [...sessionRuns, ...flatRuns]
    .filter((run) => {
      const key =
        run.id ??
        [
          run.problemSlug,
          run.language,
          run.executedAt,
          run.status,
          run.passedTests,
          run.totalTests,
        ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => runTimestamp(left) - runTimestamp(right));
}

function firstCompletionAt(state: CoachState, problem: Problem): string | null {
  const runs = runsForProblem(state, problem);
  const fullPass = runs.find(verifiedPass);
  if (fullPass) return fullPass.executedAt;
  if (runs.some((run) => runPassed(run) && run.testScope === 'sample')) {
    return null;
  }
  const session = state.sessions[problem.slug] ?? state.sessions[problem.id];
  return session?.completedAt ?? null;
}

export function countNaturalWeekCompletions(
  state: CoachState,
  options: WeekOptions = {}
): number {
  const now = options.now ?? new Date();
  const timeZone = resolvedTimeZone(options.timeZone);
  const start = mondayCalendarDay(now, timeZone);
  const end = start + 7 * DAY_MS;

  return problems.filter((problem) => {
    const completedAt = firstCompletionAt(state, problem);
    if (!completedAt) return false;
    const completed = new Date(completedAt);
    if (!Number.isFinite(completed.getTime())) return false;
    const calendarDay = zonedCalendarDay(completed, timeZone);
    return calendarDay >= start && calendarDay < end;
  }).length;
}

export function calculateLearningStreak(
  state: CoachState,
  options: WeekOptions = {}
): number {
  const now = options.now ?? new Date();
  const timeZone = resolvedTimeZone(options.timeZone);
  const activeDays = new Set<number>();
  const runs = [
    ...state.runs,
    ...Object.values(state.sessions).flatMap((session) => session.runs),
  ];

  for (const run of runs) {
    const executedAt = new Date(run.executedAt);
    if (!Number.isFinite(executedAt.getTime())) continue;
    activeDays.add(zonedCalendarDay(executedAt, timeZone));
  }
  if (!activeDays.size) return 0;

  let cursor = zonedCalendarDay(now, timeZone);
  if (!activeDays.has(cursor)) cursor -= DAY_MS;
  let streak = 0;
  while (activeDays.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

function latestIso(values: Array<string | undefined>): string | null {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return timestamps.length
    ? new Date(Math.max(...timestamps)).toISOString()
    : null;
}

function problemScore(
  state: CoachState,
  problem: Problem,
  reviewItem?: ReviewItem
): {
  score: number;
  evidenceCount: number;
  completed: boolean;
  updatedAt: string | null;
} | null {
  const runs = runsForProblem(state, problem);
  const session = state.sessions[problem.slug] ?? state.sessions[problem.id];
  if (!runs.length && !session?.completedAt && !reviewItem) return null;

  const latest = runs.at(-1);
  const passRatio = latest?.totalTests
    ? latest.passedTests / latest.totalTests
    : session?.completedAt
      ? 1
      : 0;
  const hasVerifiedPass = runs.some(verifiedPass);
  const hasExplicitSamplePass = runs.some(
    (run) => runPassed(run) && run.testScope === 'sample'
  );
  const completed = Boolean(
    hasVerifiedPass || (session?.completedAt && !hasExplicitSamplePass)
  );
  const retryPenalty = Math.min(15, Math.max(0, runs.length - 1) * 2.5);
  const hintAdjustment = session
    ? session.hintLevel === 0
      ? 10
      : -session.hintLevel * 3
    : 0;
  const reviewAdjustment =
    reviewItem?.status === 'mastered'
      ? 15
      : reviewItem?.lastRating === 'easy'
        ? 12
        : reviewItem?.lastRating === 'good'
          ? 8
          : reviewItem?.lastRating === 'hard'
            ? -4
            : reviewItem?.lastRating === 'again'
              ? -12
              : 0;
  const score = clamp(
    passRatio * 55 +
      (completed ? 28 : 0) +
      hintAdjustment +
      reviewAdjustment -
      retryPenalty
  );

  return {
    score,
    evidenceCount: runs.length + (reviewItem?.repetitions ?? 0),
    completed,
    updatedAt: latestIso([
      latest?.executedAt,
      session?.updatedAt,
      reviewItem?.updatedAt,
    ]),
  };
}

export function calculateTopicMasterySnapshots(
  state: CoachState,
  reviewItems: Record<string, ReviewItem> = {}
): Record<ProblemTopic, TopicMasterySnapshot> {
  const snapshots = Object.fromEntries(
    ALL_PROBLEM_TOPICS.map((topic) => [
      topic,
      {
        topic,
        value: 0,
        confidence: 0,
        evidenceCount: 0,
        completedCount: 0,
        totalCount: problems.filter((problem) => problem.topics.includes(topic))
          .length,
        updatedAt: null,
      } satisfies TopicMasterySnapshot,
    ])
  ) as Record<ProblemTopic, TopicMasterySnapshot>;

  for (const topic of ALL_PROBLEM_TOPICS) {
    const related = problems.filter((problem) =>
      problem.topics.includes(topic)
    );
    const evidence = related
      .map((problem) =>
        problemScore(
          state,
          problem,
          reviewItems[problem.slug] ?? reviewItems[problem.id]
        )
      )
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!evidence.length) continue;

    const evidenceCount = evidence.reduce(
      (total, item) => total + Math.max(1, item.evidenceCount),
      0
    );
    const priorWeight = 1.25;
    const performance =
      (35 * priorWeight +
        evidence.reduce((total, item) => total + item.score, 0)) /
      (priorWeight + evidence.length);
    const coverage = evidence.length / Math.max(related.length, 1);
    snapshots[topic] = {
      topic,
      value: Math.round(clamp(performance * (0.78 + coverage * 0.22))),
      confidence: Math.round(clamp(evidenceCount * 12 + evidence.length * 8)),
      evidenceCount,
      completedCount: evidence.filter((item) => item.completed).length,
      totalCount: related.length,
      updatedAt: latestIso(evidence.map((item) => item.updatedAt ?? undefined)),
    };
  }

  return snapshots;
}

function initialReviewIntervalDays(
  state: CoachState,
  problem: Problem
): number {
  const session = state.sessions[problem.slug] ?? state.sessions[problem.id];
  if ((session?.hintLevel ?? 0) >= 2) return 2;
  if (session?.hintLevel === 1) return 4;
  return 7;
}

function reviewEvidence(state: CoachState, problem: Problem) {
  const runs = runsForProblem(state, problem);
  const lastFailure = runs.filter((run) => !runPassed(run)).at(-1);
  const candidates = runs.filter((run) => !runPassed(run) || verifiedPass(run));
  const latest = candidates.at(-1);
  if (!latest) return null;
  const session = state.sessions[problem.slug] ?? state.sessions[problem.id];
  const runAt = runTimestamp(latest);
  const completedAt = Date.parse(session?.completedAt ?? '');
  const evidenceAt =
    verifiedPass(latest) && Number.isFinite(completedAt)
      ? Math.max(runAt, completedAt)
      : runAt;
  return {
    run: latest,
    at: new Date(evidenceAt).toISOString(),
    passed: verifiedPass(latest),
    hadFailure: runs.some((run) => !runPassed(run)),
    lastFailureAt: lastFailure?.executedAt,
  };
}

export function reconcileReviewProgress(
  state: CoachState,
  current: ReviewProgressState,
  options: { now?: Date } = {}
): ReviewProgressState {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  let changed = false;
  const items = { ...current.items };

  for (const problem of problems) {
    const evidence = reviewEvidence(state, problem);
    if (!evidence) continue;
    const existing = items[problem.slug] ?? items[problem.id];
    const observedAt = Date.parse(existing?.lastObservedRunAt ?? '');
    const evidenceAt = Date.parse(evidence.at);

    if (!existing || !Number.isFinite(observedAt) || evidenceAt > observedAt) {
      changed = true;
      if (!evidence.passed) {
        items[problem.slug] = {
          problemSlug: problem.slug,
          status: 'due',
          source: 'mistake',
          dueAt: evidence.at,
          intervalDays: 1,
          repetitions: 0,
          easeFactor: existing?.easeFactor ?? 2.5,
          updatedAt: evidence.at,
          lastObservedRunAt: evidence.at,
          lastFailureAt: evidence.at,
          lastReviewedAt: existing?.lastReviewedAt,
          lastRating: existing?.lastRating,
        };
      } else {
        const intervalDays = initialReviewIntervalDays(state, problem);
        const keepMastered = existing?.status === 'mastered';
        items[problem.slug] = {
          problemSlug: problem.slug,
          status: keepMastered ? 'mastered' : 'resolved',
          source: evidence.hadFailure ? 'mistake' : 'completion',
          dueAt: keepMastered
            ? existing.dueAt
            : new Date(evidenceAt + intervalDays * DAY_MS).toISOString(),
          intervalDays: keepMastered ? existing.intervalDays : intervalDays,
          repetitions: existing?.repetitions ?? 0,
          easeFactor: existing?.easeFactor ?? 2.5,
          updatedAt: evidence.at,
          lastObservedRunAt: evidence.at,
          lastFailureAt: existing?.lastFailureAt ?? evidence.lastFailureAt,
          lastReviewedAt: existing?.lastReviewedAt,
          lastRating: existing?.lastRating,
        };
      }
    }
  }

  for (const [slug, item] of Object.entries(items)) {
    if (item.status !== 'resolved' || Date.parse(item.dueAt) > now.getTime()) {
      continue;
    }
    changed = true;
    items[slug] = { ...item, status: 'due', updatedAt: nowIso };
  }

  return changed ? { version: REVIEW_PROGRESS_VERSION, items } : current;
}

export function scheduleReview(
  item: ReviewItem,
  rating: ReviewRating,
  reviewedAt = new Date()
): ReviewScheduleResult {
  const easeDelta = { again: -0.2, hard: -0.15, good: 0, easy: 0.15 }[rating];
  const easeFactor = clamp(item.easeFactor + easeDelta, 1.3, 3.2);
  const repetitions = rating === 'again' ? 0 : item.repetitions + 1;
  let intervalDays: number;
  if (rating === 'again') intervalDays = 1;
  else if (rating === 'hard')
    intervalDays = Math.max(2, Math.round(item.intervalDays * 1.2));
  else if (rating === 'good') {
    intervalDays =
      repetitions === 1
        ? 3
        : repetitions === 2
          ? 7
          : Math.round(item.intervalDays * easeFactor);
  } else {
    intervalDays =
      repetitions === 1 ? 7 : Math.round(item.intervalDays * easeFactor * 1.3);
  }
  intervalDays = clamp(intervalDays, 1, 365);
  const reviewedAtIso = reviewedAt.toISOString();
  const nextReviewAt = new Date(
    reviewedAt.getTime() + intervalDays * DAY_MS
  ).toISOString();
  const nextItem: ReviewItem = {
    ...item,
    status: 'resolved',
    dueAt: nextReviewAt,
    intervalDays,
    repetitions,
    easeFactor,
    updatedAt: reviewedAtIso,
    lastReviewedAt: reviewedAtIso,
    lastRating: rating,
  };
  return { item: nextItem, nextReviewAt, intervalDays };
}

export function rateReviewItem(
  progress: ReviewProgressState,
  problemSlug: string,
  rating: ReviewRating,
  reviewedAt = new Date()
): ReviewProgressState {
  const existing = progress.items[problemSlug];
  if (!existing) return progress;
  const result = scheduleReview(existing, rating, reviewedAt);
  return {
    version: REVIEW_PROGRESS_VERSION,
    items: { ...progress.items, [problemSlug]: result.item },
  };
}

export function markReviewItemMastered(
  progress: ReviewProgressState,
  problemSlug: string,
  masteredAt = new Date()
): ReviewProgressState {
  const existing = progress.items[problemSlug];
  if (!existing) return progress;
  const timestamp = masteredAt.toISOString();
  return {
    version: REVIEW_PROGRESS_VERSION,
    items: {
      ...progress.items,
      [problemSlug]: {
        ...existing,
        status: 'mastered',
        updatedAt: timestamp,
        lastReviewedAt: timestamp,
        lastRating: 'easy',
      },
    },
  };
}
