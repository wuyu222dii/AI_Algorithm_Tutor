import { describe, expect, it } from 'vitest';

import {
  createDailyLearningPlan,
  estimateDailyPlanProblemMinutes,
  getDailyPlanDateKey,
  skipDailyPlanTask,
  swapDailyPlanTask,
} from './daily-plan';
import { createInitialCoachState } from './storage';
import { getPracticeSessionKey } from './sync';
import type {
  CoachState,
  CodeRunResult,
  Difficulty,
  LearningProfile,
  PracticeSession,
  Problem,
  ProblemTopic,
  ReviewItem,
} from './types';

const NOW = '2026-07-15T02:00:00.000Z';
const TIME_ZONE = 'Pacific/Auckland';

function profile(dailyMinutes = 30): LearningProfile {
  return {
    goal: 'foundation',
    preferredLanguage: 'javascript',
    weeklyTarget: 5,
    dailyMinutes,
    onboardingCompleted: true,
    onboardedAt: '2026-07-01T00:00:00.000Z',
  };
}

function problem(
  slug: string,
  topic: ProblemTopic,
  options: {
    difficulty?: Difficulty;
    estimatedMinutes?: number;
    contentVersion?: number;
    languages?: Array<'javascript' | 'python' | 'typescript'>;
  } = {}
): Problem {
  const languages = options.languages ?? ['javascript'];
  return {
    id: `problem-${slug}`,
    slug,
    title: { zh: slug, en: slug },
    description: { zh: slug, en: slug },
    difficulty: options.difficulty ?? 'easy',
    topics: [topic],
    languageConfigs: Object.fromEntries(
      languages.map((language) => [
        language,
        {
          entryPoint: 'solve',
          template: 'function solve(value) { return value; }',
        },
      ])
    ),
    version: { contentVersion: options.contentVersion ?? 1 },
    tests: [],
    examples: [],
    constraints: [],
    hints: {
      zh: ['提示一', '提示二', '提示三'],
      en: ['Hint one', 'Hint two', 'Hint three'],
    },
    reviewPoints: [],
    estimatedMinutes: options.estimatedMinutes ?? 10,
  };
}

function run(
  problemSlug: string,
  status: CodeRunResult['status'],
  executedAt: string
): CodeRunResult {
  return {
    problemSlug,
    language: 'javascript',
    status,
    passedTests: status === 'passed' ? 1 : 0,
    totalTests: 1,
    testResults: [],
    console: [],
    durationMs: 2,
    executedAt,
    testScope: 'full',
    problemContentVersion: 1,
  };
}

function session(
  problemSlug: string,
  options: {
    status?: CodeRunResult['status'];
    startedAt?: string;
    completedAt?: string;
    problemContentVersion?: number;
  } = {}
): PracticeSession {
  const startedAt = options.startedAt ?? '2026-07-14T00:00:00.000Z';
  const problemContentVersion = options.problemContentVersion ?? 1;
  return {
    problemSlug,
    problemContentVersion,
    code: {},
    runs: [
      {
        ...run(problemSlug, options.status ?? 'failed', startedAt),
        problemContentVersion,
      },
    ],
    hintLevel: 0,
    diagnosisCount: 0,
    correctedAfterDiagnosis: false,
    startedAt,
    updatedAt: options.completedAt ?? startedAt,
    completedAt: options.completedAt,
  };
}

function dueReview(problemSlug: string, dueAt: string): ReviewItem {
  return {
    problemSlug,
    status: 'due',
    source: 'mistake',
    dueAt,
    intervalDays: 1,
    repetitions: 0,
    easeFactor: 2.5,
    updatedAt: dueAt,
  };
}

function stateWithProfile(dailyMinutes = 30): CoachState {
  const state = createInitialCoachState();
  state.profile = profile(dailyMinutes);
  return state;
}

describe('daily learning plan', () => {
  it('uses the learner time zone for a stable plan date and id', () => {
    expect(getDailyPlanDateKey('2026-07-14T12:30:00.000Z', TIME_ZONE)).toBe(
      '2026-07-15'
    );
    expect(getDailyPlanDateKey('2026-07-14T11:30:00.000Z', TIME_ZONE)).toBe(
      '2026-07-14'
    );

    const input = {
      state: stateWithProfile(),
      reviewItems: {},
      catalog: [problem('first', 'array-hash')],
      timeZone: TIME_ZONE,
      profile: profile(),
    };
    const morning = createDailyLearningPlan({
      ...input,
      date: '2026-07-14T13:00:00.000Z',
    });
    const evening = createDailyLearningPlan({
      ...input,
      date: '2026-07-15T09:00:00.000Z',
    });

    expect(morning).toEqual(evening);
    expect(morning.id).toBe('daily-plan:Pacific%2FAuckland:2026-07-15');
  });

  it('creates at most one due, weak, and new task in priority order', () => {
    const due = problem('due-array', 'array-hash');
    const weak = problem('weak-stack', 'stack');
    const fresh = problem('fresh-two-pointers', 'two-pointers');
    const state = stateWithProfile(60);
    state.sessions[getPracticeSessionKey(weak.slug, 1)] = session(weak.slug);

    const plan = createDailyLearningPlan({
      state,
      reviewItems: {
        [due.slug]: dueReview(due.slug, '2026-07-14T01:00:00.000Z'),
      },
      catalog: [due, weak, fresh],
      date: NOW,
      timeZone: TIME_ZONE,
    });

    expect(plan.tasks.map((task) => task.kind)).toEqual([
      'due-review',
      'weak-topic',
      'new-topic',
    ]);
    expect(plan.tasks.map((task) => task.problemSlug)).toEqual([
      due.slug,
      weak.slug,
      fresh.slug,
    ]);
    expect(plan.tasks.map((task) => task.reason)).toEqual([
      'review-due',
      'weak-mastery',
      'new-topic',
    ]);
  });

  it('pins every task to the current content version', () => {
    const oldRevision = problem('versioned', 'array-hash', {
      contentVersion: 1,
    });
    const currentRevision = problem('versioned', 'array-hash', {
      contentVersion: 3,
    });
    const plan = createDailyLearningPlan({
      state: stateWithProfile(),
      reviewItems: {},
      catalog: [oldRevision, currentRevision],
      date: NOW,
      timeZone: TIME_ZONE,
    });

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].problemContentVersion).toBe(3);
    expect(plan.tasks[0].id).toBe(`${plan.id}:new-topic`);
  });

  it('uses median same-difficulty practice time and falls back to metadata', () => {
    const firstHistory = problem('history-one', 'array-hash', {
      difficulty: 'medium',
    });
    const secondHistory = problem('history-two', 'stack', {
      difficulty: 'medium',
    });
    const target = problem('target', 'binary-search', {
      difficulty: 'medium',
      estimatedMinutes: 27,
    });
    const fallback = problem('fallback', 'dfs', {
      difficulty: 'hard',
      estimatedMinutes: 24,
    });
    const state = stateWithProfile(60);
    state.sessions[firstHistory.slug] = session(firstHistory.slug, {
      status: 'passed',
      startedAt: '2026-07-10T00:00:00.000Z',
      completedAt: '2026-07-10T00:10:00.000Z',
    });
    state.sessions[secondHistory.slug] = session(secondHistory.slug, {
      status: 'passed',
      startedAt: '2026-07-11T00:00:00.000Z',
      completedAt: '2026-07-11T00:20:00.000Z',
    });
    const catalog = [firstHistory, secondHistory, target, fallback];

    expect(estimateDailyPlanProblemMinutes(target, state, catalog)).toBe(15);
    expect(estimateDailyPlanProblemMinutes(fallback, state, catalog)).toBe(24);

    const plan = createDailyLearningPlan({
      state,
      reviewItems: {},
      catalog,
      date: NOW,
      timeZone: TIME_ZONE,
    });
    expect(
      plan.tasks
        .filter((task) => task.difficulty === 'medium')
        .every((task) => task.estimatedMinutes === 15)
    ).toBe(true);
  });

  it('does not classify an old session using the difficulty of a newer revision', () => {
    const revised = problem('revised', 'dfs', {
      difficulty: 'hard',
      contentVersion: 2,
      estimatedMinutes: 28,
    });
    const target = problem('target-hard', 'dynamic-programming', {
      difficulty: 'hard',
      estimatedMinutes: 24,
    });
    const state = stateWithProfile(60);
    state.sessions[getPracticeSessionKey(revised.slug, 1)] = session(
      revised.slug,
      {
        status: 'passed',
        problemContentVersion: 1,
        startedAt: '2026-07-10T00:00:00.000Z',
        completedAt: '2026-07-10T00:05:00.000Z',
      }
    );

    expect(
      estimateDailyPlanProblemMinutes(target, state, [revised, target])
    ).toBe(24);
  });

  it('never exceeds the daily minute budget', () => {
    const due = problem('due', 'array-hash', { estimatedMinutes: 12 });
    const weak = problem('weak', 'stack', { estimatedMinutes: 12 });
    const fresh = problem('fresh', 'two-pointers', { estimatedMinutes: 12 });
    const state = stateWithProfile(20);
    state.sessions[weak.slug] = session(weak.slug);

    const plan = createDailyLearningPlan({
      state,
      reviewItems: {
        [due.slug]: dueReview(due.slug, '2026-07-14T00:00:00.000Z'),
      },
      catalog: [due, weak, fresh],
      date: NOW,
      timeZone: TIME_ZONE,
    });

    expect(plan.estimatedMinutes).toBeLessThanOrEqual(20);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].kind).toBe('due-review');
  });

  it('uses a 30 minute budget when dailyMinutes is absent', () => {
    const state = stateWithProfile();
    state.profile = { ...profile(), dailyMinutes: undefined };
    const plan = createDailyLearningPlan({
      state,
      reviewItems: {},
      catalog: [
        problem('first', 'array-hash', { estimatedMinutes: 20 }),
        problem('second', 'two-pointers', { estimatedMinutes: 20 }),
      ],
      date: NOW,
      timeZone: TIME_ZONE,
    });

    expect(plan.budgetMinutes).toBe(30);
    expect(plan.estimatedMinutes).toBeLessThanOrEqual(30);
  });

  it('uses the latest assessment to target a weak topic', () => {
    const olderWeak = problem('older-weak', 'stack');
    const latestWeak = problem('latest-weak', 'binary-search');
    const state = stateWithProfile(40);
    state.assessments = [
      {
        id: 'older',
        problemSlugs: [],
        startedAt: '2026-07-01T00:00:00.000Z',
        completedAt: '2026-07-01T00:08:00.000Z',
        score: 0,
        correctCount: 0,
        totalCount: 2,
        weakTopics: ['stack'],
        recommendation: 'Review stack.',
      },
      {
        id: 'latest',
        problemSlugs: [],
        startedAt: '2026-07-14T00:00:00.000Z',
        completedAt: '2026-07-14T00:08:00.000Z',
        score: 0,
        correctCount: 0,
        totalCount: 2,
        weakTopics: ['binary-search'],
        recommendation: 'Review binary search.',
      },
    ];

    const plan = createDailyLearningPlan({
      state,
      reviewItems: {},
      catalog: [olderWeak, latestWeak],
      date: NOW,
      timeZone: TIME_ZONE,
    });
    const weakTask = plan.tasks.find((task) => task.kind === 'weak-topic');

    expect(weakTask).toMatchObject({
      problemSlug: latestWeak.slug,
      primaryTopic: 'binary-search',
      reason: 'assessment-weak',
    });
  });

  it('avoids duplicate primary topics and schedules at most one hard problem', () => {
    const dueHard = problem('due-hard', 'array-hash', {
      difficulty: 'hard',
    });
    const sameTopic = problem('same-topic', 'array-hash');
    const weakHard = problem('weak-hard', 'stack', { difficulty: 'hard' });
    const newEasy = problem('new-easy', 'two-pointers');
    const state = stateWithProfile(60);
    state.sessions[weakHard.slug] = session(weakHard.slug);

    const plan = createDailyLearningPlan({
      state,
      reviewItems: {
        [dueHard.slug]: dueReview(dueHard.slug, '2026-07-14T00:00:00.000Z'),
      },
      catalog: [dueHard, sameTopic, weakHard, newEasy],
      date: NOW,
      timeZone: TIME_ZONE,
    });

    expect(new Set(plan.tasks.map((task) => task.primaryTopic)).size).toBe(
      plan.tasks.length
    );
    expect(
      plan.tasks.filter((task) => task.difficulty === 'hard')
    ).toHaveLength(1);
    expect(plan.tasks.some((task) => task.problemSlug === sameTopic.slug)).toBe(
      false
    );
  });

  it('filters out problems that do not support the preferred language', () => {
    const state = stateWithProfile();
    state.profile = { ...profile(), preferredLanguage: 'typescript' };
    const javascriptOnly = problem('javascript-only', 'array-hash');
    const typescript = problem('typescript', 'stack', {
      languages: ['typescript'],
    });

    const plan = createDailyLearningPlan({
      state,
      reviewItems: {},
      catalog: [javascriptOnly, typescript],
      date: NOW,
      timeZone: TIME_ZONE,
    });

    expect(plan.tasks.map((task) => task.problemSlug)).toEqual([
      typescript.slug,
    ]);
  });

  it('falls back to an enabled language that the revision actually supports', () => {
    const state = stateWithProfile();
    state.profile = { ...profile(), preferredLanguage: 'typescript' };
    const javascriptOnly = problem('javascript-only', 'array-hash');
    const typescriptOnly = problem('typescript-only', 'stack', {
      languages: ['typescript'],
    });

    const plan = createDailyLearningPlan({
      state,
      reviewItems: {},
      catalog: [javascriptOnly, typescriptOnly],
      date: NOW,
      timeZone: TIME_ZONE,
      enabledLanguages: ['javascript'],
    });

    expect(plan.preferredLanguage).toBe('javascript');
    expect(plan.tasks.map((task) => task.problemSlug)).toEqual([
      javascriptOnly.slug,
    ]);
  });

  it('falls back when the preferred language is enabled but unsupported by the catalog', () => {
    const state = stateWithProfile();
    state.profile = { ...profile(), preferredLanguage: 'typescript' };
    const javascriptOnly = problem('javascript-only', 'array-hash');

    const plan = createDailyLearningPlan({
      state,
      reviewItems: {},
      catalog: [javascriptOnly],
      date: NOW,
      timeZone: TIME_ZONE,
      enabledLanguages: ['typescript', 'javascript'],
    });

    expect(plan.preferredLanguage).toBe('javascript');
    expect(plan.tasks[0].problemSlug).toBe(javascriptOnly.slug);
  });

  it('skips a pending task immutably and records the required reason', () => {
    const plan = createDailyLearningPlan({
      state: stateWithProfile(),
      reviewItems: {},
      catalog: [problem('first', 'array-hash')],
      date: NOW,
      timeZone: TIME_ZONE,
    });
    const skipped = skipDailyPlanTask(
      plan,
      plan.tasks[0].id,
      '今天时间不足',
      NOW
    );

    expect(plan.tasks[0].status).toBe('pending');
    expect(skipped.tasks[0]).toMatchObject({
      status: 'skipped',
      skipReason: '今天时间不足',
    });
    expect(skipped.estimatedMinutes).toBe(0);
    expect(skipped.changes[0]).toMatchObject({
      action: 'skipped',
      reason: '今天时间不足',
      fromProblemSlug: 'first',
    });
    expect(() => skipDailyPlanTask(plan, plan.tasks[0].id, '   ', NOW)).toThrow(
      /non-empty/
    );
    expect(() =>
      skipDailyPlanTask(
        plan,
        plan.tasks[0].id,
        '跨日操作',
        '2026-07-16T02:00:00.000Z'
      )
    ).toThrow(/local date/);
  });

  it('swaps within the same slot while preserving all plan constraints', () => {
    const due = problem('due', 'array-hash');
    const weak = problem('weak', 'stack');
    const freshOne = problem('fresh-one', 'two-pointers');
    const freshTwo = problem('fresh-two', 'binary-search');
    const state = stateWithProfile(45);
    state.sessions[weak.slug] = session(weak.slug);
    const input = {
      state,
      reviewItems: {
        [due.slug]: dueReview(due.slug, '2026-07-14T00:00:00.000Z'),
      },
      catalog: [due, weak, freshOne, freshTwo],
      date: NOW,
      timeZone: TIME_ZONE,
    };
    const plan = createDailyLearningPlan(input);
    const original = plan.tasks.find((task) => task.kind === 'new-topic');
    expect(original).toBeDefined();

    const swapped = swapDailyPlanTask(
      plan,
      original!.id,
      '想换一个知识点',
      NOW,
      input
    );
    const replacement = swapped.tasks.find((task) => task.id === original!.id);

    expect(replacement?.kind).toBe('new-topic');
    expect(replacement?.problemSlug).not.toBe(original!.problemSlug);
    expect(swapped.estimatedMinutes).toBeLessThanOrEqual(swapped.budgetMinutes);
    expect(new Set(swapped.tasks.map((task) => task.primaryTopic)).size).toBe(
      swapped.tasks.length
    );
    expect(
      swapped.tasks.filter((task) => task.difficulty === 'hard').length
    ).toBeLessThanOrEqual(1);
    expect(swapped.changes[0]).toMatchObject({
      action: 'swapped',
      taskId: original!.id,
      reason: '想换一个知识点',
      fromProblemSlug: original!.problemSlug,
      toProblemSlug: replacement!.problemSlug,
    });
    expect(plan.tasks.find((task) => task.id === original!.id)).toEqual(
      original
    );
  });

  it('records a failed swap without changing the task', () => {
    const input = {
      state: stateWithProfile(),
      reviewItems: {},
      catalog: [problem('only', 'array-hash')],
      date: NOW,
      timeZone: TIME_ZONE,
    };
    const plan = createDailyLearningPlan(input);
    const result = swapDailyPlanTask(
      plan,
      plan.tasks[0].id,
      '不想做这题',
      NOW,
      input
    );

    expect(result.tasks).toEqual(plan.tasks);
    expect(result.changes[0]).toMatchObject({
      action: 'swap-unavailable',
      reason: '不想做这题',
    });
  });
});
