'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Code2,
  LoaderCircle,
  LockKeyhole,
  Play,
  RotateCcw,
  Target,
  XCircle,
} from 'lucide-react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Progress } from '@/shared/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/lib/utils';

import { getProblemBySlug, problems } from '../data/problems';
import { runCode } from '../runner';
import { useCoachStore } from '../store';
import type { CodeRunResult, Language, Problem, ProblemTopic } from '../types';
import {
  CoachPage,
  InlineNotice,
  Metric,
  Panel,
  PanelHeading,
} from './coach-ui';
import { CodeEditor } from './code-editor';
import {
  getPreferredLanguage,
  getTestResults,
  localeKey,
  localizedProblem,
  runDuration,
  runPassed,
} from './domain-adapter';

const DURATION_SECONDS = 20 * 60;

const copy = {
  zh: {
    title: '算法能力测评',
    description:
      '20 分钟完成 2 道固定题，了解当前解题稳定性与需要补强的知识点。',
    beforeTitle: '准备好后再开始计时',
    beforeDescription:
      '测评期间可运行样例，但 AI 提示、错因诊断和自由追问将暂时关闭。',
    duration: '20 分钟',
    count: '2 道题',
    languages: 'JavaScript / Python',
    start: '开始测评',
    starting: '正在创建测评…',
    startFailed: '暂时无法创建安全测评，请稍后重试。',
    rules: '测评规则',
    rule1: '两道题可自由切换，代码会自动保留。',
    rule2: '运行样例不计分，最终提交会运行完整测试。',
    rule3: '倒计时结束时自动提交当前代码。',
    aiDisabled: '为保证结果可比较，测评中 AI 教练已关闭。',
    problem: '题目',
    run: '运行样例',
    running: '运行中…',
    finish: '提交测评',
    submitting: '提交中…',
    reset: '重置当前代码',
    example: '样例',
    input: '输入',
    expected: '期望',
    result: '样例结果',
    noRun: '尚未运行当前题',
    passed: '通过',
    failed: '未通过',
    completeTitle: '测评完成',
    completeDescription: '结果已记录到学习进度，并据此生成下一步练习建议。',
    score: '正确率',
    efficiency: '平均耗时',
    weak: '建议补强',
    next: '下一步建议',
    nextGood: '基础稳定，下一轮可提高题目难度并限制单题时间。',
    nextWeak: '先复习未通过题目的核心模式，再完成 2 道同类练习。',
    review: '查看复习计划',
    retry: '重新测评',
    minutes: '分钟',
    javascript: 'JavaScript',
    python: 'Python',
  },
  en: {
    title: 'Algorithm Assessment',
    description:
      'Solve two fixed problems in 20 minutes to measure consistency and identify topics to strengthen.',
    beforeTitle: 'Start when you are ready for the timer',
    beforeDescription:
      'You can run examples, but hints, diagnosis, and AI chat are disabled during the assessment.',
    duration: '20 minutes',
    count: '2 problems',
    languages: 'JavaScript / Python',
    start: 'Start assessment',
    starting: 'Creating assessment…',
    startFailed: 'A secure assessment could not be created. Please try again.',
    rules: 'Assessment rules',
    rule1: 'Switch freely between both problems. Code is kept automatically.',
    rule2:
      'Example runs are unscored. Final submission runs the complete tests.',
    rule3: 'Your current code is submitted when the timer reaches zero.',
    aiDisabled:
      'AI coaching is disabled during the assessment so results remain comparable.',
    problem: 'Problem',
    run: 'Run examples',
    running: 'Running…',
    finish: 'Submit assessment',
    submitting: 'Submitting…',
    reset: 'Reset current code',
    example: 'Example',
    input: 'Input',
    expected: 'Expected',
    result: 'Example result',
    noRun: 'This problem has not been run yet',
    passed: 'Passed',
    failed: 'Failed',
    completeTitle: 'Assessment complete',
    completeDescription:
      'The result is saved to progress and used to generate your next practice focus.',
    score: 'Accuracy',
    efficiency: 'Average time',
    weak: 'Focus topics',
    next: 'Next step',
    nextGood:
      'Your foundation is stable. Raise the difficulty and add a tighter per-problem limit next time.',
    nextWeak:
      'Review the core pattern behind each failed problem, then solve two similar problems.',
    review: 'View review plan',
    retry: 'Retake assessment',
    minutes: 'min',
    javascript: 'JavaScript',
    python: 'Python',
  },
} as const;

export function AssessmentPage() {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const coach = useCoachStore();
  const defaultAssessmentProblems = useMemo(
    () =>
      [
        getProblemBySlug('minimum-processing-rate') ?? problems[0],
        getProblemBySlug('dependency-cycle') ?? problems[1],
      ].filter(Boolean) as Problem[],
    []
  );
  const [assessmentProblems, setAssessmentProblems] = useState<Problem[]>(
    defaultAssessmentProblems
  );
  const [phase, setPhase] = useState<'intro' | 'active' | 'complete'>('intro');
  const [secondsLeft, setSecondsLeft] = useState(DURATION_SECONDS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [language, setLanguage] = useState<Language>(
    getPreferredLanguage(coach.state)
  );
  const [codes, setCodes] = useState<Record<string, Record<Language, string>>>(
    () =>
      Object.fromEntries(
        assessmentProblems.map((problem) => [
          problem.id,
          {
            javascript: problem.templates.javascript,
            python: problem.templates.python,
          },
        ])
      )
  );
  const [sampleResults, setSampleResults] = useState<
    Record<string, CodeRunResult>
  >({});
  const [finalResults, setFinalResults] = useState<
    Record<string, CodeRunResult>
  >({});
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [assessmentToken, setAssessmentToken] = useState('');

  const currentProblem = assessmentProblems[activeIndex];
  const currentText = currentProblem
    ? localizedProblem(currentProblem, locale)
    : null;
  const currentCode = currentProblem
    ? (codes[currentProblem.id]?.[language] ?? '')
    : '';

  useEffect(() => {
    if (phase !== 'active') return;
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === 'active' && secondsLeft === 0 && !submitting) {
      void submitAssessment();
    }
    // submitAssessment intentionally uses the latest code snapshot when the timer expires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, phase]);

  async function startAssessment() {
    if (starting) return;
    setStarting(true);
    try {
      const response = await fetch('/api/assessment/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (!response.ok) throw new Error(t.startFailed);
      const payload = (await response.json()) as {
        data?: {
          token: string;
          problemSlugs: string[];
          durationMinutes: number;
          startedAt: string;
        };
      };
      const data = payload.data;
      const selected = data?.problemSlugs
        .map((slug) => getProblemBySlug(slug))
        .filter(Boolean) as Problem[] | undefined;
      if (!data?.token || selected?.length !== 2)
        throw new Error(t.startFailed);

      setAssessmentProblems(selected);
      setCodes(
        Object.fromEntries(
          selected.map((problem) => [
            problem.id,
            {
              javascript: problem.templates.javascript,
              python: problem.templates.python,
            },
          ])
        )
      );
      setAssessmentToken(data.token);
      setSecondsLeft(data.durationMinutes * 60);
      setStartedAt(Date.parse(data.startedAt));
      setActiveIndex(0);
      setPhase('active');
      coach.startAssessment(data.problemSlugs, data.durationMinutes);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        setAssessmentProblems(defaultAssessmentProblems);
        setAssessmentToken('');
        setSecondsLeft(DURATION_SECONDS);
        setStartedAt(Date.now());
        setPhase('active');
        coach.startAssessment(
          defaultAssessmentProblems.map((problem) => problem.slug),
          20
        );
      } else {
        toast.error(error instanceof Error ? error.message : t.startFailed);
      }
    } finally {
      setStarting(false);
    }
  }

  function updateCode(value: string) {
    if (!currentProblem) return;
    setCodes((current) => ({
      ...current,
      [currentProblem.id]: {
        ...current[currentProblem.id],
        [language]: value,
      },
    }));
  }

  async function runSample() {
    if (!currentProblem || running) return;
    setRunning(true);
    try {
      const result = await runCode({
        problem: currentProblem,
        language,
        code: currentCode,
        scope: 'sample',
      });
      setSampleResults((current) => ({
        ...current,
        [currentProblem.id]: result,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.failed);
    } finally {
      setRunning(false);
    }
  }

  async function submitAssessment() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const entries = await Promise.all(
        assessmentProblems.map(async (problem) => {
          try {
            const result = await runCode({
              problem,
              language,
              code:
                codes[problem.id]?.[language] ?? problem.templates[language],
              scope: 'all',
            });
            return [problem.id, result] as const;
          } catch (error) {
            return [
              problem.id,
              {
                passed: false,
                tests: [],
                durationMs: 0,
                error: error instanceof Error ? error.message : t.failed,
              } as unknown as CodeRunResult,
            ] as const;
          }
        })
      );
      const results = Object.fromEntries(entries) as Record<
        string,
        CodeRunResult
      >;
      setFinalResults(results);
      const passedCount = Object.values(results).filter(runPassed).length;
      const elapsedSeconds = startedAt
        ? Math.min(
            DURATION_SECONDS,
            Math.round((Date.now() - startedAt) / 1000)
          )
        : DURATION_SECONDS - secondsLeft;
      const summary = {
        id:
          coach.state.activeAssessment?.id ??
          `assessment_${crypto.randomUUID()}`,
        score: Math.round(
          (passedCount / Math.max(assessmentProblems.length, 1)) * 100
        ),
        correctCount: passedCount,
        passedCount,
        total: assessmentProblems.length,
        totalCount: assessmentProblems.length,
        durationSeconds: elapsedSeconds,
        problemIds: assessmentProblems.map((problem) => problem.id),
        problemSlugs: assessmentProblems.map((problem) => problem.slug),
        startedAt: startedAt
          ? new Date(startedAt).toISOString()
          : new Date(Date.now() - elapsedSeconds * 1000).toISOString(),
        weakTopics: Array.from(
          new Set(
            assessmentProblems
              .filter((problem) => !runPassed(results[problem.id]))
              .flatMap((problem) => problem.topics)
          )
        ) as ProblemTopic[],
        recommendation:
          passedCount === assessmentProblems.length ? t.nextGood : t.nextWeak,
        results,
        completedAt: new Date().toISOString(),
      };
      let verifiedSummary = summary;
      if (assessmentToken) {
        const response = await fetch('/api/assessment/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'complete',
            token: assessmentToken,
            runs: assessmentProblems.map((problem) => ({
              problemSlug: problem.slug,
              passed: runPassed(results[problem.id]),
              durationMs: runDuration(results[problem.id]),
            })),
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(payload?.message || t.startFailed);
        }
        const payload = (await response.json()) as {
          data: typeof summary & { verificationToken: string; version: string };
        };
        verifiedSummary = { ...summary, ...payload.data };
      }
      coach.completeAssessment(verifiedSummary);
      setPhase('complete');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.failed);
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'intro') {
    return (
      <CoachPage title={t.title} description={t.description}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel>
            <div className="p-6 md:p-8">
              <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-lg">
                <BrainCircuit className="size-6" />
              </span>
              <h2 className="mt-6 text-xl font-semibold">{t.beforeTitle}</h2>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                {t.beforeDescription}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <IntroFact icon={<Clock3 />} value={t.duration} />
                <IntroFact icon={<Target />} value={t.count} />
                <IntroFact icon={<Code2 />} value={t.languages} />
              </div>
              <Button
                size="lg"
                className="mt-8"
                disabled={!coach.hydrated || starting}
                onClick={() => void startAssessment()}
              >
                {starting ? <LoaderCircle className="animate-spin" /> : null}
                {starting ? t.starting : t.start}
                {!starting ? <ArrowRight /> : null}
              </Button>
            </div>
          </Panel>
          <Panel>
            <PanelHeading
              icon={<LockKeyhole className="size-4" />}
              title={t.rules}
            />
            <ol className="text-muted-foreground space-y-4 p-5 text-sm leading-6">
              {[t.rule1, t.rule2, t.rule3].map((rule, index) => (
                <li key={rule} className="flex gap-3">
                  <span className="text-foreground flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span>{rule}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </CoachPage>
    );
  }

  if (phase === 'complete') {
    const passedCount = Object.values(finalResults).filter(runPassed).length;
    const score = Math.round(
      (passedCount / Math.max(assessmentProblems.length, 1)) * 100
    );
    const failedProblems = assessmentProblems.filter(
      (problem) => !runPassed(finalResults[problem.id])
    );
    const weakTopics = Array.from(
      new Set(failedProblems.flatMap((problem) => problem.topics))
    );
    const elapsedMinutes = Math.max(
      1,
      Math.round((DURATION_SECONDS - secondsLeft) / 60)
    );

    return (
      <CoachPage title={t.completeTitle} description={t.completeDescription}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric
            label={t.score}
            value={`${score}%`}
            icon={<Target className="size-5" />}
            accent={score === 100 ? 'success' : 'amber'}
          />
          <Metric
            label={t.efficiency}
            value={`${elapsedMinutes} ${t.minutes}`}
            icon={<AlarmClock className="size-5" />}
          />
          <Metric
            label={t.weak}
            value={weakTopics.slice(0, 2).join(' / ') || '—'}
            icon={<BrainCircuit className="size-5" />}
            accent={weakTopics.length ? 'danger' : 'success'}
          />
        </div>
        <Panel className="mt-6">
          <PanelHeading
            title={t.next}
            icon={<ArrowRight className="size-4" />}
          />
          <div className="p-5">
            <p className="text-muted-foreground text-sm leading-7">
              {score === 100 ? t.nextGood : t.nextWeak}
            </p>
            {weakTopics.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {weakTopics.map((topic) => (
                  <Badge key={topic} variant="secondary" className="rounded-md">
                    {topic}
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/review">
                  {t.review}
                  <ArrowRight />
                </Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPhase('intro');
                  setSecondsLeft(DURATION_SECONDS);
                  setSampleResults({});
                  setFinalResults({});
                  setAssessmentToken('');
                }}
              >
                <RotateCcw />
                {t.retry}
              </Button>
            </div>
          </div>
        </Panel>
      </CoachPage>
    );
  }

  const progressValue =
    ((DURATION_SECONDS - secondsLeft) / DURATION_SECONDS) * 100;
  const sampleResult = currentProblem
    ? sampleResults[currentProblem.id]
    : undefined;
  const examples = currentProblem?.examples ?? [];

  return (
    <div className="mx-auto max-w-[1500px] p-3 md:p-5">
      <div className="bg-card mb-3 rounded-lg border">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-lg font-semibold tabular-nums">
            <AlarmClock
              className={cn('size-5', secondsLeft < 180 && 'text-red-600')}
            />
            {formatTime(secondsLeft)}
          </div>
          <Progress
            value={progressValue}
            className="order-3 h-1.5 w-full md:order-none md:w-48"
          />
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={language}
              onValueChange={(value) => setLanguage(value as Language)}
            >
              <SelectTrigger size="sm" className="w-32 rounded-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="javascript">{t.javascript}</SelectItem>
                <SelectItem value="python">{t.python}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={submitAssessment} disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CheckCircle2 />
              )}
              {submitting ? t.submitting : t.finish}
            </Button>
          </div>
        </div>
      </div>

      <InlineNotice>{t.aiDisabled}</InlineNotice>

      <div className="mt-3 grid gap-3 lg:h-[calc(100svh-13rem)] lg:min-h-[650px] lg:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <Panel className="overflow-hidden">
            {assessmentProblems.map((problem, index) => {
              const text = localizedProblem(problem, locale);
              const result = sampleResults[problem.id];
              return (
                <button
                  key={problem.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    'hover:bg-muted/50 flex w-full items-center gap-3 border-b p-4 text-left last:border-b-0',
                    activeIndex === index && 'bg-primary/5'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold',
                      activeIndex === index &&
                        'border-primary bg-primary text-primary-foreground'
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground block text-xs">
                      {t.problem} {index + 1}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-medium">
                      {text.titleText}
                    </span>
                  </span>
                  {result ? (
                    runPassed(result) ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <XCircle className="size-4 text-red-600" />
                    )
                  ) : null}
                </button>
              );
            })}
          </Panel>
          {currentText ? (
            <Panel className="max-h-[calc(100svh-29rem)] min-h-56 overflow-y-auto p-4">
              <h2 className="font-semibold">{currentText.titleText}</h2>
              <p className="text-muted-foreground mt-3 text-sm leading-6 whitespace-pre-wrap">
                {currentText.descriptionText}
              </p>
              {examples.slice(0, 1).map((example, index) => (
                <div
                  key={example.id ?? index}
                  className="bg-muted/35 mt-4 rounded-md border p-3 font-mono text-xs leading-5"
                >
                  <p>
                    <span className="text-muted-foreground">{t.input}: </span>
                    {formatValue(example.input)}
                  </p>
                  <p className="mt-1">
                    <span className="text-muted-foreground">
                      {t.expected}:{' '}
                    </span>
                    {formatValue(example.expected ?? example.output)}
                  </p>
                </div>
              ))}
            </Panel>
          ) : null}
        </aside>

        <Panel className="grid min-h-[620px] grid-rows-[auto_minmax(360px,1fr)_180px] overflow-hidden lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <span className="text-muted-foreground text-xs font-medium">
              {t.problem} {activeIndex + 1} / {assessmentProblems.length}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                title={t.reset}
                aria-label={t.reset}
                onClick={() => {
                  if (currentProblem)
                    updateCode(currentProblem.templates[language]);
                }}
              >
                <RotateCcw />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={runSample}
                disabled={running}
              >
                {running ? <LoaderCircle className="animate-spin" /> : <Play />}
                {running ? t.running : t.run}
              </Button>
            </div>
          </div>
          <CodeEditor
            value={currentCode}
            onChange={updateCode}
            language={language}
          />
          <div className="bg-muted/20 overflow-y-auto border-t p-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Code2 className="size-4" />
              {t.result}
              {sampleResult ? (
                <Badge
                  variant="outline"
                  className={cn(
                    'ml-auto rounded-md',
                    runPassed(sampleResult)
                      ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'border-red-500/30 text-red-700 dark:text-red-300'
                  )}
                >
                  {runPassed(sampleResult) ? t.passed : t.failed}
                </Badge>
              ) : null}
            </div>
            {!sampleResult ? (
              <p className="text-muted-foreground mt-5 text-center text-xs">
                {t.noRun}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-muted-foreground text-xs">
                  {
                    getTestResults(sampleResult).filter((test) => test.passed)
                      .length
                  }
                  /{getTestResults(sampleResult).length} {t.passed} ·{' '}
                  {runDuration(sampleResult)} ms
                </p>
                {getTestResults(sampleResult).map((test, index) => (
                  <div
                    key={test.testId ?? index}
                    className="bg-background flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
                  >
                    {test.passed ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <XCircle className="size-4 text-red-600" />
                    )}
                    {t.example} {index + 1}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function IntroFact({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="bg-muted/30 flex items-center gap-3 rounded-lg border p-3 text-sm font-medium">
      <span className="text-primary [&_svg]:size-4">{icon}</span>
      {value}
    </div>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatValue(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}
