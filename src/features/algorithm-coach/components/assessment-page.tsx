'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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

import {
  assessmentNowMs,
  assessmentSecondsUntil,
  calculateServerOffsetMs,
} from '../assessment-clock';
import {
  clearAssessmentDraft,
  loadAssessmentDraft,
  saveAssessmentDraft,
} from '../assessment-draft';
import {
  getProblemContentVersion,
  getProblemTemplate,
  LANGUAGE_REGISTRY,
  problemSupportsLanguage,
} from '../languages';
import { TOPIC_LABELS } from '../learning-progress';
import { runCode } from '../runner';
import { useCoachStore } from '../store';
import type {
  AssessmentDraftV1,
  AssessmentKind,
  CodeRunResult,
  DiagnosisCategory,
  Language,
  Problem,
  ProblemTopic,
  ProblemVersionRef,
} from '../types';
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
  getProfile,
  getTestResults,
  localeKey,
  localizedProblem,
  runDuration,
  runPassed,
} from './domain-adapter';

const DURATION_SECONDS = 20 * 60;
const BASELINE_DURATION_SECONDS = 8 * 60;
const currentTimeMs = () => Date.now();

function problemsForVersions(
  problems: readonly Problem[],
  versions: readonly ProblemVersionRef[]
): Problem[] {
  return versions
    .map((reference) =>
      problems.find(
        (problem) =>
          problem.slug === reference.slug &&
          getProblemContentVersion(problem) === reference.contentVersion
      )
    )
    .filter((problem): problem is Problem => Boolean(problem));
}

function createAssessmentCode(
  assessmentProblems: Problem[],
  languages: readonly Language[]
): Record<string, Partial<Record<Language, string>>> {
  return Object.fromEntries(
    assessmentProblems.map((problem) => [
      problem.id,
      Object.fromEntries(
        languages.map((language) => [
          language,
          getProblemTemplate(problem, language),
        ])
      ),
    ])
  );
}

function errorCategoryForRun(
  result: CodeRunResult | undefined
): DiagnosisCategory | undefined {
  if (!result || runPassed(result)) return undefined;
  if (result.status === 'syntax_error') return 'syntax';
  if (result.status === 'runtime_error') return 'runtime';
  if (result.status === 'timeout') return 'timeout';
  if (result.status === 'failed') return 'wrong-answer';
  return 'unknown';
}

const copy = {
  zh: {
    title: '算法能力测评',
    localMode: '本地自测',
    localModeNotice:
      '代码在浏览器隔离环境中执行，结果用于个人学习反馈，不作为正式能力认证。',
    description:
      '20 分钟完成 2 道固定题，了解当前解题稳定性与需要补强的知识点。',
    beforeTitle: '准备好后再开始计时',
    beforeDescription:
      '测评期间可运行样例，但 AI 提示、错因诊断和自由追问将暂时关闭。',
    duration: '20 分钟',
    count: '2 道题',
    languages: 'JavaScript / Python / TypeScript',
    start: '开始测评',
    starting: '正在创建测评…',
    startFailed: '暂时无法创建安全测评，请稍后重试。',
    restoreFailed: '上次测评无法安全恢复，请重新开始。',
    restoreUnavailable: '暂时无法连接恢复服务，测评草稿仍已保留。',
    retryRestore: '重试恢复',
    expired: '测评已超过提交宽限期，本次已标记为中断。',
    abandon: '放弃测评',
    rules: '测评规则',
    rule1: '两道题可自由切换，代码会自动保留。',
    rule2: '运行样例不计分，最终提交会运行浏览器内的本地完整测试。',
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
    language: '编程语言',
    javascript: 'JavaScript',
    python: 'Python',
    baselineTitle: '能力基线测评',
    baselineDescription:
      '用 8 分钟完成 2 道无 AI 题目，为每日计划建立初始能力基线。',
    checkpointTitle: '两周阶段复测',
    checkpointDescription:
      '完成与基线难度和知识点相近的新题，比较两周内的学习变化。',
    baselineDuration: '8 分钟',
    checkpointResult: '相对能力基线',
    scoreChange: '正确率变化',
    timeChange: '平均用时变化',
    hintChange: 'Hint 使用变化',
    errorChange: '错误类型变化',
    noErrors: '无错误',
    hintUses: '次',
    percentagePoints: '个百分点',
    seconds: '秒',
  },
  en: {
    title: 'Algorithm Assessment',
    localMode: 'Local self-assessment',
    localModeNotice:
      'Code runs in an isolated browser environment. Results are for personal learning feedback, not formal certification.',
    description:
      'Solve two fixed problems in 20 minutes to measure consistency and identify topics to strengthen.',
    beforeTitle: 'Start when you are ready for the timer',
    beforeDescription:
      'You can run examples, but hints, diagnosis, and AI chat are disabled during the assessment.',
    duration: '20 minutes',
    count: '2 problems',
    languages: 'JavaScript / Python / TypeScript',
    start: 'Start assessment',
    starting: 'Creating assessment…',
    startFailed: 'A secure assessment could not be created. Please try again.',
    restoreFailed: 'The previous assessment could not be restored safely.',
    restoreUnavailable:
      'The recovery service is unavailable. Your assessment draft is preserved.',
    retryRestore: 'Retry recovery',
    expired: 'The submission grace period ended. This attempt was abandoned.',
    abandon: 'Abandon assessment',
    rules: 'Assessment rules',
    rule1: 'Switch freely between both problems. Code is kept automatically.',
    rule2:
      'Example runs are unscored. Final submission runs the complete local tests in your browser.',
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
    language: 'Programming language',
    javascript: 'JavaScript',
    python: 'Python',
    baselineTitle: 'Baseline assessment',
    baselineDescription:
      'Solve two no-AI problems in 8 minutes to calibrate your first learning plan.',
    checkpointTitle: 'Two-week checkpoint',
    checkpointDescription:
      'Solve new problems with comparable topics and difficulty to measure progress.',
    baselineDuration: '8 minutes',
    checkpointResult: 'Compared with baseline',
    scoreChange: 'Accuracy change',
    timeChange: 'Average time change',
    hintChange: 'Hint usage change',
    errorChange: 'Error categories',
    noErrors: 'No errors',
    hintUses: 'uses',
    percentagePoints: 'pp',
    seconds: 'sec',
  },
} as const;

class AssessmentResumeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

export function AssessmentPage() {
  const locale = localeKey(useLocale());
  const searchParams = useSearchParams();
  const t = copy[locale];
  const coach = useCoachStore();
  const abandonAssessment = coach.abandonAssessment;
  const restoreCoachAssessment = coach.startAssessment;
  const coachHydrated = coach.hydrated;
  const activeAssessment = coach.state.activeAssessment;
  const assessmentStorageScope = coach.storageScope;
  const requestedKind = searchParams.get('kind');
  const requestedBaselineId = searchParams.get('baseline') ?? undefined;
  const baselineResult =
    coach.state.assessments.find(
      (assessment) => assessment.id === requestedBaselineId
    ) ??
    [...coach.state.assessments]
      .reverse()
      .find((assessment) => assessment.kind === 'baseline');
  const assessmentKind: AssessmentKind =
    requestedKind === 'checkpoint' && baselineResult
      ? 'checkpoint'
      : requestedKind === 'baseline' || requestedKind === 'checkpoint'
        ? 'baseline'
        : 'practice';
  const modeTitle =
    assessmentKind === 'baseline'
      ? t.baselineTitle
      : assessmentKind === 'checkpoint'
        ? t.checkpointTitle
        : t.title;
  const modeDescription =
    assessmentKind === 'baseline'
      ? t.baselineDescription
      : assessmentKind === 'checkpoint'
        ? t.checkpointDescription
        : t.description;
  const [assessmentProblems, setAssessmentProblems] = useState<Problem[]>([]);
  const [phase, setPhase] = useState<'intro' | 'active' | 'complete'>('intro');
  const [secondsLeft, setSecondsLeft] = useState(DURATION_SECONDS);
  const [durationSeconds, setDurationSeconds] = useState(
    assessmentKind === 'practice' ? DURATION_SECONDS : BASELINE_DURATION_SECONDS
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedLanguage, setLanguage] = useState<Language>(
    getPreferredLanguage(coach.state)
  );
  const availableLanguages = useMemo(
    () =>
      coach.enabledLanguages.filter((languageId) =>
        assessmentProblems.every((problem) =>
          problemSupportsLanguage(problem, languageId)
        )
      ),
    [assessmentProblems, coach.enabledLanguages]
  );
  const language = availableLanguages.some(
    (languageId) => languageId === selectedLanguage
  )
    ? selectedLanguage
    : (availableLanguages[0] ?? 'javascript');
  const [codes, setCodes] = useState<
    Record<string, Partial<Record<Language, string>>>
  >({});
  const latestCodesRef = useRef(codes);
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
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [graceExpiresAt, setGraceExpiresAt] = useState<number | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [restoring, setRestoring] = useState(true);
  const [restoreUnavailable, setRestoreUnavailable] = useState(false);
  const [restoreRetryVersion, setRestoreRetryVersion] = useState(0);
  const restoredScopeRef = useRef<string | null>(null);
  const latestDraftRef = useRef<AssessmentDraftV1 | null>(null);

  const currentProblem = assessmentProblems[activeIndex];
  const currentText = currentProblem
    ? localizedProblem(currentProblem, locale)
    : null;
  const currentCode = currentProblem
    ? (codes[currentProblem.id]?.[language] ?? '')
    : '';

  useEffect(() => {
    if (phase !== 'active' || !expiresAt) return;
    const tick = () => {
      setSecondsLeft(assessmentSecondsUntil(expiresAt, serverOffsetMs));
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [expiresAt, phase, serverOffsetMs]);

  useEffect(() => {
    const scope = assessmentStorageScope;
    if (!coachHydrated || !scope || restoredScopeRef.current === scope) return;
    restoredScopeRef.current = scope;
    const draft = loadAssessmentDraft(scope);
    const active = activeAssessment;

    if (!draft) {
      if (active) abandonAssessment(active.id);
      const timer = window.setTimeout(() => setRestoring(false), 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const requestStartedAtMs = currentTimeMs();
        const response = await fetch('/api/assessment/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'resume', token: draft.token }),
          signal: controller.signal,
        });
        const responseReceivedAtMs = currentTimeMs();
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new AssessmentResumeError(
            response.status,
            failure?.error ?? 'assessment_resume_rejected'
          );
        }
        const payload = (await response.json()) as {
          data?: {
            id: string;
            problemVersions: ProblemVersionRef[];
            problems: Problem[];
            startedAt: string;
            expiresAt: string;
            graceExpiresAt: string;
            serverNow: string;
            durationMinutes: number;
          };
        };
        const data = payload.data;
        const selected = data
          ? problemsForVersions(data.problems, data.problemVersions)
          : [];
        const refsMatch =
          data?.id === draft.assessmentId &&
          JSON.stringify(data.problemVersions) ===
            JSON.stringify(draft.problemVersions);
        if (!data || !refsMatch || selected.length !== 2) {
          throw new Error('assessment draft does not match signed session');
        }
        const nextServerOffsetMs = calculateServerOffsetMs(
          data.serverNow,
          requestStartedAtMs,
          responseReceivedAtMs
        );

        setAssessmentProblems(selected);
        latestCodesRef.current = draft.codes;
        setCodes(draft.codes);
        setSampleResults(draft.sampleResults);
        setAssessmentToken(draft.token);
        setStartedAt(Date.parse(data.startedAt));
        setExpiresAt(Date.parse(data.expiresAt));
        setGraceExpiresAt(Date.parse(data.graceExpiresAt));
        setServerOffsetMs(nextServerOffsetMs);
        setDurationSeconds(data.durationMinutes * 60);
        setSecondsLeft(
          assessmentSecondsUntil(
            data.expiresAt,
            nextServerOffsetMs,
            responseReceivedAtMs
          )
        );
        setLanguage(draft.language);
        setActiveIndex(Math.min(draft.activeIndex, selected.length - 1));
        if (!active || active.id !== data.id) {
          restoreCoachAssessment(
            data.problemVersions.map((reference) => reference.slug),
            data.durationMinutes,
            draft.kind,
            draft.baselineAssessmentId,
            {
              id: data.id,
              startedAt: data.startedAt,
              problemVersions: data.problemVersions,
            }
          );
        }
        setRestoreUnavailable(false);
        setPhase('active');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        const expired =
          assessmentNowMs(draft.serverOffsetMs) >
            Date.parse(draft.graceExpiresAt) ||
          (error instanceof AssessmentResumeError && error.status === 410);
        const rejected =
          error instanceof AssessmentResumeError &&
          [400, 410, 422].includes(error.status);
        if (expired || rejected) {
          clearAssessmentDraft(scope);
          abandonAssessment(active?.id);
          void fetch('/api/assessment/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'abandon', token: draft.token }),
            keepalive: true,
          }).catch(() => undefined);
          toast.error(expired ? t.expired : t.restoreFailed);
        } else {
          restoredScopeRef.current = null;
          setRestoreUnavailable(true);
          toast.error(t.restoreUnavailable);
        }
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    })();

    return () => controller.abort();
  }, [
    abandonAssessment,
    activeAssessment,
    assessmentStorageScope,
    coachHydrated,
    restoreCoachAssessment,
    restoreRetryVersion,
    t.expired,
    t.restoreFailed,
    t.restoreUnavailable,
  ]);

  useEffect(() => {
    const scope = coach.storageScope;
    const active = coach.state.activeAssessment;
    if (
      phase !== 'active' ||
      !scope ||
      !active ||
      !assessmentToken ||
      !startedAt ||
      !expiresAt ||
      !graceExpiresAt
    ) {
      latestDraftRef.current = null;
      return;
    }
    const draft: AssessmentDraftV1 = {
      version: 1,
      assessmentId: active.id,
      kind: active.kind ?? assessmentKind,
      baselineAssessmentId: active.baselineAssessmentId,
      token: assessmentToken,
      problemVersions: assessmentProblems.map((problem) => ({
        slug: problem.slug,
        contentVersion: getProblemContentVersion(problem),
      })),
      startedAt: new Date(startedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      graceExpiresAt: new Date(graceExpiresAt).toISOString(),
      serverOffsetMs,
      language,
      codes,
      activeIndex,
      sampleResults,
      updatedAt: new Date().toISOString(),
    };
    latestDraftRef.current = draft;
    saveAssessmentDraft(draft, scope);
  }, [
    activeIndex,
    assessmentKind,
    assessmentProblems,
    assessmentToken,
    coach.state.activeAssessment,
    coach.storageScope,
    codes,
    expiresAt,
    graceExpiresAt,
    language,
    phase,
    sampleResults,
    serverOffsetMs,
    startedAt,
  ]);

  useEffect(() => {
    const flush = () => {
      const scope = coach.storageScope;
      if (scope && latestDraftRef.current) {
        saveAssessmentDraft(latestDraftRef.current, scope);
      }
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('blur', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('blur', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [coach.storageScope]);

  async function startAssessment() {
    if (starting) return;
    setStarting(true);
    try {
      const requestStartedAtMs = currentTimeMs();
      const response = await fetch('/api/assessment/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          kind: assessmentKind,
          preferredLanguage: getPreferredLanguage(coach.state),
          goal: getProfile(coach.state)?.goal,
          baselineAssessmentId: baselineResult?.id,
          baselineProblemVersions: baselineResult?.problemVersions,
        }),
      });
      const responseReceivedAtMs = currentTimeMs();
      if (!response.ok) throw new Error(t.startFailed);
      const payload = (await response.json()) as {
        data?: {
          id: string;
          token: string;
          problemSlugs: string[];
          problemVersions: ProblemVersionRef[];
          problems: Problem[];
          durationMinutes: number;
          startedAt: string;
          expiresAt: string;
          graceExpiresAt: string;
          serverNow: string;
        };
      };
      const data = payload.data;
      const selected = data
        ? problemsForVersions(data.problems, data.problemVersions)
        : undefined;
      if (!data?.token || selected?.length !== 2)
        throw new Error(t.startFailed);
      const nextServerOffsetMs = calculateServerOffsetMs(
        data.serverNow,
        requestStartedAtMs,
        responseReceivedAtMs
      );

      setAssessmentProblems(selected);
      const initialCodes = createAssessmentCode(
        selected,
        coach.enabledLanguages
      );
      latestCodesRef.current = initialCodes;
      setCodes(initialCodes);
      setAssessmentToken(data.token);
      const nextDurationSeconds = data.durationMinutes * 60;
      setDurationSeconds(nextDurationSeconds);
      setSecondsLeft(
        assessmentSecondsUntil(
          data.expiresAt,
          nextServerOffsetMs,
          responseReceivedAtMs
        )
      );
      setStartedAt(Date.parse(data.startedAt));
      setExpiresAt(Date.parse(data.expiresAt));
      setGraceExpiresAt(Date.parse(data.graceExpiresAt));
      setServerOffsetMs(nextServerOffsetMs);
      setActiveIndex(0);
      setPhase('active');
      coach.startAssessment(
        data.problemSlugs,
        data.durationMinutes,
        assessmentKind,
        baselineResult?.id,
        {
          id: data.id,
          startedAt: data.startedAt,
          problemVersions: data.problemVersions,
        }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.startFailed);
    } finally {
      setStarting(false);
    }
  }

  function updateCode(value: string) {
    if (!currentProblem) return;
    const nextCodes = {
      ...latestCodesRef.current,
      [currentProblem.id]: {
        ...latestCodesRef.current[currentProblem.id],
        [language]: value,
      },
    };
    latestCodesRef.current = nextCodes;
    if (latestDraftRef.current) {
      latestDraftRef.current = {
        ...latestDraftRef.current,
        codes: nextCodes,
        updatedAt: new Date().toISOString(),
      };
    }
    setCodes(nextCodes);
  }

  async function runSample() {
    if (!currentProblem || running) return;
    setRunning(true);
    try {
      const result = await runCode({
        problem: currentProblem,
        language,
        enabledLanguages: coach.enabledLanguages,
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
              enabledLanguages: coach.enabledLanguages,
              code:
                codes[problem.id]?.[language] ??
                getProblemTemplate(problem, language),
              scope: 'all',
            });
            return [problem.id, result] as const;
          } catch (error) {
            return [
              problem.id,
              {
                status: 'runtime_error',
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
      const errorCategories = Array.from(
        new Set(
          Object.values(results)
            .map(errorCategoryForRun)
            .filter((category): category is DiagnosisCategory =>
              Boolean(category)
            )
        )
      );
      const elapsedSeconds = startedAt
        ? Math.min(
            durationSeconds,
            Math.round((assessmentNowMs(serverOffsetMs) - startedAt) / 1000)
          )
        : durationSeconds - secondsLeft;
      const summary = {
        id:
          coach.state.activeAssessment?.id ??
          `assessment_${crypto.randomUUID()}`,
        kind: assessmentKind,
        baselineAssessmentId:
          assessmentKind === 'checkpoint' ? baselineResult?.id : undefined,
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
        problemVersions: assessmentProblems.map((problem) => ({
          slug: problem.slug,
          contentVersion: getProblemContentVersion(problem),
        })),
        startedAt: startedAt
          ? new Date(startedAt).toISOString()
          : new Date(
              assessmentNowMs(serverOffsetMs) - elapsedSeconds * 1000
            ).toISOString(),
        weakTopics: Array.from(
          new Set(
            assessmentProblems
              .filter((problem) => !runPassed(results[problem.id]))
              .flatMap((problem) => problem.topics)
          )
        ) as ProblemTopic[],
        recommendation:
          passedCount === assessmentProblems.length ? t.nextGood : t.nextWeak,
        evidenceMode: 'browser_local' as const,
        results,
        completedAt: new Date().toISOString(),
      };
      const averageDurationMs = Math.round(
        Object.values(results).reduce(
          (total, result) => total + runDuration(result),
          0
        ) / Math.max(assessmentProblems.length, 1)
      );
      Object.assign(summary, {
        averageDurationMs,
        hintCount: 0,
        errorCategories,
        comparison:
          assessmentKind === 'checkpoint' && baselineResult
            ? {
                baselineAssessmentId: baselineResult.id,
                scoreDelta: summary.score - Number(baselineResult.score ?? 0),
                correctCountDelta:
                  summary.correctCount -
                  Number(baselineResult.correctCount ?? 0),
                averageDurationDeltaMs:
                  averageDurationMs -
                  Number(baselineResult.averageDurationMs ?? 0),
                hintCountDelta: 0 - Number(baselineResult.hintCount ?? 0),
                baselineErrorCategories: baselineResult.errorCategories ?? [],
                checkpointErrorCategories: errorCategories,
              }
            : undefined,
      });
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
              status: results[problem.id]?.status,
              errorCategory: errorCategoryForRun(results[problem.id]),
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
      if (coach.storageScope) clearAssessmentDraft(coach.storageScope);
      latestDraftRef.current = null;
      setPhase('complete');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.failed);
    } finally {
      setSubmitting(false);
    }
  }

  async function abandonCurrentAssessment(expired = false) {
    const assessmentId = coach.state.activeAssessment?.id;
    if (assessmentToken) {
      await fetch('/api/assessment/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'abandon', token: assessmentToken }),
        keepalive: true,
      }).catch(() => undefined);
    }
    if (coach.storageScope) clearAssessmentDraft(coach.storageScope);
    latestDraftRef.current = null;
    coach.abandonAssessment(assessmentId);
    setAssessmentToken('');
    setSampleResults({});
    setFinalResults({});
    setStartedAt(null);
    setExpiresAt(null);
    setGraceExpiresAt(null);
    setServerOffsetMs(0);
    setPhase('intro');
    if (expired) toast.error(t.expired);
  }

  useEffect(() => {
    if (phase !== 'active' || secondsLeft !== 0 || submitting) return;
    const timer = window.setTimeout(() => {
      if (graceExpiresAt && assessmentNowMs(serverOffsetMs) > graceExpiresAt) {
        void abandonCurrentAssessment(true);
      } else {
        void submitAssessment();
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // submitAssessment intentionally uses the latest code snapshot when the timer expires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, phase, graceExpiresAt, serverOffsetMs]);

  if (restoring) {
    return (
      <CoachPage title={modeTitle} description={modeDescription}>
        <div
          className="text-muted-foreground flex min-h-48 items-center justify-center"
          role="status"
        >
          <LoaderCircle className="size-5 animate-spin" />
        </div>
      </CoachPage>
    );
  }

  if (phase === 'intro') {
    return (
      <CoachPage title={modeTitle} description={modeDescription}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel>
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-3">
                <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-lg">
                  <BrainCircuit className="size-6" />
                </span>
                <Badge variant="outline" className="rounded-md">
                  {t.localMode}
                </Badge>
              </div>
              <h2 className="mt-6 text-xl font-semibold">{t.beforeTitle}</h2>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                {t.beforeDescription}
              </p>
              <p className="text-muted-foreground mt-3 max-w-2xl text-xs leading-5">
                {t.localModeNotice}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <IntroFact
                  icon={<Clock3 />}
                  value={
                    assessmentKind === 'practice'
                      ? t.duration
                      : t.baselineDuration
                  }
                />
                <IntroFact icon={<Target />} value={t.count} />
                <IntroFact icon={<Code2 />} value={t.languages} />
              </div>
              <Button
                size="lg"
                className="mt-8"
                disabled={!coach.hydrated || starting || restoreUnavailable}
                onClick={() => void startAssessment()}
              >
                {starting ? <LoaderCircle className="animate-spin" /> : null}
                {starting ? t.starting : t.start}
                {!starting ? <ArrowRight /> : null}
              </Button>
              {restoreUnavailable ? (
                <div className="mt-4 space-y-3">
                  <InlineNotice>{t.restoreUnavailable}</InlineNotice>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRestoreUnavailable(false);
                      setRestoring(true);
                      restoredScopeRef.current = null;
                      setRestoreRetryVersion((value) => value + 1);
                    }}
                  >
                    <RotateCcw />
                    {t.retryRestore}
                  </Button>
                </div>
              ) : null}
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
      Math.round((durationSeconds - secondsLeft) / 60)
    );
    const averageDurationMs = Math.round(
      Object.values(finalResults).reduce(
        (total, result) => total + runDuration(result),
        0
      ) / Math.max(assessmentProblems.length, 1)
    );
    const currentErrorCategories = Array.from(
      new Set(
        Object.values(finalResults)
          .map(errorCategoryForRun)
          .filter((category): category is DiagnosisCategory =>
            Boolean(category)
          )
      )
    );
    const checkpointComparison =
      assessmentKind === 'checkpoint' && baselineResult
        ? {
            scoreDelta: score - baselineResult.score,
            averageDurationDeltaMs:
              averageDurationMs - Number(baselineResult.averageDurationMs ?? 0),
            hintCountDelta: 0 - Number(baselineResult.hintCount ?? 0),
            baselineErrorCategories: baselineResult.errorCategories ?? [],
            checkpointErrorCategories: currentErrorCategories,
          }
        : null;

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
            value={
              weakTopics
                .slice(0, 2)
                .map(
                  (topic) =>
                    TOPIC_LABELS[topic as keyof typeof TOPIC_LABELS]?.[
                      locale
                    ] ?? topic
                )
                .join(' / ') || '—'
            }
            icon={<BrainCircuit className="size-5" />}
            accent={weakTopics.length ? 'danger' : 'success'}
          />
        </div>
        {checkpointComparison ? (
          <Panel className="mt-6 p-5">
            <h2 className="font-semibold">{t.checkpointResult}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border p-4">
                <p className="text-muted-foreground text-xs">{t.scoreChange}</p>
                <p
                  className={cn(
                    'mt-2 text-2xl font-semibold tabular-nums',
                    checkpointComparison.scoreDelta >= 0
                      ? 'text-emerald-600'
                      : 'text-red-600'
                  )}
                >
                  {checkpointComparison.scoreDelta >= 0 ? '+' : ''}
                  {checkpointComparison.scoreDelta} {t.percentagePoints}
                </p>
              </div>
              <div className="rounded-md border p-4">
                <p className="text-muted-foreground text-xs">{t.timeChange}</p>
                <p
                  className={cn(
                    'mt-2 text-2xl font-semibold tabular-nums',
                    checkpointComparison.averageDurationDeltaMs <= 0
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                  )}
                >
                  {checkpointComparison.averageDurationDeltaMs > 0 ? '+' : ''}
                  {Math.round(
                    checkpointComparison.averageDurationDeltaMs / 1000
                  )}{' '}
                  {t.seconds}
                </p>
              </div>
              <div className="rounded-md border p-4">
                <p className="text-muted-foreground text-xs">{t.hintChange}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {checkpointComparison.hintCountDelta >= 0 ? '+' : ''}
                  {checkpointComparison.hintCountDelta} {t.hintUses}
                </p>
              </div>
              <div className="rounded-md border p-4">
                <p className="text-muted-foreground text-xs">{t.errorChange}</p>
                <p className="mt-2 text-sm font-semibold break-words">
                  {checkpointComparison.baselineErrorCategories.join(', ') ||
                    t.noErrors}
                  {' → '}
                  {checkpointComparison.checkpointErrorCategories.join(', ') ||
                    t.noErrors}
                </p>
              </div>
            </div>
          </Panel>
        ) : null}
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
                    {TOPIC_LABELS[topic as keyof typeof TOPIC_LABELS]?.[
                      locale
                    ] ?? topic}
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
                  setSecondsLeft(durationSeconds);
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
    ((durationSeconds - secondsLeft) / durationSeconds) * 100;
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
            <Badge
              variant="outline"
              className="hidden rounded-md sm:inline-flex"
            >
              {t.localMode}
            </Badge>
            <Select
              value={language}
              onValueChange={(value) => setLanguage(value as Language)}
            >
              <SelectTrigger
                size="sm"
                className="w-32 rounded-md"
                aria-label={t.language}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableLanguages.map((languageId) => (
                  <SelectItem key={languageId} value={languageId}>
                    {LANGUAGE_REGISTRY[languageId].label}
                  </SelectItem>
                ))}
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
            <Button
              size="sm"
              variant="ghost"
              disabled={submitting}
              onClick={() => void abandonCurrentAssessment()}
            >
              <XCircle />
              <span className="hidden sm:inline">{t.abandon}</span>
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
                    updateCode(getProblemTemplate(currentProblem, language));
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
