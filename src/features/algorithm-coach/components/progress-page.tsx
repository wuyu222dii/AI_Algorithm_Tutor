'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
  Flame,
  RotateCcw,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Progress } from '@/shared/components/ui/progress';
import { cn } from '@/shared/lib/utils';

import { trackProductEvent } from '../analytics';
import { problems } from '../data/problems';
import { useCoachStore } from '../store';
import type { CodeRunResult } from '../types';
import { CoachPage, Metric, Panel, PanelHeading } from './coach-ui';
import {
  getArtifacts,
  getCompletedProblemIds,
  getProfile,
  getRuns,
  localeKey,
  runPassed,
} from './domain-adapter';

const copy = {
  zh: {
    title: '学习进度',
    description: '用练习、提示和纠错数据观察学习质量，而不只统计做题数量。',
    completion: '练习完成率',
    hintUsage: 'Hint 使用率',
    correction: '纠错有效率',
    streak: '连续学习',
    days: '天',
    completed: '已完成',
    of: '共',
    runs: '次运行',
    correctedDetail: '先失败后通过的题目',
    weekly: '近 7 天练习',
    weeklyDetail: '按代码运行次数统计',
    noActivity: '本周还没有运行记录',
    mastery: '知识点掌握度',
    masteryDetail: '综合完成题目和纠错记录估算',
    strong: '稳定',
    growing: '提升中',
    focus: '需加强',
    assessment: '最近测评',
    assessmentEmpty: '完成一次 20 分钟测评后，这里会展示正确率与用时。',
    score: '正确率',
    duration: '用时',
    minutes: '分钟',
    feedback: '本周学习体验',
    feedbackDetail: '这套练习与反馈是否帮助你更快理解问题？',
    helpful: '有帮助',
    notHelpful: '需改进',
    thanks: '反馈已记录',
    data: '本地学习数据',
    dataDetail: '当前 MVP 将代码、运行记录和复习卡片保存在此浏览器。',
    reset: '重置全部数据',
    resetConfirm: '确定要清除所有学习记录和设置吗？此操作无法撤销。',
    resetDone: '学习数据已重置',
    weeklyGoal: '本周目标',
  },
  en: {
    title: 'Learning Progress',
    description:
      'Use practice, hint, and correction data to track learning quality, not only problem count.',
    completion: 'Completion rate',
    hintUsage: 'Hint usage',
    correction: 'Correction effectiveness',
    streak: 'Learning streak',
    days: 'days',
    completed: 'completed',
    of: 'of',
    runs: 'runs',
    correctedDetail: 'Problems passed after an earlier failure',
    weekly: 'Last 7 days',
    weeklyDetail: 'Measured by code runs',
    noActivity: 'No code runs this week yet',
    mastery: 'Topic mastery',
    masteryDetail: 'Estimated from completed problems and correction history',
    strong: 'Stable',
    growing: 'Growing',
    focus: 'Needs focus',
    assessment: 'Latest assessment',
    assessmentEmpty:
      'Complete a 20-minute assessment to see accuracy and time here.',
    score: 'Accuracy',
    duration: 'Time',
    minutes: 'min',
    feedback: 'This week’s learning experience',
    feedbackDetail:
      'Did this practice and feedback help you understand problems faster?',
    helpful: 'Helpful',
    notHelpful: 'Needs improvement',
    thanks: 'Feedback recorded',
    data: 'Local learning data',
    dataDetail: 'This MVP stores code, runs, and review cards in this browser.',
    reset: 'Reset all data',
    resetConfirm:
      'Clear all learning history and settings? This cannot be undone.',
    resetDone: 'Learning data reset',
    weeklyGoal: 'Weekly target',
  },
} as const;

export function ProgressPage() {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const coach = useCoachStore();
  const state = coach.state;
  const runs = getRuns(state);
  const artifacts = getArtifacts(state);
  const profile = getProfile(state);
  const completedIds = getCompletedProblemIds(state);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const completionRate = Math.round(
    (completedIds.size / Math.max(problems.length, 1)) * 100
  );
  const hintCount = artifacts.filter(
    (artifact) => artifact.type === 'hint'
  ).length;
  const hintUsageRate = runs.length
    ? Math.min(100, Math.round((hintCount / runs.length) * 100))
    : 0;

  const problemOutcomes = useMemo(() => {
    const map = new Map<string, { failed: boolean; passed: boolean }>();
    runs.forEach((run) => {
      const id = String(run.problemSlug);
      if (!id) return;
      const current = map.get(id) ?? { failed: false, passed: false };
      if (runPassed(run)) current.passed = true;
      else current.failed = true;
      map.set(id, current);
    });
    return map;
  }, [runs]);

  const failedIds = Array.from(problemOutcomes.values()).filter(
    (value) => value.failed
  ).length;
  const correctedIds = Array.from(problemOutcomes.values()).filter(
    (value) => value.failed && value.passed
  ).length;
  const correctionRate = failedIds
    ? Math.round((correctedIds / failedIds) * 100)
    : 0;
  const activity = useMemo(() => buildActivity(runs, locale), [locale, runs]);
  const streak = calculateStreak(runs);
  const topicMastery = useMemo(
    () =>
      Array.from(new Set(problems.flatMap((problem) => problem.topics)))
        .map((topic) => {
          const related = problems.filter((problem) =>
            problem.topics.includes(topic)
          );
          const done = related.filter(
            (problem) =>
              completedIds.has(problem.id) || completedIds.has(problem.slug)
          ).length;
          const failed = related.filter((problem) => {
            const outcome =
              problemOutcomes.get(problem.id) ??
              problemOutcomes.get(problem.slug);
            return outcome?.failed && !outcome?.passed;
          }).length;
          const value = Math.max(
            0,
            Math.min(
              100,
              Math.round((done / Math.max(related.length, 1)) * 100) -
                failed * 12
            )
          );
          return { topic, value, done, total: related.length };
        })
        .sort((a, b) => b.value - a.value),
    [completedIds, problemOutcomes]
  );

  const latestAssessment = state.assessments.at(-1);
  const weeklyGoal = Number(profile?.weeklyTarget ?? 5);

  function sendFeedback(value: 'up' | 'down') {
    setFeedback(value);
    trackProductEvent('csat_submitted', {
      properties: { score: value === 'up' ? 5 : 2 },
    });
    toast.success(t.thanks);
  }

  function resetData() {
    if (!window.confirm(t.resetConfirm)) return;
    coach.resetData();
    toast.success(t.resetDone);
  }

  return (
    <CoachPage title={t.title} description={t.description}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={t.completion}
          value={`${completionRate}%`}
          detail={`${completedIds.size} ${t.of} ${problems.length} ${t.completed}`}
          icon={<BookOpenCheck className="size-5" />}
          accent="success"
        />
        <Metric
          label={t.hintUsage}
          value={`${hintUsageRate}%`}
          detail={`${hintCount} / ${runs.length} ${t.runs}`}
          icon={<CircleHelp className="size-5" />}
          accent="amber"
        />
        <Metric
          label={t.correction}
          value={`${correctionRate}%`}
          detail={`${correctedIds} ${t.correctedDetail}`}
          icon={<CheckCircle2 className="size-5" />}
          accent="success"
        />
        <Metric
          label={t.streak}
          value={`${streak} ${t.days}`}
          detail={`${Math.min(completedIds.size, weeklyGoal)} / ${weeklyGoal} ${t.weeklyGoal}`}
          icon={<Flame className="size-5" />}
          accent="amber"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
        <Panel>
          <PanelHeading
            icon={<BarChart3 className="size-4" />}
            title={t.weekly}
            description={t.weeklyDetail}
          />
          <div className="p-4 md:p-5">
            <div className="flex h-52 items-end gap-2 sm:gap-4">
              {activity.map((day) => {
                const max = Math.max(...activity.map((item) => item.count), 1);
                const height = day.count
                  ? Math.max(12, (day.count / max) * 100)
                  : 3;
                return (
                  <div
                    key={day.key}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                  >
                    <span className="text-muted-foreground text-xs font-medium tabular-nums">
                      {day.count || ''}
                    </span>
                    <div className="bg-muted flex h-36 w-full max-w-12 items-end overflow-hidden rounded-md">
                      <div
                        className={cn(
                          'bg-primary w-full rounded-t-sm transition-all',
                          day.count === 0 && 'bg-border'
                        )}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground w-full truncate text-center text-[11px]">
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
            {!activity.some((day) => day.count) ? (
              <p className="text-muted-foreground mt-3 text-center text-xs">
                {t.noActivity}
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeading
            icon={<Target className="size-4" />}
            title={t.assessment}
          />
          {latestAssessment ? (
            <div className="p-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground text-xs">{t.score}</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums">
                    {Number(latestAssessment.score ?? 0)}%
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">{t.duration}</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums">
                    {Math.max(
                      1,
                      Math.round(
                        (new Date(latestAssessment.completedAt).getTime() -
                          new Date(latestAssessment.startedAt).getTime()) /
                          60_000
                      )
                    )}
                    <span className="text-muted-foreground ml-1 text-sm font-normal">
                      {t.minutes}
                    </span>
                  </p>
                </div>
              </div>
              <Progress
                value={Number(latestAssessment.score ?? 0)}
                className="mt-6"
              />
            </div>
          ) : (
            <div className="text-muted-foreground flex min-h-52 items-center justify-center p-6 text-center text-sm leading-6">
              {t.assessmentEmpty}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-6">
        <PanelHeading
          icon={<TrendingUp className="size-4" />}
          title={t.mastery}
          description={t.masteryDetail}
        />
        <div className="grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2 md:p-5 xl:grid-cols-3">
          {topicMastery.map(({ topic, value, done, total }) => (
            <div key={topic}>
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {topic}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    'rounded-md text-[10px]',
                    value >= 70 &&
                      'border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
                    value >= 40 &&
                      value < 70 &&
                      'border-amber-500/30 text-amber-700 dark:text-amber-300',
                    value < 40 &&
                      'border-red-500/30 text-red-700 dark:text-red-300'
                  )}
                >
                  {value >= 70 ? t.strong : value >= 40 ? t.growing : t.focus}
                </Badge>
              </div>
              <Progress value={value} className="mt-2 h-1.5" />
              <div className="text-muted-foreground mt-1.5 flex justify-between text-[11px]">
                <span>
                  {done} / {total}
                </span>
                <span>{value}%</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-md">
              <Activity className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{t.feedback}</h2>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                {t.feedbackDetail}
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  variant={feedback === 'up' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => sendFeedback('up')}
                >
                  <ThumbsUp />
                  {t.helpful}
                </Button>
                <Button
                  variant={feedback === 'down' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => sendFeedback('down')}
                >
                  <ThumbsDown />
                  {t.notHelpful}
                </Button>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
              <RotateCcw className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{t.data}</h2>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                {t.dataDetail}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={resetData}
              className="shrink-0"
            >
              <RotateCcw />
              {t.reset}
            </Button>
          </div>
        </Panel>
      </div>
    </CoachPage>
  );
}

function buildActivity(runs: CodeRunResult[], locale: 'zh' | 'en') {
  const now = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(now.getDate() - (6 - index));
    const next = new Date(date);
    next.setDate(date.getDate() + 1);
    const count = runs.filter((run) => {
      const timestamp = new Date(run.executedAt).getTime();
      return timestamp >= date.getTime() && timestamp < next.getTime();
    }).length;
    return {
      key: date.toISOString(),
      label: new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        weekday: 'short',
      }).format(date),
      count,
    };
  });
}

function calculateStreak(runs: CodeRunResult[]) {
  const days = new Set(
    runs
      .map((run) => run.executedAt)
      .filter(Boolean)
      .map((value) => {
        const date = new Date(value);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
      })
  );
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.getTime())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
