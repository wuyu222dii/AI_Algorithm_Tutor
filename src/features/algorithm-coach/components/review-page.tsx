'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  Check,
  Eye,
  FileQuestion,
  Lightbulb,
  LoaderCircle,
  NotebookTabs,
  RotateCcw,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';

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
import { Textarea } from '@/shared/components/ui/textarea';
import { cn } from '@/shared/lib/utils';

import {
  calculateTopicMasterySnapshots,
  getReviewItemForProblem,
  getReviewItemKey,
  ReviewRating,
  TOPIC_LABELS,
} from '../learning-progress';
import { useCoachStore } from '../store';
import type {
  CoachResponse,
  CodeRunResult,
  LearningArtifact,
  ReviewGrade,
  ReviewGradeErrorCode,
} from '../types';
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
    recallPrompt: '先写下你的解题思路、复杂度或关键边界条件',
    recallPlaceholder: '例如：使用哈希表记录已访问值，时间复杂度 O(n)…',
    gradeRecall: '评分并查看答案',
    grading: '正在评分…',
    gradeFailed: '暂时无法评分，请稍后重试。',
    manualFallback:
      'AI 评分暂时不可用。你的回答已保留，可跳过评分后自行对照参考答案。',
    skipGrade: '跳过 AI 评分并查看答案',
    hits: '已命中',
    misses: '待补充',
    suggested: '建议自评',
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
    version: '版本',
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
    recallPrompt:
      'First write your approach, complexity, or important edge cases',
    recallPlaceholder:
      'For example: track seen values in a hash map for O(n) time…',
    gradeRecall: 'Grade recall and reveal',
    grading: 'Grading…',
    gradeFailed: 'Recall could not be graded. Try again shortly.',
    manualFallback:
      'AI grading is unavailable. Your response is saved, and you can continue with self-assessment.',
    skipGrade: 'Skip AI grading and reveal',
    hits: 'Covered',
    misses: 'Missing',
    suggested: 'Suggested rating',
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
    version: 'Version',
  },
} as const;

function reviewGradeErrorCode(
  code: string | undefined,
  status: number
): ReviewGradeErrorCode {
  const normalized = String(code ?? '').toLowerCase();
  if (normalized === 'ai_configuration_error') return 'configuration';
  if (normalized === 'provider_access_denied') return 'access_denied';
  if (normalized === 'provider_quota_exhausted') return 'quota';
  if (normalized === 'provider_rate_limited' || status === 429) {
    return 'rate_limited';
  }
  if (normalized === 'provider_timeout' || status === 504) return 'timeout';
  if (normalized === 'provider_invalid_output') return 'invalid_output';
  if (normalized === 'provider_unavailable' || status >= 500) {
    return 'unavailable';
  }
  return 'unknown';
}

class ReviewGradeRequestError extends Error {
  constructor(readonly safeCode: ReviewGradeErrorCode) {
    super('review grade failed');
  }
}

export function ReviewPage() {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const coach = useCoachStore();
  const problems = coach.problems;
  const [revealedCards, setRevealedCards] = useState<Set<string>>(
    () => new Set()
  );
  const [recallResponses, setRecallResponses] = useState<
    Record<string, string>
  >({});
  const [gradingCardId, setGradingCardId] = useState<string | null>(null);
  const runs = getRuns(coach.state);
  const artifacts = getArtifacts(coach.state);

  const failedByProblem = useMemo(() => {
    const map = new Map<string, CodeRunResult[]>();
    for (const run of runs) {
      if (runPassed(run)) continue;
      const slug = String(run.problemSlug);
      if (!slug) continue;
      const key = getReviewItemKey(slug, run.problemContentVersion);
      map.set(key, [...(map.get(key) ?? []), run]);
    }
    return map;
  }, [runs]);

  const wrongProblems = Object.values(coach.reviewItems)
    .filter((item) => item.status === 'due')
    .map((item) => ({
      item,
      problem: problems.find(
        (problem) =>
          (problem.id === item.problemSlug ||
            problem.slug === item.problemSlug) &&
          (problem.version?.contentVersion ?? 1) ===
            (item.problemContentVersion ?? 1)
      ),
    }));

  const masterySnapshots = useMemo(
    () =>
      calculateTopicMasterySnapshots(coach.state, coach.reviewItems, problems),
    [coach.reviewItems, coach.state, problems]
  );

  const topicStats = useMemo(() => {
    const counts = new Map<string, number>();
    wrongProblems.forEach(({ problem }) =>
      problem?.topics.forEach((topic) =>
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

  async function gradeRecall(
    cardArtifact: LearningArtifact,
    problemSlug: string,
    cardId: string
  ) {
    const reviewCard = cardArtifact.reviewCard;
    const responseText = recallResponses[cardId]?.trim();
    if (!reviewCard || !responseText || gradingCardId) return;
    const problem = problems.find(
      (item) => item.slug === problemSlug || item.id === problemSlug
    );
    const problemContentVersion =
      cardArtifact.problemContentVersion ??
      problem?.version?.contentVersion ??
      1;
    setGradingCardId(cardId);
    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review_grade',
          locale,
          problemSlug: problem?.slug ?? problemSlug,
          problemContentVersion,
          reviewResponse: responseText,
          reviewCard,
        }),
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as {
          error?: { code?: string } | string;
        } | null;
        const code =
          typeof errorPayload?.error === 'string'
            ? errorPayload.error
            : errorPayload?.error?.code;
        throw new ReviewGradeRequestError(
          reviewGradeErrorCode(code, response.status)
        );
      }
      const payload = (await response.json()) as CoachResponse;
      const gradePayload = payload.artifact.reviewGrade;
      if (!gradePayload) throw new Error('review grade missing');
      const conceptCount =
        gradePayload.hitConcepts.length + gradePayload.missedConcepts.length;
      const grade: ReviewGrade = {
        suggestedRating: gradePayload.suggestedRating,
        coverage: conceptCount
          ? gradePayload.hitConcepts.length / conceptCount
          : 0,
        matchedPoints: gradePayload.hitConcepts,
        missingPoints: gradePayload.missedConcepts,
        rationale: gradePayload.feedback,
        gradedAt: new Date().toISOString(),
      };
      const attemptId = `review_attempt_${crypto.randomUUID()}`;
      coach.addArtifact({
        ...payload.artifact,
        problemSlug: problem?.slug ?? problemSlug,
        problemContentVersion,
        generationMode: payload.mode,
        model: payload.model,
        promptVersion: payload.promptVersion,
        traceId: payload.traceId,
        latencyMs: payload.latencyMs,
      });
      coach.recordReviewAttempt({
        id: attemptId,
        problemSlug: problem?.slug ?? problemSlug,
        problemContentVersion,
        answer: responseText,
        submittedAt: new Date().toISOString(),
        grade,
        gradeMode: 'ai',
        gradedArtifactId: cardId,
      });
      setRevealedCards((current) => new Set(current).add(cardId));
    } catch (error) {
      coach.recordReviewAttempt({
        id: `review_attempt_${crypto.randomUUID()}`,
        problemSlug: problem?.slug ?? problemSlug,
        problemContentVersion,
        answer: responseText,
        submittedAt: new Date().toISOString(),
        gradeMode: 'manual_fallback',
        gradeErrorCode:
          error instanceof ReviewGradeRequestError ? error.safeCode : 'unknown',
        gradedArtifactId: cardId,
      });
      toast.error(t.gradeFailed);
    } finally {
      setGradingCardId(null);
    }
  }

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
                {wrongProblems.map(({ item, problem }) => {
                  const contentVersion = item.problemContentVersion ?? 1;
                  const text = problem
                    ? localizedProblem(problem, locale)
                    : {
                        titleText: `${item.problemSlug} · ${t.version} ${contentVersion}`,
                      };
                  const failedRuns =
                    failedByProblem.get(
                      getReviewItemKey(item.problemSlug, contentVersion)
                    ) ?? [];
                  const latest = failedRuns.at(-1);
                  const error = String(latest?.error ?? '');
                  return (
                    <article
                      key={getReviewItemKey(item.problemSlug, contentVersion)}
                      className="p-4 md:p-5"
                    >
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
                            {(problem?.topics ?? []).map((topic) => (
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
                              coach.markReviewMastered(
                                item.problemSlug,
                                contentVersion
                              )
                            }
                          >
                            <Check />
                            {t.mark}
                          </Button>
                          <Button asChild size="sm">
                            <Link
                              href={`/practice/${item.problemSlug}?version=${contentVersion}`}
                            >
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
                const contentVersion = artifact.problemContentVersion ?? 1;
                const problem = problems.find(
                  (item) =>
                    (item.id === problemId || item.slug === problemId) &&
                    (item.version?.contentVersion ?? 1) === contentVersion
                );
                const reviewItem = problem
                  ? getReviewItemForProblem(coach.reviewItems, problem)
                  : coach.reviewItems[
                      getReviewItemKey(problemId, contentVersion)
                    ];
                const title = problem
                  ? localizedProblem(problem, locale).titleText
                  : String(artifact.title ?? t.card);
                const structuredCard = artifact.reviewCard;
                const savedAttempt = [...coach.state.reviewAttempts]
                  .reverse()
                  .find(
                    (attempt) => attempt.gradedArtifactId === String(cardId)
                  );
                const grade = savedAttempt?.grade;
                const manualFallback =
                  savedAttempt?.gradeMode === 'manual_fallback' && !grade;
                const revealed =
                  !structuredCard ||
                  Boolean(grade) ||
                  Boolean(manualFallback && savedAttempt?.selectedRating) ||
                  revealedCards.has(String(cardId));
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
                      <div className="mt-4 space-y-3">
                        <p className="text-muted-foreground text-xs leading-5">
                          {t.recallPrompt}
                        </p>
                        <Textarea
                          value={
                            recallResponses[String(cardId)] ??
                            savedAttempt?.answer ??
                            ''
                          }
                          onChange={(event) =>
                            setRecallResponses((current) => ({
                              ...current,
                              [String(cardId)]: event.target.value,
                            }))
                          }
                          placeholder={t.recallPlaceholder}
                          maxLength={4000}
                          className="min-h-28 resize-y rounded-md"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            gradingCardId === String(cardId) ||
                            !(recallResponses[String(cardId)] ?? '').trim()
                          }
                          onClick={() =>
                            gradeRecall(
                              artifact,
                              problem?.slug ?? problemId,
                              String(cardId)
                            )
                          }
                        >
                          {gradingCardId === String(cardId) ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Eye />
                          )}
                          {gradingCardId === String(cardId)
                            ? t.grading
                            : t.gradeRecall}
                        </Button>
                        {manualFallback ? (
                          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                            <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">
                              {t.manualFallback}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() =>
                                setRevealedCards((current) =>
                                  new Set(current).add(String(cardId))
                                )
                              }
                            >
                              <Eye />
                              {t.skipGrade}
                            </Button>
                          </div>
                        ) : null}
                      </div>
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
                    {grade ? (
                      <div className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs leading-5">
                        <p className="font-medium">
                          {t.suggested}: {grade.suggestedRating}
                        </p>
                        {grade.matchedPoints.length ? (
                          <p className="mt-1 text-emerald-700 dark:text-emerald-300">
                            {t.hits}: {grade.matchedPoints.join('、')}
                          </p>
                        ) : null}
                        {grade.missingPoints.length ? (
                          <p className="mt-1 text-amber-700 dark:text-amber-300">
                            {t.misses}: {grade.missingPoints.join('、')}
                          </p>
                        ) : null}
                        {grade.rationale ? (
                          <p className="text-muted-foreground mt-1">
                            {grade.rationale}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {problemId && reviewItem && revealed ? (
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
                              variant={
                                grade?.suggestedRating === rating
                                  ? 'default'
                                  : 'outline'
                              }
                              className="min-w-0 px-1 text-xs"
                              onClick={() =>
                                coach.rateReview(problemId, rating, {
                                  attemptId: savedAttempt?.id,
                                  suggestedRating: grade?.suggestedRating,
                                  problemContentVersion: contentVersion,
                                })
                              }
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {problemId ? (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="mt-4 self-start"
                      >
                        <Link
                          href={`/practice/${problemId}?version=${contentVersion}`}
                        >
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
