'use client';

import { FormEvent, useMemo, useState } from 'react';
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

import { Link } from '@/core/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
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

import { problems } from '../data/problems';
import { useCoachStore } from '../store';
import type { Language, LearningGoal } from '../types';
import { CoachPage, Metric, Panel, PanelHeading } from './coach-ui';
import {
  getCompletedProblemIds,
  getPreferredLanguage,
  getProfile,
  getRuns,
  isOnboarded,
  localeKey,
  localizedProblem,
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
    start: '开始学习',
    today: '今日学习计划',
    todayDescription: '建议按顺序完成，预计 35 分钟。',
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
    start: 'Start learning',
    today: "Today's plan",
    todayDescription: 'Complete in order. Estimated time: 35 minutes.',
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
  const state = coach.state;
  const profile = getProfile(state);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(String(profile?.goal ?? 'interview'));
  const [language, setLanguage] = useState<Language>(
    getPreferredLanguage(state)
  );
  const [weeklyGoal, setWeeklyGoal] = useState(
    String(profile?.weeklyTarget ?? profile?.weeklyGoal ?? 5)
  );
  const completedIds = getCompletedProblemIds(state);
  const runs = getRuns(state);
  const completedCount = completedIds.size;
  const onboarded = isOnboarded(state) && !editing;

  const todaysProblems = useMemo(() => {
    const unfinished = problems.filter(
      (problem) =>
        !completedIds.has(problem.id) && !completedIds.has(problem.slug)
    );
    return [...unfinished, ...problems].slice(0, 3);
  }, [completedIds]);

  const weeklyTarget = Number(
    profile?.weeklyTarget ?? profile?.weeklyGoal ?? weeklyGoal ?? 5
  );
  const weeklyProgress = Math.min(
    100,
    Math.round((completedCount / Math.max(weeklyTarget, 1)) * 100)
  );

  function handleOnboarding(event: FormEvent) {
    event.preventDefault();
    coach.completeOnboarding({
      goal: goal as LearningGoal,
      preferredLanguage: language,
      weeklyTarget: Number(weeklyGoal),
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
                    <SelectItem value="javascript">{t.javascript}</SelectItem>
                    <SelectItem value="python">{t.python}</SelectItem>
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
            {Math.min(completedCount, weeklyTarget)} / {weeklyTarget}
          </p>
          <Progress value={weeklyProgress} className="mt-3" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeading
            icon={<Play className="size-4" />}
            title={t.today}
            description={t.todayDescription}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href="/problems">{t.explore}</Link>
              </Button>
            }
          />
          <div className="divide-y">
            {todaysProblems.map((problem, index) => {
              const localized = localizedProblem(problem, locale);
              const completed =
                completedIds.has(problem.id) || completedIds.has(problem.slug);
              return (
                <div
                  key={problem.id}
                  className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center md:px-5"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold',
                        completed &&
                          'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      )}
                    >
                      {completed ? <Check className="size-4" /> : index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{localized.titleText}</h3>
                        <Badge
                          variant="secondary"
                          className="rounded-md text-[11px]"
                        >
                          {problem.topics[0]}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-5">
                        {localized.descriptionText}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 pl-11 sm:pl-0">
                    <span className="text-muted-foreground text-xs">
                      {problem.estimatedMinutes} {t.minutes}
                    </span>
                    <Button
                      asChild
                      size="sm"
                      variant={completed ? 'outline' : 'default'}
                    >
                      <Link href={`/practice/${problem.slug}`}>
                        {completed ? t.completed : t.continue}
                        <ArrowRight />
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel className="overflow-hidden" tone="muted">
          <div className="p-5">
            <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
              <ClipboardAssessmentIcon />
            </div>
            <h2 className="mt-5 text-lg font-semibold">{t.assessmentTitle}</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {t.assessmentDescription}
            </p>
            <Button asChild className="mt-6 w-full">
              <Link href="/assessment">
                {t.assessmentAction}
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
