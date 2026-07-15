'use client';

import { useId, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  RefreshCw,
  SkipForward,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import { Progress } from '@/shared/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';

import type { DailyLearningPlan, DailyPlanTask } from '../daily-plan';
import { TOPIC_LABELS } from '../learning-progress';
import type { CoachLocale, Problem } from '../types';
import { EmptyState, Panel, PanelHeading } from './coach-ui';

type PlanAction = 'skip' | 'swap';

export interface DailyPlanPanelProps {
  plan: DailyLearningPlan;
  problems: readonly Problem[];
  locale: CoachLocale;
  onSkip: (taskId: string, reason: string) => void | Promise<void>;
  onSwap: (taskId: string, reason: string) => void | Promise<void>;
  onOpen: (task: DailyPlanTask) => void;
  className?: string;
}

const copy = {
  zh: {
    title: '今日学习计划',
    description: '按优先级完成今日任务',
    budget: '预计 {used} / {budget} 分钟',
    minutes: '分钟',
    start: '开始练习',
    view: '查看任务',
    completed: '已完成',
    skipped: '已跳过',
    pending: '待完成',
    skip: '跳过',
    swap: '换题',
    cancel: '取消',
    confirmSkip: '确认跳过',
    confirmSwap: '确认换题',
    skipTitle: '为什么跳过这项任务？',
    skipDescription: '选择原因后，这项任务今天将不再计入预计用时。',
    swapTitle: '为什么想换一道题？',
    swapDescription: '选择原因后，我们会在同一任务类型中寻找替代题目。',
    customReason: '其他原因',
    customPlaceholder: '简要填写原因',
    reasonRequired: '请选择或填写一个明确原因。',
    actionFailed: '操作未完成，请重试。',
    skipReason: '跳过原因：{reason}',
    emptyTitle: '今天没有待安排任务',
    emptyDescription: '完成一次练习或测评后，新的计划会在这里出现。',
    kind: {
      'due-review': '到期复习',
      'weak-topic': '薄弱点练习',
      'new-topic': '新知识点',
    },
    reason: {
      'review-due': '复习已到期',
      'assessment-weak': '测评薄弱点',
      'weak-mastery': '掌握度待提升',
      'new-topic': '拓展新知识点',
    },
    difficulty: { easy: '简单', medium: '中等', hard: '困难' },
    skipReasons: ['今天时间不足', '需要先补充基础', '当前任务不适合'],
    swapReasons: ['想练不同知识点', '希望调整难度', '已经熟悉这道题'],
  },
  en: {
    title: "Today's learning plan",
    description: 'Complete tasks in priority order',
    budget: 'Estimated {used} / {budget} min',
    minutes: 'min',
    start: 'Start practice',
    view: 'View task',
    completed: 'Completed',
    skipped: 'Skipped',
    pending: 'Pending',
    skip: 'Skip',
    swap: 'Swap problem',
    cancel: 'Cancel',
    confirmSkip: 'Confirm skip',
    confirmSwap: 'Confirm swap',
    skipTitle: 'Why are you skipping this task?',
    skipDescription:
      'After you choose a reason, this task will no longer count toward today’s estimate.',
    swapTitle: 'Why would you like another problem?',
    swapDescription:
      'After you choose a reason, we will find an alternative in the same task category.',
    customReason: 'Other reason',
    customPlaceholder: 'Briefly describe the reason',
    reasonRequired: 'Choose or enter a clear reason.',
    actionFailed: 'The change could not be saved. Try again.',
    skipReason: 'Skip reason: {reason}',
    emptyTitle: 'Nothing is scheduled for today',
    emptyDescription:
      'A new plan will appear here after you complete a practice session or assessment.',
    kind: {
      'due-review': 'Due review',
      'weak-topic': 'Weak-topic practice',
      'new-topic': 'New topic',
    },
    reason: {
      'review-due': 'Review is due',
      'assessment-weak': 'Assessment weak point',
      'weak-mastery': 'Mastery needs work',
      'new-topic': 'Expand to a new topic',
    },
    difficulty: { easy: 'Easy', medium: 'Medium', hard: 'Hard' },
    skipReasons: [
      'Not enough time today',
      'Need to review prerequisites',
      'This task is not suitable now',
    ],
    swapReasons: [
      'Practice a different topic',
      'Adjust the difficulty',
      'Already comfortable with this problem',
    ],
  },
} as const;

function taskProblem(
  task: DailyPlanTask,
  problems: readonly Problem[]
): Problem | undefined {
  return (
    problems.find(
      (problem) =>
        (problem.slug === task.problemSlug || problem.id === task.problemId) &&
        (problem.version?.contentVersion ?? 1) === task.problemContentVersion
    ) ??
    problems.find(
      (problem) =>
        problem.slug === task.problemSlug || problem.id === task.problemId
    )
  );
}

function statusLabel(
  task: DailyPlanTask,
  t: (typeof copy)[CoachLocale]
): string {
  if (task.status === 'completed') return t.completed;
  if (task.status === 'skipped') return t.skipped;
  return t.pending;
}

function statusBadgeClass(task: DailyPlanTask): string {
  if (task.status === 'completed') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (task.status === 'skipped') return 'text-muted-foreground bg-muted/60';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

export function DailyPlanPanel({
  plan,
  problems,
  locale,
  onSkip,
  onSwap,
  onOpen,
  className,
}: DailyPlanPanelProps) {
  const t = copy[locale];
  const reasonGroupId = useId();
  const visibleTasks = plan.tasks.slice(0, 3);
  const [action, setAction] = useState<{
    type: PlanAction;
    task: DailyPlanTask;
  } | null>(null);
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reasonOptions = action
    ? action.type === 'skip'
      ? t.skipReasons
      : t.swapReasons
    : [];
  const selectedIndex = selectedReason === '' ? -1 : Number(selectedReason);
  const resolvedReason =
    selectedReason === 'other'
      ? customReason.trim()
      : Number.isInteger(selectedIndex) && selectedIndex >= 0
        ? (reasonOptions[selectedIndex] ?? '')
        : '';

  function openAction(type: PlanAction, task: DailyPlanTask) {
    setAction({ type, task });
    setSelectedReason('');
    setCustomReason('');
    setError('');
  }

  function closeAction() {
    if (submitting) return;
    setAction(null);
    setSelectedReason('');
    setCustomReason('');
    setError('');
  }

  async function confirmAction() {
    if (!action || !resolvedReason) {
      setError(t.reasonRequired);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (action.type === 'skip') {
        await onSkip(action.task.id, resolvedReason);
      } else {
        await onSwap(action.task.id, resolvedReason);
      }
      setAction(null);
      setSelectedReason('');
      setCustomReason('');
    } catch {
      setError(t.actionFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const budgetProgress = plan.budgetMinutes
    ? Math.min(100, (plan.estimatedMinutes / plan.budgetMinutes) * 100)
    : 0;

  return (
    <>
      <Panel className={cn('overflow-hidden', className)}>
        <PanelHeading
          icon={<CalendarDays className="size-4" />}
          title={t.title}
          description={t.description}
          action={
            <div className="min-w-28 text-right">
              <p className="text-xs font-medium tabular-nums">
                {t.budget
                  .replace('{used}', String(plan.estimatedMinutes))
                  .replace('{budget}', String(plan.budgetMinutes))}
              </p>
              <Progress
                value={budgetProgress}
                className="mt-2 h-1.5"
                aria-valuenow={budgetProgress}
                aria-label={t.budget
                  .replace('{used}', String(plan.estimatedMinutes))
                  .replace('{budget}', String(plan.budgetMinutes))}
              />
            </div>
          }
        />

        {visibleTasks.length ? (
          <div className="divide-y">
            {visibleTasks.map((task, index) => {
              const problem = taskProblem(task, problems);
              const title = problem?.title[locale] ?? task.problemSlug;
              const description = problem?.description[locale];
              const canChange = task.status === 'pending';
              return (
                <div
                  key={task.id}
                  data-testid={`daily-plan-task-${task.id}`}
                  className={cn(
                    'flex min-w-0 flex-col gap-4 px-4 py-4 md:px-5',
                    task.status === 'skipped' && 'bg-muted/25'
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums',
                        task.status === 'completed' &&
                          'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                        task.status === 'skipped' &&
                          'bg-muted text-muted-foreground'
                      )}
                    >
                      {task.status === 'completed' ? (
                        <Check className="size-4" />
                      ) : (
                        index + 1
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 text-sm leading-5 font-semibold break-words">
                          {title}
                        </h3>
                        <Badge
                          variant="outline"
                          className={cn(
                            'rounded-md text-[11px]',
                            statusBadgeClass(task)
                          )}
                        >
                          {statusLabel(task, t)}
                        </Badge>
                      </div>
                      {description ? (
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5 md:text-sm">
                          {description}
                        </p>
                      ) : null}
                      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span>{t.kind[task.kind]}</span>
                        <span>{t.reason[task.reason]}</span>
                        <span>{TOPIC_LABELS[task.primaryTopic][locale]}</span>
                        <span>{t.difficulty[task.difficulty]}</span>
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Clock3 className="size-3.5" />
                          {task.estimatedMinutes} {t.minutes}
                        </span>
                      </div>
                      {task.status === 'skipped' && task.skipReason ? (
                        <p className="text-muted-foreground mt-2 text-xs leading-5">
                          {t.skipReason.replace('{reason}', task.skipReason)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center justify-end gap-2 pl-11">
                    {canChange ? (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`${t.swap}：${title}`}
                              onClick={() => openAction('swap', task)}
                            >
                              <RefreshCw />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t.swap}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`${t.skip}：${title}`}
                              onClick={() => openAction('skip', task)}
                            >
                              <SkipForward />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t.skip}</TooltipContent>
                        </Tooltip>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        task.status === 'pending' ? 'default' : 'outline'
                      }
                      className="min-w-0 flex-1 sm:flex-none"
                      aria-label={`${task.status === 'pending' ? t.start : t.view}：${title}`}
                      onClick={() => onOpen(task)}
                    >
                      {task.status === 'pending' ? t.start : t.view}
                      <ArrowRight />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title={t.emptyTitle} description={t.emptyDescription} />
        )}
      </Panel>

      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => !open && closeAction()}
      >
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto rounded-lg sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle>
              {action?.type === 'skip' ? t.skipTitle : t.swapTitle}
            </DialogTitle>
            <DialogDescription>
              {action?.type === 'skip' ? t.skipDescription : t.swapDescription}
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={selectedReason}
            onValueChange={(value) => {
              setSelectedReason(value);
              setError('');
            }}
            className="grid gap-2"
          >
            {reasonOptions.map((reason, index) => (
              <Label
                key={reason}
                htmlFor={`${reasonGroupId}-reason-${index}`}
                className="has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <RadioGroupItem
                  id={`${reasonGroupId}-reason-${index}`}
                  value={String(index)}
                />
                <span className="min-w-0 break-words">{reason}</span>
              </Label>
            ))}
            <Label
              htmlFor={`${reasonGroupId}-reason-other`}
              className="has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <RadioGroupItem
                id={`${reasonGroupId}-reason-other`}
                value="other"
              />
              <span>{t.customReason}</span>
            </Label>
          </RadioGroup>

          {selectedReason === 'other' ? (
            <Textarea
              value={customReason}
              onChange={(event) => {
                setCustomReason(event.target.value);
                setError('');
              }}
              placeholder={t.customPlaceholder}
              maxLength={200}
              className="min-h-24 resize-none rounded-md"
              autoFocus
            />
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeAction}
              disabled={submitting}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              onClick={confirmAction}
              disabled={submitting || !resolvedReason}
            >
              {action?.type === 'skip' ? <SkipForward /> : <RefreshCw />}
              {action?.type === 'skip' ? t.confirmSkip : t.confirmSwap}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
