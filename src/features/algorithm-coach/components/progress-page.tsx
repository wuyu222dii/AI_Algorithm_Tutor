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

import {
  calculateTopicMasterySnapshots,
  countNaturalWeekCompletions,
  TOPIC_LABELS,
} from '../learning-progress';
import { useCoachStore } from '../store';
import type { CodeRunResult } from '../types';
import { CoachPage, Metric, Panel, PanelHeading } from './coach-ui';
import { getProfile, getRuns, localeKey } from './domain-adapter';

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
    attempted: '已开始',
    runs: '次运行',
    correctedDetail: '诊断后纠正的题目',
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
    data: '学习数据',
    dataDetail: '访客数据保存在此浏览器；登录后会同步至账户数据库。',
    reset: '重置全部数据',
    resetConfirm: '确定要清除所有学习记录和设置吗？此操作无法撤销。',
    resetDone: '学习数据已重置',
    resetFailed: '本地数据已清除，但云端重置失败，请稍后重试',
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
    attempted: 'started',
    runs: 'runs',
    correctedDetail: 'Problems corrected after diagnosis',
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
    data: 'Learning data',
    dataDetail:
      'Guest data stays in this browser; signed-in data syncs to your account database.',
    reset: 'Reset all data',
    resetConfirm:
      'Clear all learning history and settings? This cannot be undone.',
    resetDone: 'Learning data reset',
    resetFailed:
      'Local data was cleared, but cloud reset failed. Try again later.',
    weeklyGoal: 'Weekly target',
  },
} as const;

export function ProgressPage() {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const coach = useCoachStore();
  const state = coach.state;
  const runs = getRuns(state);
  const profile = getProfile(state);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const completionRate = Math.round(coach.metrics.practiceCompletionRate * 100);
  const hintUsageRate = Math.round(coach.metrics.hintUsageRate * 100);
  const correctionRate = Math.round(
    coach.metrics.correctionEffectiveness * 100
  );
  const activity = useMemo(() => buildActivity(runs, locale), [locale, runs]);
  const streak = coach.metrics.currentStreak;
  const topicMastery = useMemo(
    () =>
      Object.values(
        calculateTopicMasterySnapshots(state, coach.reviewItems, coach.problems)
      ).sort((a, b) => b.value - a.value),
    [coach.problems, coach.reviewItems, state]
  );

  const latestAssessment = state.assessments.at(-1);
  const weeklyGoal = Number(profile?.weeklyTarget ?? 5);
  const weeklyCompletedCount = useMemo(
    () => countNaturalWeekCompletions(state, { catalog: coach.problems }),
    [coach.problems, state]
  );

  function sendFeedback(value: 'up' | 'down') {
    setFeedback(value);
    coach.trackEvent('csat_submitted', {
      properties: { score: value === 'up' ? 5 : 2 },
    });
    toast.success(t.thanks);
  }

  async function resetData() {
    if (!window.confirm(t.resetConfirm)) return;
    setIsResetting(true);
    try {
      const reset = await coach.resetData();
      if (reset) toast.success(t.resetDone);
      else toast.error(t.resetFailed);
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <CoachPage title={t.title} description={t.description}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={t.completion}
          value={`${completionRate}%`}
          detail={`${coach.metrics.completedProblems} ${t.of} ${coach.metrics.attemptedProblems} ${t.attempted}`}
          icon={<BookOpenCheck className="size-5" />}
          accent="success"
        />
        <Metric
          label={t.hintUsage}
          value={`${hintUsageRate}%`}
          detail={`${coach.metrics.hintedProblems} / ${coach.metrics.attemptedProblems} ${t.runs}`}
          icon={<CircleHelp className="size-5" />}
          accent="amber"
        />
        <Metric
          label={t.correction}
          value={`${correctionRate}%`}
          detail={`${coach.metrics.correctedProblems} ${t.correctedDetail}`}
          icon={<CheckCircle2 className="size-5" />}
          accent="success"
        />
        <Metric
          label={t.streak}
          value={`${streak} ${t.days}`}
          detail={`${Math.min(weeklyCompletedCount, weeklyGoal)} / ${weeklyGoal} ${t.weeklyGoal}`}
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
          {topicMastery.map(({ topic, value, completedCount, totalCount }) => (
            <div key={topic}>
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {TOPIC_LABELS[topic][locale]}
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
                  {completedCount} / {totalCount}
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
              disabled={isResetting}
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
