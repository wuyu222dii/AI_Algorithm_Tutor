'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Code2,
  Flame,
  GraduationCap,
  Play,
  Sparkles,
  Target,
} from 'lucide-react';
import { useLocale } from 'next-intl';

import { Link, useRouter } from '@/core/i18n/navigation';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Progress } from '@/shared/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/lib/utils';

import { getDailyPlanDateKey } from '../daily-plan';
import { LANGUAGE_REGISTRY } from '../languages';
import { countNaturalWeekCompletions } from '../learning-progress';
import { useCoachStore } from '../store';
import type { Language, LearningGoal } from '../types';
import { CoachPage, Metric, Panel, PanelHeading } from './coach-ui';
import { DailyPlanPanel } from './daily-plan-panel';
import {
  getCompletedProblemIds,
  getPreferredLanguage,
  getProfile,
  getRuns,
  isOnboarded,
  localeKey,
} from './domain-adapter';

const copy = {
  zh: {
    title: '今天，从一道好题开始',
    description: '按你的目标安排练习，在写代码、看反馈和复习之间形成稳定节奏。',
    greeting: '欢迎回来',
    resetGoal: '调整目标',
    onboardingTitle: '先定一个学习目标',
    onboardingDescription:
      '三步完成设置，之后的题目与练习节奏会围绕这个目标组织。',
    goal: '你当前最重要的目标',
    goalStudy: '打牢算法基础',
    goalStudyDetail: '系统理解数据结构与常见解法',
    goalJob: '准备技术面试',
    goalJobDetail: '聚焦高频题型与限时表达',
    goalContest: '提升竞赛能力',
    goalContestDetail: '训练复杂问题拆解与优化',
    language: '主要编程语言',
    weekly: '每周练习量',
    weeklyUnit: '道题 / 周',
    dailyTime: '每日可用时间',
    dailyTimeUnit: '分钟 / 天',
    start: '开始学习',
    today: '今日学习计划',
    todayDescription: '建议按顺序完成，预计 {minutes} 分钟。',
    continue: '开始练习',
    completed: '已完成',
    mastery: '知识点掌握',
    streak: '连续学习',
    streakUnit: '天',
    solved: '已完成题目',
    runs: '代码运行',
    thisWeek: '本周目标',
    explore: '浏览全部题目',
    assessmentTitle: '想知道当前水平？',
    assessmentDescription: '完成 20 分钟测评，获得知识点分析与下一步建议。',
    assessmentAction: '开始测评',
    baselineTitle: '先校准能力基线',
    baselineDescription: '8 分钟完成 2 道无 AI 题，让每日计划从真实水平出发。',
    baselineAction: '开始基线自测',
    checkpointTitle: '两周阶段复测已到期',
    checkpointDescription: '完成同难度新题，对比正确率与平均用时变化。',
    checkpointAction: '开始阶段复测',
    reasonRetry: '优先纠错',
    reasonReviewDue: '复习到期',
    reasonWeakTopic: '补强薄弱点',
    reasonGoalFit: '匹配学习目标',
    reasonContinue: '继续学习路径',
    minutes: '分钟',
    javascript: 'JavaScript',
    python: 'Python',
  },
  en: {
    title: 'Start today with one good problem',
    description:
      'Build a steady rhythm across coding, feedback, and review around your learning goal.',
    greeting: 'Welcome back',
    resetGoal: 'Edit goal',
    onboardingTitle: 'Set your learning goal',
    onboardingDescription:
      'Complete three quick choices so practice and pacing can match what you are working toward.',
    goal: 'Your most important goal',
    goalStudy: 'Build strong foundations',
    goalStudyDetail: 'Learn core data structures and solution patterns',
    goalJob: 'Prepare for interviews',
    goalJobDetail: 'Focus on common patterns and timed explanations',
    goalContest: 'Improve contest skills',
    goalContestDetail: 'Practice decomposing and optimizing harder problems',
    language: 'Primary language',
    weekly: 'Weekly practice target',
    weeklyUnit: 'problems / week',
    dailyTime: 'Daily time budget',
    dailyTimeUnit: 'minutes / day',
    start: 'Start learning',
    today: "Today's plan",
    todayDescription: 'Complete in order. Estimated time: {minutes} minutes.',
    continue: 'Start practice',
    completed: 'Completed',
    mastery: 'Topic mastery',
    streak: 'Learning streak',
    streakUnit: 'days',
    solved: 'Problems completed',
    runs: 'Code runs',
    thisWeek: 'Weekly goal',
    explore: 'Browse all problems',
    assessmentTitle: 'Want a clear baseline?',
    assessmentDescription:
      'Take a 20-minute assessment for topic analysis and a focused next step.',
    assessmentAction: 'Start assessment',
    baselineTitle: 'Calibrate your baseline first',
    baselineDescription:
      'Solve two no-AI problems in 8 minutes so the daily plan starts from evidence.',
    baselineAction: 'Start baseline',
    checkpointTitle: 'Your two-week checkpoint is ready',
    checkpointDescription:
      'Solve comparable new problems and compare accuracy and average time.',
    checkpointAction: 'Start checkpoint',
    reasonRetry: 'Retry priority',
    reasonReviewDue: 'Review due',
    reasonWeakTopic: 'Strengthen weak topic',
    reasonGoalFit: 'Matches your goal',
    reasonContinue: 'Continue your path',
    minutes: 'min',
    javascript: 'JavaScript',
    python: 'Python',
  },
} as const;

const goalOptions = [
  {
    value: 'foundation',
    title: 'goalStudy',
    detail: 'goalStudyDetail',
    icon: GraduationCap,
  },
  {
    value: 'interview',
    title: 'goalJob',
    detail: 'goalJobDetail',
    icon: BriefcaseBusiness,
  },
  {
    value: 'contest',
    title: 'goalContest',
    detail: 'goalContestDetail',
    icon: Sparkles,
  },
] as const;

export function LearnPage() {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const coach = useCoachStore();
  const router = useRouter();
  const enabledLanguages = coach.enabledLanguages;
  const trackEvent = coach.trackEvent;
  const ensureDailyPlan = coach.ensureDailyPlan;
  const state = coach.state;
  const profile = getProfile(state);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(String(profile?.goal ?? 'interview'));
  const [selectedLanguage, setLanguage] = useState<Language>(
    getPreferredLanguage(state)
  );
  const [weeklyGoal, setWeeklyGoal] = useState(
    String(profile?.weeklyTarget ?? profile?.weeklyGoal ?? 5)
  );
  const [dailyMinutes, setDailyMinutes] = useState(
    String(profile?.dailyMinutes ?? 30)
  );
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [currentTimestamp] = useState(() => Date.now());

  const language = enabledLanguages.some(
    (languageId) => languageId === selectedLanguage
  )
    ? selectedLanguage
    : (enabledLanguages[0] ?? 'javascript');
  const completedIds = getCompletedProblemIds(state);
  const runs = getRuns(state);
  const completedCount = completedIds.size;
  const weeklyCompletedCount = useMemo(
    () => countNaturalWeekCompletions(state, { catalog: coach.problems }),
    [coach.problems, state]
  );
  const onboarded = isOnboarded(state) && !editing;

  const todaysPlan = useMemo(() => {
    if (!timeZone) return undefined;
    const localDate = getDailyPlanDateKey(new Date(), timeZone);
    return Object.values(state.dailyPlans).find(
      (plan) => plan.localDate === localDate && plan.timeZone === timeZone
    );
  }, [state.dailyPlans, timeZone]);
  const onboardingStarted = state.events.some(
    (event) => event.name === 'onboarding_started'
  );

  useEffect(() => {
    if (coach.hydrated && !profile && !onboardingStarted) {
      trackEvent('onboarding_started');
    }
  }, [coach.hydrated, onboardingStarted, profile, trackEvent]);

  useEffect(() => {
    if (!coach.hydrated || !profile?.onboardingCompleted) return;
    ensureDailyPlan(timeZone);
  }, [coach.hydrated, ensureDailyPlan, profile?.onboardingCompleted, timeZone]);

  const latestBaseline = useMemo(
    () =>
      [...state.assessments]
        .filter((assessment) => assessment.kind === 'baseline')
        .sort(
          (left, right) =>
            Date.parse(right.completedAt) - Date.parse(left.completedAt)
        )[0],
    [state.assessments]
  );
  const latestCheckpoint = useMemo(
    () =>
      [...state.assessments]
        .filter(
          (assessment) =>
            assessment.kind === 'checkpoint' &&
            assessment.baselineAssessmentId === latestBaseline?.id
        )
        .sort(
          (left, right) =>
            Date.parse(right.completedAt) - Date.parse(left.completedAt)
        )[0],
    [latestBaseline?.id, state.assessments]
  );
  const checkpointDue = Boolean(
    latestBaseline &&
      currentTimestamp - Date.parse(latestBaseline.completedAt) >=
        14 * 24 * 60 * 60 * 1000 &&
      (!latestCheckpoint ||
        Date.parse(latestCheckpoint.completedAt) <
          Date.parse(latestBaseline.completedAt))
  );
  const assessmentCard = !latestBaseline
    ? {
        title: t.baselineTitle,
        description: t.baselineDescription,
        action: t.baselineAction,
        href: '/assessment?kind=baseline',
      }
    : checkpointDue
      ? {
          title: t.checkpointTitle,
          description: t.checkpointDescription,
          action: t.checkpointAction,
          href: `/assessment?kind=checkpoint&baseline=${encodeURIComponent(latestBaseline.id)}`,
        }
      : {
          title: t.assessmentTitle,
          description: t.assessmentDescription,
          action: t.assessmentAction,
          href: '/assessment',
        };

  const weeklyTarget = Number(
    profile?.weeklyTarget ?? profile?.weeklyGoal ?? weeklyGoal ?? 5
  );
  const weeklyProgress = Math.min(
    100,
    Math.round((weeklyCompletedCount / Math.max(weeklyTarget, 1)) * 100)
  );

  function handleOnboarding(event: FormEvent) {
    event.preventDefault();
    coach.completeOnboarding({
      goal: goal as LearningGoal,
      preferredLanguage: language,
      weeklyTarget: Number(weeklyGoal),
      dailyMinutes: Number(dailyMinutes),
    });
    setEditing(false);
  }

  if (!onboarded) {
    return (
      <CoachPage
        title={t.onboardingTitle}
        description={t.onboardingDescription}
      >
        <form
          onSubmit={handleOnboarding}
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        >
          <Panel>
            <PanelHeading icon={<Target className="size-4" />} title={t.goal} />
            <RadioGroup
              value={goal}
              onValueChange={setGoal}
              className="grid gap-3 p-4 md:grid-cols-3 md:p-5"
            >
              {goalOptions.map((option) => {
                const Icon = option.icon;
                const active = goal === option.value;
                return (
                  <Label
                    key={option.value}
                    htmlFor={`goal-${option.value}`}
                    className={cn(
                      'hover:bg-muted/50 relative flex min-h-36 cursor-pointer flex-col items-start rounded-lg border p-4 transition-colors',
                      active &&
                        'border-primary bg-primary/5 ring-primary/15 ring-2'
                    )}
                  >
                    <RadioGroupItem
                      id={`goal-${option.value}`}
                      value={option.value}
                      className="sr-only"
                    />
                    <span className="bg-muted text-foreground flex size-9 items-center justify-center rounded-md">
                      <Icon className="size-5" />
                    </span>
                    <span className="mt-4 text-sm font-semibold">
                      {t[option.title]}
                    </span>
                    <span className="text-muted-foreground mt-1 text-xs leading-5">
                      {t[option.detail]}
                    </span>
                    {active ? (
                      <Check className="text-primary absolute top-3 right-3 size-4" />
                    ) : null}
                  </Label>
                );
              })}
            </RadioGroup>
          </Panel>

          <div className="space-y-4">
            <Panel className="p-5">
              <div className="space-y-2">
                <Label htmlFor="language">{t.language}</Label>
                <Select
                  value={language}
                  onValueChange={(value) => setLanguage(value as Language)}
                >
                  <SelectTrigger id="language" className="w-full rounded-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledLanguages.map((languageId) => (
                      <SelectItem key={languageId} value={languageId}>
                        {LANGUAGE_REGISTRY[languageId].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-5 space-y-2">
                <Label htmlFor="weekly-goal">{t.weekly}</Label>
                <Select value={weeklyGoal} onValueChange={setWeeklyGoal}>
                  <SelectTrigger id="weekly-goal" className="w-full rounded-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 5, 7, 10].map((count) => (
                      <SelectItem key={count} value={String(count)}>
                        {count} {t.weeklyUnit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-5 space-y-2">
                <Label htmlFor="daily-minutes">{t.dailyTime}</Label>
                <Select value={dailyMinutes} onValueChange={setDailyMinutes}>
                  <SelectTrigger
                    id="daily-minutes"
                    className="w-full rounded-md"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[20, 30, 45, 60].map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {minutes} {t.dailyTimeUnit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                className="mt-6 w-full"
                disabled={!coach.hydrated}
              >
                {t.start}
                <ArrowRight />
              </Button>
            </Panel>
          </div>
        </form>
      </CoachPage>
    );
  }

  return (
    <CoachPage
      title={t.title}
      description={t.description}
      actions={
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {t.resetGoal}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={t.streak}
          value={`${coach.metrics.currentStreak} ${t.streakUnit}`}
          icon={<Flame className="size-5" />}
          accent="amber"
        />
        <Metric
          label={t.solved}
          value={String(completedCount)}
          icon={<BookOpenCheck className="size-5" />}
          accent="success"
        />
        <Metric
          label={t.runs}
          value={String(runs.length)}
          icon={<Code2 className="size-5" />}
        />
        <div className="bg-card rounded-lg border p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.thisWeek}</span>
            <CalendarDays className="text-primary size-5" />
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums">
            {Math.min(weeklyCompletedCount, weeklyTarget)} / {weeklyTarget}
          </p>
          <Progress value={weeklyProgress} className="mt-3" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {todaysPlan ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              <Button asChild variant="ghost" size="sm">
                <Link href="/problems">{t.explore}</Link>
              </Button>
            </div>
            <DailyPlanPanel
              plan={todaysPlan}
              problems={coach.problems}
              locale={locale}
              onSkip={(taskId, reason) =>
                coach.skipDailyPlanTask(todaysPlan.id, taskId, reason)
              }
              onSwap={(taskId, reason) =>
                coach.swapDailyPlanTask(todaysPlan.id, taskId, reason)
              }
              onOpen={(task) => {
                coach.trackEvent('daily_plan_task_started', {
                  problemSlug: task.problemSlug,
                  properties: {
                    planId: todaysPlan.id,
                    taskId: task.id,
                    kind: task.kind,
                  },
                });
                router.push(
                  task.kind === 'due-review'
                    ? '/review'
                    : `/practice/${task.problemSlug}`
                );
              }}
            />
          </div>
        ) : (
          <Panel>
            <PanelHeading
              icon={<Play className="size-4" />}
              title={t.today}
              description={t.todayDescription.replace('{minutes}', '0')}
            />
          </Panel>
        )}

        <Panel className="overflow-hidden" tone="muted">
          <div className="p-5">
            <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
              <ClipboardAssessmentIcon />
            </div>
            <h2 className="mt-5 text-lg font-semibold">
              {assessmentCard.title}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {assessmentCard.description}
            </p>
            <Button asChild className="mt-6 w-full">
              <Link href={assessmentCard.href}>
                {assessmentCard.action}
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </Panel>
      </div>
    </CoachPage>
  );
}

function ClipboardAssessmentIcon() {
  return <BookOpenCheck className="size-5" />;
}
