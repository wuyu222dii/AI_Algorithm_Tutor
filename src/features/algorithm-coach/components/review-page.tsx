'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  Check,
  Eye,
  FileQuestion,
  Lightbulb,
  NotebookTabs,
  RotateCcw,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { useLocale } from 'next-intl';

import { Link } from '@/core/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Progress } from '@/shared/components/ui/progress';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import { cn } from '@/shared/lib/utils';

import {
  calculateTopicMasterySnapshots,
  ReviewRating,
  TOPIC_LABELS,
} from '../learning-progress';
import { useCoachStore } from '../store';
import type { CodeRunResult } from '../types';
import { CoachPage, EmptyState, Panel, PanelHeading } from './coach-ui';
import {
  artifactText,
  getArtifacts,
  getRuns,
  localeKey,
  localizedProblem,
  runPassed,
} from './domain-adapter';

const copy = {
  zh: {
    title: '复习中心',
    description:
      '把失败记录、薄弱知识点和 AI 归纳集中到这里，优先复习最值得投入的内容。',
    wrong: '待纠正题目',
    cards: '复习卡片',
    topics: '薄弱知识点',
    overview: '复习概览',
    wrongTab: '错题',
    cardTab: '归纳卡',
    allTab: '全部',
    revisit: '重新练习',
    mark: '标记已掌握',
    mastered: '已掌握',
    reviewDue: '复习到期',
    rateAgain: '重来',
    rateHard: '较难',
    rateGood: '掌握',
    rateEasy: '简单',
    ratePrompt: '本次回忆效果',
    showAnswer: '显示答案',
    answer: '参考归纳',
    failures: '次未通过',
    latest: '最近错误',
    noWrong: '目前没有待复习的错题',
    noWrongDetail: '运行并提交题目后，未通过的记录会自动归入这里。',
    goProblems: '去题库练习',
    noCards: '还没有复习卡片',
    noCardsDetail: '完整通过一道题后，AI 教练会自动生成一张归纳卡。',
    card: 'AI 复习卡',
    demoCardTitle: '如何复习一道算法题',
    demoCardContent:
      '先复述核心不变量，再写出时间与空间复杂度，最后用一个边界输入验证实现。',
    practiceTopic: '练习同类题',
    mastery: '当前掌握度',
  },
  en: {
    title: 'Review Center',
    description:
      'Bring failed attempts, weak topics, and AI summaries together so you can review what matters most.',
    wrong: 'Problems to correct',
    cards: 'Review cards',
    topics: 'Weak topics',
    overview: 'Review overview',
    wrongTab: 'Mistakes',
    cardTab: 'Summary cards',
    allTab: 'All',
    revisit: 'Practice again',
    mark: 'Mark mastered',
    mastered: 'Mastered',
    reviewDue: 'Review due',
    rateAgain: 'Again',
    rateHard: 'Hard',
    rateGood: 'Good',
    rateEasy: 'Easy',
    ratePrompt: 'Recall quality',
    showAnswer: 'Show answer',
    answer: 'Reference summary',
    failures: 'failed runs',
    latest: 'Latest issue',
    noWrong: 'No problems need review yet',
    noWrongDetail:
      'Failed submissions will automatically appear here after you run and submit code.',
    goProblems: 'Browse problems',
    noCards: 'No review cards yet',
    noCardsDetail:
      'The AI coach creates a summary card after you fully pass a problem.',
    card: 'AI review card',
    demoCardTitle: 'How to review an algorithm problem',
    demoCardContent:
      'Restate the invariant, write down time and space complexity, then validate the implementation with one boundary input.',
    practiceTopic: 'Practice this topic',
    mastery: 'Current mastery',
  },
} as const;

export function ReviewPage() {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const coach = useCoachStore();
  const problems = coach.problems;
  const [revealedCards, setRevealedCards] = useState<Set<string>>(
    () => new Set()
  );
  const runs = getRuns(coach.state);
  const artifacts = getArtifacts(coach.state);

  const failedByProblem = useMemo(() => {
    const map = new Map<string, CodeRunResult[]>();
    for (const run of runs) {
      if (runPassed(run)) continue;
      const id = String(run.problemSlug);
      if (!id) continue;
      map.set(id, [...(map.get(id) ?? []), run]);
    }
    return map;
  }, [runs]);

  const dueProblemSlugs = new Set(
    Object.values(coach.reviewItems)
      .filter((item) => item.status === 'due')
      .map((item) => item.problemSlug)
  );
  const wrongProblems = problems.filter(
    (problem) =>
      dueProblemSlugs.has(problem.id) || dueProblemSlugs.has(problem.slug)
  );

  const masterySnapshots = useMemo(
    () =>
      calculateTopicMasterySnapshots(coach.state, coach.reviewItems, problems),
    [coach.reviewItems, coach.state, problems]
  );

  const topicStats = useMemo(() => {
    const counts = new Map<string, number>();
    wrongProblems.forEach((problem) =>
      problem.topics.forEach((topic) =>
        counts.set(topic, (counts.get(topic) ?? 0) + 1)
      )
    );
    return Object.entries(masterySnapshots)
      .filter(
        ([, snapshot]) => snapshot.evidenceCount > 0 && snapshot.value < 70
      )
      .map(([topic, snapshot]) => ({
        topic,
        count: counts.get(topic) ?? 0,
        value: snapshot.value,
      }))
      .sort(
        (left, right) => left.value - right.value || right.count - left.count
      );
  }, [masterySnapshots, wrongProblems]);

  const reviewCards = artifacts.filter((artifact) => {
    const type = String(artifact.type ?? '');
    return (
      type === 'review_card' || type === 'review-card' || type === 'review'
    );
  });

  return (
    <CoachPage title={t.title} description={t.description}>
      <div className="grid gap-4 sm:grid-cols-3">
        <ReviewMetric
          icon={<TriangleAlert />}
          label={t.wrong}
          value={String(wrongProblems.length)}
          tone="danger"
        />
        <ReviewMetric
          icon={<NotebookTabs />}
          label={t.cards}
          value={String(reviewCards.length)}
          tone="primary"
        />
        <ReviewMetric
          icon={<BrainCircuit />}
          label={t.topics}
          value={String(topicStats.length)}
          tone="amber"
        />
      </div>

      {topicStats.length ? (
        <Panel className="mt-6">
          <PanelHeading icon={<Target className="size-4" />} title={t.topics} />
          <div className="grid gap-4 p-4 sm:grid-cols-2 md:p-5 lg:grid-cols-3">
            {topicStats.slice(0, 6).map(({ topic, value }) => {
              return (
                <div key={topic}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">
                      {TOPIC_LABELS[topic as keyof typeof TOPIC_LABELS]?.[
                        locale
                      ] ?? topic}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {value}%
                    </span>
                  </div>
                  <Progress value={value} className="mt-2 h-1.5" />
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <Tabs defaultValue="wrong" className="mt-6">
        <TabsList className="h-10 rounded-lg">
          <TabsTrigger value="wrong" className="rounded-md">
            <RotateCcw />
            {t.wrongTab}
            <Badge variant="secondary" className="ml-1 rounded-md px-1.5 py-0">
              {wrongProblems.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="cards" className="rounded-md">
            <Sparkles />
            {t.cardTab}
            <Badge variant="secondary" className="ml-1 rounded-md px-1.5 py-0">
              {reviewCards.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="wrong" className="mt-4">
          <Panel>
            {wrongProblems.length ? (
              <div className="divide-y">
                {wrongProblems.map((problem) => {
                  const text = localizedProblem(problem, locale);
                  const failedRuns =
                    failedByProblem.get(problem.id) ??
                    failedByProblem.get(problem.slug) ??
                    [];
                  const latest = failedRuns.at(-1);
                  const error = String(latest?.error ?? '');
                  return (
                    <article key={problem.id} className="p-4 md:p-5">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-600 dark:text-red-300">
                          <FileQuestion className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-semibold">{text.titleText}</h2>
                            <Badge
                              variant="outline"
                              className="rounded-md border-red-500/30 text-red-700 dark:text-red-300"
                            >
                              {failedRuns.length
                                ? `${failedRuns.length} ${t.failures}`
                                : t.reviewDue}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {problem.topics.map((topic) => (
                              <Badge
                                key={topic}
                                variant="secondary"
                                className="rounded-md font-normal"
                              >
                                {TOPIC_LABELS[
                                  topic as keyof typeof TOPIC_LABELS
                                ]?.[locale] ?? topic}
                              </Badge>
                            ))}
                          </div>
                          {error ? (
                            <div className="bg-muted/35 mt-3 rounded-md border px-3 py-2 text-xs leading-5">
                              <span className="font-medium">{t.latest}: </span>
                              <span className="text-muted-foreground">
                                {error}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              coach.markReviewMastered(problem.slug)
                            }
                          >
                            <Check />
                            {t.mark}
                          </Button>
                          <Button asChild size="sm">
                            <Link href={`/practice/${problem.slug}`}>
                              {t.revisit}
                              <ArrowRight />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title={t.noWrong}
                description={t.noWrongDetail}
                action={
                  <Button asChild>
                    <Link href="/problems">{t.goProblems}</Link>
                  </Button>
                }
              />
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="cards" className="mt-4">
          {reviewCards.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {reviewCards.map((artifact, index) => {
                const cardId = artifact.id ?? `review-card-${index}`;
                const problemId = String(artifact.problemSlug ?? '');
                const problem = problems.find(
                  (item) => item.id === problemId || item.slug === problemId
                );
                const title = problem
                  ? localizedProblem(problem, locale).titleText
                  : String(artifact.title ?? t.card);
                const structuredCard = artifact.reviewCard;
                const revealed =
                  !structuredCard || revealedCards.has(String(cardId));
                return (
                  <article
                    key={cardId}
                    className="bg-card flex min-h-56 flex-col rounded-lg border p-5"
                  >
                    <div className="flex items-start gap-3">
                      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
                        <Lightbulb className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-primary text-xs font-medium">
                          {t.card}
                        </p>
                        <h2 className="mt-1 font-semibold">{title}</h2>
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-7 whitespace-pre-wrap">
                      {structuredCard?.front ?? artifactText(artifact, locale)}
                    </p>
                    {structuredCard && !revealed ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-4 self-start"
                        onClick={() =>
                          setRevealedCards((current) => {
                            const next = new Set(current);
                            next.add(String(cardId));
                            return next;
                          })
                        }
                      >
                        <Eye />
                        {t.showAnswer}
                      </Button>
                    ) : null}
                    {structuredCard && revealed ? (
                      <div className="bg-muted/40 mt-4 rounded-md border p-3">
                        <p className="text-muted-foreground text-xs font-medium">
                          {t.answer}
                        </p>
                        <p className="mt-2 text-sm leading-7 whitespace-pre-wrap">
                          {structuredCard.back}
                        </p>
                      </div>
                    ) : null}
                    {problem && coach.reviewItems[problem.slug] && revealed ? (
                      <div className="mt-4 border-t pt-4">
                        <p className="text-muted-foreground mb-2 text-xs">
                          {t.ratePrompt}
                        </p>
                        <div className="grid grid-cols-4 gap-1.5">
                          {(
                            [
                              ['again', t.rateAgain],
                              ['hard', t.rateHard],
                              ['good', t.rateGood],
                              ['easy', t.rateEasy],
                            ] as Array<[ReviewRating, string]>
                          ).map(([rating, label]) => (
                            <Button
                              key={rating}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="min-w-0 px-1 text-xs"
                              onClick={() =>
                                coach.rateReview(problem.slug, rating)
                              }
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {problem ? (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="mt-4 self-start"
                      >
                        <Link href={`/practice/${problem.slug}`}>
                          {t.revisit}
                          <ArrowRight />
                        </Link>
                      </Button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <Panel>
              <EmptyState
                title={t.noCards}
                description={t.noCardsDetail}
                action={
                  <Button asChild variant="outline">
                    <Link href="/problems">{t.goProblems}</Link>
                  </Button>
                }
              />
            </Panel>
          )}
        </TabsContent>
      </Tabs>
    </CoachPage>
  );
}

function ReviewMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'primary' | 'amber' | 'danger';
}) {
  return (
    <div className="bg-card flex items-center gap-4 rounded-lg border p-4">
      <span
        className={cn(
          'bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md [&_svg]:size-5',
          tone === 'amber' &&
            'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          tone === 'danger' && 'bg-red-500/10 text-red-700 dark:text-red-300'
        )}
      >
        {icon}
      </span>
      <div>
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
