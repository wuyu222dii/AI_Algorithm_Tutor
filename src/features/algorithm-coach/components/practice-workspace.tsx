'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Code2,
  FlaskConical,
  Lightbulb,
  LoaderCircle,
  MessageSquareText,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Terminal,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import { Textarea } from '@/shared/components/ui/textarea';
import { cn } from '@/shared/lib/utils';

import { getExperimentVariant } from '../analytics';
import { isImportedDraftSlug } from '../imported-drafts';
import {
  getProblemContentVersion,
  getProblemEntryPoint,
  getProblemTemplate,
  LANGUAGE_REGISTRY,
  problemSupportsLanguage,
} from '../languages';
import { TOPIC_LABELS } from '../learning-progress';
import { loadPracticeContext, savePracticeContext } from '../practice-context';
import { runCode } from '../runner';
import { useCoachStore } from '../store';
import { getPracticeSessionKey } from '../sync';
import type {
  CoachResponse,
  CodeRunResult,
  CorrectionEpisode,
  Language,
  Problem,
} from '../types';
import { CodeEditor } from './code-editor';
import {
  artifactText,
  difficultyLabel,
  getPreferredLanguage,
  getTestResults,
  localeKey,
  localHintPreviews,
  localizedProblem,
  runDuration,
  runError,
  runPassed,
} from './domain-adapter';
import {
  ReviewCardGenerationNotice,
  type ReviewCardGenerationStatus,
} from './review-card-generation-notice';

const copy = {
  zh: {
    back: '返回题库',
    problem: '题目',
    code: '代码',
    coach: 'AI 教练',
    sample: '样例',
    constraints: '约束条件',
    run: '运行样例',
    submit: '提交本地测试',
    running: '运行中',
    reset: '重置代码',
    console: '运行结果',
    noRun: '运行代码后，这里会显示测试结果和控制台输出。',
    passed: '全部通过',
    failed: '仍需调整',
    duration: '执行耗时',
    test: '测试',
    expected: '期望',
    actual: '实际',
    input: '输入',
    diagnosis: '诊断错因',
    diagnosing: '分析中…',
    counterexample: '生成反例',
    counterexampleLoading: '生成中…',
    hints: '逐级提示',
    hintsDetail: '每次只揭示一层，先保留自己推导的空间。',
    hintConcept: '第 1 层 · 概念',
    hintDirection: '第 2 层 · 方向',
    hintPseudo: '第 3 层 · 伪代码',
    reveal: '查看提示',
    revealed: '已查看',
    refining: '细化中',
    curatedHint: '题目提示',
    hintFallback: '在线细化未完成，已保留当前题目提示。',
    needRun: '请先运行代码，AI 才能依据真实错误或测试结果诊断。',
    aiWelcome:
      '我会基于当前题目、代码和真实运行结果提供引导，不直接给出完整答案。',
    chatPlaceholder: '追问思路、复杂度或某个错误…',
    send: '发送',
    stop: '停止生成',
    retryChat: '重试上一条',
    stopped: '回答已停止，可以重试上一条问题。',
    you: '你',
    unavailable: 'AI 服务暂时不可用，请稍后重试。',
    quotaExceeded: '今日 AI 使用额度已用完，请稍后再试。',
    requestTimeout: 'AI 响应超时，请重试。',
    invalidRequest: 'AI 请求参数无效，请刷新页面后重试。',
    error: '代码运行失败，请检查语法或稍后重试。',
    completed: '本题已完成。',
    reviewCardFailedToast: '复习卡未生成，可在 AI 教练中重试。',
    imported: '导入题',
    importedNotice:
      '该导入草稿当前没有可验证测试；你可以编辑代码，但运行与提交会保持关闭。',
    noVerifiedTests: '无验证测试',
    notFound: '没有找到这道题',
    notFoundDetail: '题目可能已被移除，或导入草稿已从浏览器中清除。',
    versionUnavailable: '这个题目版本不可用',
    versionUnavailableDetail:
      '无法加载计划或历史记录指定的题目版本。为避免混用测试，系统不会回退到最新版本。',
    live: '在线 AI',
    local: '本地演示',
    reviewCard: '复习卡片',
    timeline: '纠错时间线',
    runTimeline: '代码运行',
    codeChanged: '相较上次运行已修改代码',
    episodeResolved: '已完成纠错',
    episodeOpen: '纠错进行中',
    withinThree: '3 次运行内通过',
    repairTime: '修复用时',
    initialEvidence: '首次失败证据',
    changedLines: '修改行',
    addedLines: '新增行',
    removedLines: '删除行',
    repeatedCause: '重复错因',
    testsPassed: '个测试通过',
    javascript: 'JavaScript',
    python: 'Python',
  },
  en: {
    back: 'Back to problems',
    problem: 'Problem',
    code: 'Code',
    coach: 'AI Coach',
    sample: 'Example',
    constraints: 'Constraints',
    run: 'Run examples',
    submit: 'Run local tests',
    running: 'Running',
    reset: 'Reset code',
    console: 'Run results',
    noRun: 'Run your code to see test results and console output here.',
    passed: 'All tests passed',
    failed: 'Needs another pass',
    duration: 'Execution time',
    test: 'Test',
    expected: 'Expected',
    actual: 'Actual',
    input: 'Input',
    diagnosis: 'Diagnose issue',
    diagnosing: 'Analyzing…',
    counterexample: 'Generate counterexample',
    counterexampleLoading: 'Generating…',
    hints: 'Hint ladder',
    hintsDetail:
      'Reveal one level at a time and keep room for your own reasoning.',
    hintConcept: 'Level 1 · Concept',
    hintDirection: 'Level 2 · Direction',
    hintPseudo: 'Level 3 · Pseudocode',
    reveal: 'Reveal hint',
    revealed: 'Revealed',
    refining: 'Refining',
    curatedHint: 'Problem hint',
    hintFallback:
      'Online refinement did not finish. The problem hint is still available.',
    needRun:
      'Run your code first so the diagnosis can cite a real error or test result.',
    aiWelcome:
      'I use the current problem, code, and real run results to guide you without revealing a full solution.',
    chatPlaceholder: 'Ask about the approach, complexity, or an error…',
    send: 'Send',
    stop: 'Stop generation',
    retryChat: 'Retry last question',
    stopped: 'The response was stopped. You can retry the last question.',
    you: 'You',
    unavailable: 'AI is temporarily unavailable. Please try again later.',
    quotaExceeded: 'Your AI allowance is exhausted. Please try again later.',
    requestTimeout: 'The AI response timed out. Please retry.',
    invalidRequest: 'The AI request is invalid. Refresh the page and retry.',
    error: 'Code execution failed. Check the syntax or try again.',
    completed: 'Problem completed.',
    reviewCardFailedToast:
      'The review card was not generated. Retry it from the AI Coach.',
    imported: 'Imported',
    importedNotice:
      'This imported draft has no verified tests yet. You can edit code, but run and submit stay disabled.',
    noVerifiedTests: 'No verified tests',
    notFound: 'Problem not found',
    notFoundDetail:
      'It may have been removed, or the imported draft was cleared from this browser.',
    versionUnavailable: 'This problem version is unavailable',
    versionUnavailableDetail:
      'The version referenced by this plan or history could not be loaded. The latest version is not substituted because its tests may differ.',
    live: 'Live AI',
    local: 'Local demo',
    reviewCard: 'Review card',
    timeline: 'Correction timeline',
    runTimeline: 'Code run',
    codeChanged: 'Code changed since the previous run',
    episodeResolved: 'Correction completed',
    episodeOpen: 'Correction in progress',
    withinThree: 'Passed within 3 runs',
    repairTime: 'Repair time',
    initialEvidence: 'Initial failure evidence',
    changedLines: 'changed',
    addedLines: 'added',
    removedLines: 'removed',
    repeatedCause: 'Repeated cause',
    testsPassed: 'tests passed',
    javascript: 'JavaScript',
    python: 'Python',
  },
} as const;

type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ChatRetryReason = 'stopped' | 'quota' | 'timeout' | 'unavailable';

type ChatRetryState = {
  prompt: string;
  reason: ChatRetryReason;
};

type ArtifactView = {
  id: string;
  type: string;
  content: string;
  mode: CoachResponse['mode'];
  runId?: string;
  createdAt?: string;
  status?: CodeRunResult['status'];
  hintLevel?: 1 | 2 | 3;
};

type HintPreview = {
  id: string;
  level: 1 | 2 | 3;
  content: string;
  status: 'enhancing' | 'ready';
};

type ActiveHintRefinement = {
  contextKey: string;
  level: 1 | 2 | 3;
};

class CoachRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string
  ) {
    super(code ?? `Coach request failed with ${status}`);
    this.name = 'CoachRequestError';
  }
}

async function readCoachRequestError(response: Response) {
  let code: string | undefined;
  try {
    const payload = (await response.json()) as {
      error?: string | { code?: string };
    };
    code =
      typeof payload.error === 'string' ? payload.error : payload.error?.code;
  } catch {
    // The status still provides a safe localized fallback.
  }
  return new CoachRequestError(response.status, code);
}

export function PracticeWorkspace({
  slug,
  initialProblem,
  requestedContentVersion,
  versionUnavailable = false,
}: {
  slug: string;
  initialProblem?: Problem;
  requestedContentVersion?: number;
  versionUnavailable?: boolean;
}) {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const coach = useCoachStore();
  const saveCode = coach.saveCode;
  const state = coach.state;
  const loaded = coach.hydrated;
  const imported = isImportedDraftSlug(slug);
  const problem: Problem | null = useMemo(() => {
    if (!imported) {
      if (requestedContentVersion !== undefined) {
        if (
          initialProblem?.slug === slug &&
          getProblemContentVersion(initialProblem) === requestedContentVersion
        ) {
          return initialProblem;
        }
        return (
          coach.problems.find(
            (item) =>
              item.slug === slug &&
              getProblemContentVersion(item) === requestedContentVersion
          ) ?? null
        );
      }
      return (
        initialProblem ??
        coach.problems.find((item) => item.slug === slug) ??
        null
      );
    }
    if (!coach.storageScope) return null;
    const stored = coach.importedDrafts.find(
      (record) => record.problem.slug === slug
    )?.problem;
    if (stored) return stored;
    return slug === 'imported-draft' ? coach.importedProblem : null;
  }, [
    coach.importedDrafts,
    coach.importedProblem,
    coach.problems,
    coach.storageScope,
    initialProblem,
    imported,
    requestedContentVersion,
    slug,
  ]);
  const [selectedLanguage, setLanguage] = useState<Language>(
    getPreferredLanguage(state)
  );
  const availableLanguages = useMemo(
    () =>
      problem
        ? coach.enabledLanguages.filter((languageId) =>
            problemSupportsLanguage(problem, languageId)
          )
        : [],
    [coach.enabledLanguages, problem]
  );
  const language = availableLanguages.some(
    (languageId) => languageId === selectedLanguage
  )
    ? selectedLanguage
    : (availableLanguages[0] ?? 'javascript');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CodeRunResult | null>(null);
  const [running, setRunning] = useState<'sample' | 'all' | null>(null);
  const [activeMobileTab, setActiveMobileTab] = useState('problem');
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [activeHintRefinement, setActiveHintRefinement] =
    useState<ActiveHintRefinement | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([
    { id: 'welcome', role: 'assistant', content: t.aiWelcome },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatRetry, setChatRetry] = useState<ChatRetryState | null>(null);
  const [reviewCardStatus, setReviewCardStatus] =
    useState<ReviewCardGenerationStatus>('idle');
  const codeInitializedFor = useRef('');
  const contextInitializedFor = useRef('');
  const chatAbortRef = useRef<AbortController | null>(null);
  const hintLevelRef = useRef<0 | 1 | 2 | 3>(0);
  const hintRefinementRef = useRef<ActiveHintRefinement | null>(null);
  const hintRefinementQueueRef = useRef<Array<() => Promise<void>>>([]);
  const reviewCardRunRef = useRef<CodeRunResult | null>(null);
  const reviewCardInFlightRef = useRef(false);
  const reviewCardGenerationRef = useRef(0);
  const problemContentVersion = problem ? getProblemContentVersion(problem) : 1;
  const sessionKey = problem
    ? getPracticeSessionKey(problem.slug, problemContentVersion)
    : '';
  const hintPreviewContext = `${sessionKey}:${locale}`;
  const resolvedHintLevels = useMemo(() => {
    const levels = state.artifacts
      .filter(
        (artifact) =>
          artifact.type === 'hint' &&
          artifact.problemSlug === problem?.slug &&
          (artifact.problemContentVersion ?? 1) === problemContentVersion &&
          artifact.locale === locale
      )
      .map((artifact) => artifact.hint?.level)
      .filter((level): level is 1 | 2 | 3 => level !== undefined);
    return new Set(levels);
  }, [locale, problem?.slug, problemContentVersion, state.artifacts]);
  const currentHintPreviews: HintPreview[] = problem
    ? localHintPreviews(problem, locale, hintLevel, resolvedHintLevels).map(
        (preview) => ({
          ...preview,
          id: `hint-preview:${hintPreviewContext}:${preview.level}`,
          status:
            activeHintRefinement?.contextKey === hintPreviewContext &&
            activeHintRefinement.level === preview.level
              ? 'enhancing'
              : 'ready',
        })
      )
    : [];

  const artifacts = useMemo<ArtifactView[]>(() => {
    if (!problem) return [];
    const coachArtifacts = state.artifacts
      .filter(
        (artifact) =>
          artifact.problemSlug === problem.slug &&
          (artifact.problemContentVersion ?? 1) === problemContentVersion &&
          artifact.locale === locale
      )
      .map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        content: artifactText(artifact, locale),
        mode: artifact.generationMode ?? 'local',
        runId: artifact.runId,
        createdAt: artifact.createdAt,
        hintLevel: artifact.hint?.level,
      }))
      .filter((artifact) => artifact.content);

    const uniqueRuns = new Map<string, CodeRunResult>();
    const sessionRuns = state.sessions[sessionKey]?.runs ?? [];
    for (const run of [...state.runs, ...sessionRuns]) {
      if (
        run.problemSlug !== problem.slug ||
        (run.problemContentVersion ?? 1) !== problemContentVersion
      ) {
        continue;
      }
      const key =
        run.id ??
        `${problemContentVersion}:${run.executedAt}:${run.language}:${run.testScope ?? 'unknown'}`;
      uniqueRuns.set(key, run);
    }
    const chronologicalRuns = [...uniqueRuns.values()].sort(
      (left, right) =>
        Date.parse(left.executedAt) - Date.parse(right.executedAt)
    );
    const runArtifacts: ArtifactView[] = chronologicalRuns.map((run, index) => {
      const previousRun = chronologicalRuns[index - 1];
      const codeChanged =
        previousRun?.codeSnapshot !== undefined &&
        run.codeSnapshot !== undefined &&
        previousRun.codeSnapshot !== run.codeSnapshot;
      return {
        id: `run-${run.id ?? run.executedAt}`,
        type: 'run',
        content: `${run.passedTests}/${run.totalTests} ${t.testsPassed} · ${run.durationMs.toFixed(1)} ms${
          codeChanged ? `\n${t.codeChanged}` : ''
        }`,
        mode: 'local' as const,
        runId: run.id,
        createdAt: run.executedAt,
        status: run.status,
      };
    });

    const seenHintLevels = new Set<number>();
    return [...coachArtifacts, ...runArtifacts]
      .sort(
        (left, right) =>
          Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? '')
      )
      .filter((artifact) => {
        if (artifact.type !== 'hint' || artifact.hintLevel === undefined) {
          return true;
        }
        if (seenHintLevels.has(artifact.hintLevel)) return false;
        seenHintLevels.add(artifact.hintLevel);
        return true;
      })
      .slice(0, 16);
  }, [
    locale,
    problem,
    problemContentVersion,
    sessionKey,
    state.artifacts,
    state.runs,
    state.sessions,
    t.codeChanged,
    t.testsPassed,
  ]);

  const correctionEpisodes = useMemo(
    () =>
      state.correctionEpisodes
        .filter(
          (episode) =>
            episode.problemSlug === problem?.slug &&
            episode.problemContentVersion === problemContentVersion
        )
        .sort(
          (left, right) =>
            Date.parse(right.startedAt) - Date.parse(left.startedAt)
        ),
    [problem?.slug, problemContentVersion, state.correctionEpisodes]
  );

  useEffect(() => {
    if (!problem) return;
    const key = `${sessionKey}:${language}`;
    if (codeInitializedFor.current === key) return;
    setCode(
      state.sessions[sessionKey]?.code[language] ||
        state.code[sessionKey]?.[language] ||
        getProblemTemplate(problem, language) ||
        ''
    );
    codeInitializedFor.current = key;
  }, [language, problem, sessionKey, state.code, state.sessions]);

  useEffect(() => {
    if (!problem || !codeInitializedFor.current) return;
    const timeout = window.setTimeout(
      () => saveCode(problem.slug, language, code, problemContentVersion),
      350
    );
    return () => window.clearTimeout(timeout);
  }, [code, language, problem, problemContentVersion, saveCode]);

  useEffect(() => {
    if (!loaded || !problem || !coach.storageScope) return;
    const contextKey = `${coach.storageScope}:${sessionKey}:${locale}`;
    if (contextInitializedFor.current === contextKey) return;
    reviewCardGenerationRef.current += 1;
    reviewCardInFlightRef.current = false;

    const session = state.sessions[sessionKey];
    const restoredHintLevel = session?.hintLevel ?? 0;
    hintLevelRef.current = restoredHintLevel;
    setHintLevel(restoredHintLevel);
    const restoredResult = session?.runs.at(-1) ?? null;
    setResult(restoredResult);
    const restoredReviewCard =
      restoredResult &&
      runPassed(restoredResult) &&
      restoredResult.testScope === 'full'
        ? state.artifacts.find(
            (artifact) =>
              artifact.type === 'review_card' &&
              artifact.problemSlug === problem.slug &&
              (artifact.problemContentVersion ?? 1) === problemContentVersion &&
              (!artifact.runId || artifact.runId === restoredResult.id)
          )
        : undefined;
    reviewCardRunRef.current =
      restoredResult &&
      runPassed(restoredResult) &&
      restoredResult.testScope === 'full'
        ? restoredResult
        : null;
    setReviewCardStatus(
      reviewCardRunRef.current
        ? restoredReviewCard
          ? 'ready'
          : 'failed'
        : 'idle'
    );
    const saved = loadPracticeContext(
      sessionKey,
      undefined,
      coach.storageScope
    );
    const restoredMessages = saved?.messages.length
      ? saved.messages
      : [{ id: 'welcome', role: 'assistant' as const, content: t.aiWelcome }];
    setMessages(restoredMessages);
    const lastMessage = restoredMessages.at(-1);
    setChatRetry(
      lastMessage?.role === 'user'
        ? { prompt: lastMessage.content, reason: 'stopped' }
        : null
    );
    contextInitializedFor.current = contextKey;
  }, [
    coach.storageScope,
    loaded,
    locale,
    problem,
    problemContentVersion,
    sessionKey,
    state.artifacts,
    state.sessions,
    t.aiWelcome,
  ]);

  useEffect(() => {
    if (!problem || !coach.storageScope || !contextInitializedFor.current) {
      return;
    }
    const timeout = window.setTimeout(() => {
      savePracticeContext(
        sessionKey,
        messages,
        undefined,
        coach.storageScope ?? undefined
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [coach.storageScope, messages, problem, sessionKey]);

  useEffect(
    () => () => {
      chatAbortRef.current?.abort();
      reviewCardGenerationRef.current += 1;
    },
    []
  );

  const text = useMemo(
    () => (problem ? localizedProblem(problem, locale) : null),
    [locale, problem]
  );

  function switchLanguage(nextLanguage: Language) {
    if (!problem) return;
    coach.saveCode(problem.slug, language, code, problemContentVersion);
    setLanguage(nextLanguage);
    coach.setPreferredLanguage(nextLanguage);
    setResult(null);
    codeInitializedFor.current = '';
  }

  async function execute(scope: 'sample' | 'all') {
    if (!problem || running) return;
    setRunning(scope);
    setActiveMobileTab('code');
    try {
      coach.saveCode(problem.slug, language, code, problemContentVersion);
      const rawResult = await runCode({
        problem,
        language,
        enabledLanguages: coach.enabledLanguages,
        code,
        scope,
      });
      const nextResult: CodeRunResult = {
        ...rawResult,
        id: rawResult.id ?? crypto.randomUUID(),
        codeSnapshot: code,
        testScope: scope === 'all' ? 'full' : 'sample',
        submitted: scope === 'all',
      };
      if (language === 'typescript' && nextResult.status === 'syntax_error') {
        coach.trackEvent('typescript_transpile_failed', {
          problemSlug: problem.slug,
          properties: {
            problemContentVersion: getProblemContentVersion(problem),
          },
        });
      }
      setResult(nextResult);
      coach.recordRun(problem.slug, nextResult, {
        submitted: scope === 'all',
      });

      if (scope === 'all' && runPassed(nextResult)) {
        toast.success(t.completed);
        void generateReviewCard(nextResult);
      }
    } catch (error) {
      const fallback: CodeRunResult = {
        id: crypto.randomUUID(),
        problemSlug: problem.slug,
        language,
        status: 'runtime_error',
        passedTests: 0,
        totalTests: 0,
        testResults: [],
        console: [],
        error: error instanceof Error ? error.message : t.error,
        durationMs: 0,
        executedAt: new Date().toISOString(),
        codeSnapshot: code,
        testScope: scope === 'all' ? 'full' : 'sample',
        submitted: scope === 'all',
        problemContentVersion: getProblemContentVersion(problem),
        runnerMode: 'browser-worker',
      };
      setResult(fallback);
      toast.error(t.error);
    } finally {
      setRunning(null);
    }
  }

  async function requestArtifact(
    action: 'diagnose' | 'hint' | 'counterexample' | 'review_card',
    runResult = result,
    silent = false,
    requestedHintLevel?: 1 | 2 | 3,
    refinementOnly = false
  ) {
    if (!problem) return false;
    if (action !== 'hint' && (aiLoading || hintRefinementRef.current !== null))
      return false;
    if (
      action === 'hint' &&
      !refinementOnly &&
      aiLoading &&
      aiLoading !== 'hint'
    )
      return false;
    if (action === 'diagnose' && !runResult) {
      toast.info(t.needRun);
      return false;
    }
    let effectiveHintLevel: 1 | 2 | 3 | undefined;
    if (action === 'hint') {
      if (!requestedHintLevel) return false;
      effectiveHintLevel = requestedHintLevel;

      if (!refinementOnly) {
        const currentLevel = hintLevelRef.current;
        if (currentLevel >= 3 || requestedHintLevel !== currentLevel + 1) {
          return false;
        }
        hintLevelRef.current = requestedHintLevel;
        setHintLevel(requestedHintLevel);
        if (!silent) setActiveMobileTab('coach');
      }

      if (!refinementOnly) {
        coach.revealHint(problem.slug, problemContentVersion);
        coach.trackEvent('experiment_exposed', {
          problemSlug: problem.slug,
          properties: {
            experiment: 'hint-copy',
            variant: getExperimentVariant(problem.slug, coach.storageScope),
            hintLevel: requestedHintLevel,
          },
        });
      }

      if (hintRefinementRef.current) {
        if (!refinementOnly) {
          hintRefinementQueueRef.current.push(async () => {
            await requestArtifact(
              'hint',
              runResult,
              silent,
              requestedHintLevel,
              true
            );
          });
        }
        return false;
      }

      const refinement = {
        contextKey: hintPreviewContext,
        level: requestedHintLevel,
      };
      hintRefinementRef.current = refinement;
      setActiveHintRefinement(refinement);
    } else if (!silent) {
      setActiveMobileTab('coach');
    }

    if (action === 'hint' && effectiveHintLevel === undefined) return false;
    let succeeded = false;
    setAiLoading(action);
    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          problemSlug: problem.slug,
          problemContentVersion: getProblemContentVersion(problem),
          problem: {
            slug: problem.slug,
            title: text?.titleText ?? problem.slug,
            description: text?.descriptionText ?? '',
            difficulty: problem.difficulty,
            topics: problem.topics,
            constraints: text?.constraintsText ?? [],
            entryPoint: getProblemEntryPoint(problem, language),
          },
          language,
          code,
          ...(runResult ? { runResult } : {}),
          ...(effectiveHintLevel ? { hintLevel: effectiveHintLevel } : {}),
          experimentVariant: getExperimentVariant(
            problem.slug,
            coach.storageScope
          ),
          locale,
        }),
      });
      if (!response.ok) throw await readCoachRequestError(response);
      const payload = (await response.json()) as CoachResponse;
      const artifact = payload.artifact;
      const content = artifactText(artifact, locale);
      if (!content) throw new Error('Empty coach response');

      const normalizedHint =
        action === 'hint' && effectiveHintLevel
          ? (artifact.hint ?? {
              level: effectiveHintLevel,
              principle: content,
            })
          : undefined;
      coach.addArtifact({
        ...artifact,
        ...(normalizedHint
          ? {
              hint: {
                ...normalizedHint,
                level: effectiveHintLevel ?? normalizedHint.level,
              },
            }
          : {}),
        type: action,
        problemSlug: problem.slug,
        problemContentVersion: getProblemContentVersion(problem),
        runId: runResult?.id,
        generationMode: payload.mode,
        model: payload.model,
        promptVersion: payload.promptVersion,
        traceId: payload.traceId,
        latencyMs: payload.latencyMs,
      });
      if (action === 'counterexample') {
        coach.trackEvent('counterexample_requested', {
          problemSlug: problem.slug,
          properties: {
            problemContentVersion: getProblemContentVersion(problem),
          },
        });
      } else if (action === 'review_card') {
        coach.trackEvent('review_card_created', {
          problemSlug: problem.slug,
        });
      }
      succeeded = true;
    } catch (error) {
      if (!silent) {
        if (action === 'hint' && effectiveHintLevel) {
          toast.info(t.hintFallback);
        } else if (error instanceof CoachRequestError && error.status === 429) {
          toast.info(t.quotaExceeded);
        } else if (
          error instanceof CoachRequestError &&
          (error.status === 504 || error.code === 'provider_timeout')
        ) {
          toast.info(t.requestTimeout);
        } else if (error instanceof CoachRequestError && error.status === 400) {
          toast.error(t.invalidRequest);
        } else {
          toast.info(t.unavailable);
        }
      }
    } finally {
      if (action === 'hint') {
        hintRefinementRef.current = null;
        const nextRefinement = hintRefinementQueueRef.current.shift();
        if (nextRefinement) {
          void nextRefinement();
          return;
        }
        setActiveHintRefinement(null);
      }
      setAiLoading(null);
    }
    return succeeded;
  }

  async function generateReviewCard(runResult?: CodeRunResult | null) {
    const target = runResult ?? reviewCardRunRef.current;
    if (
      !target ||
      !runPassed(target) ||
      target.testScope !== 'full' ||
      reviewCardInFlightRef.current
    ) {
      return;
    }
    reviewCardRunRef.current = target;
    reviewCardInFlightRef.current = true;
    const generation = ++reviewCardGenerationRef.current;
    setReviewCardStatus('pending');
    const generated = await requestArtifact('review_card', target, true);
    if (generation !== reviewCardGenerationRef.current) return;
    reviewCardInFlightRef.current = false;
    setReviewCardStatus(generated ? 'ready' : 'failed');
    if (!generated) toast.info(t.reviewCardFailedToast);
  }

  function resetReviewCardGeneration() {
    reviewCardGenerationRef.current += 1;
    reviewCardInFlightRef.current = false;
    reviewCardRunRef.current = null;
    setReviewCardStatus('idle');
  }

  async function requestChat(prompt: string, retry = false) {
    if (!prompt || !problem || chatLoading) return;
    const lastMatchingUserIndex = messages.findLastIndex(
      (message) => message.role === 'user' && message.content === prompt
    );
    const nextMessages =
      retry && lastMatchingUserIndex >= 0
        ? messages.slice(0, lastMatchingUserIndex + 1)
        : [
            ...messages,
            {
              id: `user-${Date.now()}`,
              role: 'user' as const,
              content: prompt,
            },
          ];
    setMessages(nextMessages);
    setChatRetry(null);
    setChatLoading(true);
    const controller = new AbortController();
    let assistantId: string | null = null;
    chatAbortRef.current?.abort();
    chatAbortRef.current = controller;
    try {
      const response = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemSlug: problem.slug,
          problemContentVersion: getProblemContentVersion(problem),
          language,
          code,
          ...(result ? { runResult: result } : {}),
          locale,
          problem: {
            slug: problem.slug,
            title: text?.titleText ?? problem.slug,
            description: text?.descriptionText ?? '',
            difficulty: problem.difficulty,
            topics: problem.topics,
            constraints: text?.constraintsText ?? [],
            entryPoint: getProblemEntryPoint(problem, language),
          },
          messages: nextMessages.map(({ role, content }) => ({
            role,
            content,
          })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw await readCoachRequestError(response);
      }
      const contentType = response.headers.get('content-type') ?? '';
      let content = '';
      const responseAssistantId = `assistant-${Date.now()}`;
      assistantId = responseAssistantId;
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        content = String(
          payload.message ?? payload.content ?? payload.text ?? ''
        );
        if (content) {
          setMessages((current) => [
            ...current,
            { id: responseAssistantId, role: 'assistant', content },
          ]);
        }
      } else {
        const reader = response.body?.getReader();
        if (!reader) {
          content = await response.text();
          if (content) {
            setMessages((current) => [
              ...current,
              { id: responseAssistantId, role: 'assistant', content },
            ]);
          }
        } else {
          const decoder = new TextDecoder();
          setMessages((current) => [
            ...current,
            { id: responseAssistantId, role: 'assistant', content: '' },
          ]);
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            content += decoder.decode(value, { stream: true });
            setMessages((current) =>
              current.map((message) =>
                message.id === responseAssistantId
                  ? { ...message, content }
                  : message
              )
            );
          }
          content += decoder.decode();
        }
      }
      if (!content) throw new Error('Empty chat response');
      coach.trackEvent('coach_chat_message', {
        problemSlug: problem.slug,
        properties: {
          messageLength: prompt.length,
          responseLength: content.length,
          outcome: 'completed',
          retry,
        },
      });
    } catch (error) {
      if (assistantId) {
        setMessages((current) =>
          current.filter((message) => message.id !== assistantId)
        );
      }
      if (error instanceof Error && error.name === 'AbortError') {
        setChatRetry({ prompt, reason: 'stopped' });
        coach.trackEvent('coach_chat_message', {
          problemSlug: problem.slug,
          properties: {
            messageLength: prompt.length,
            outcome: 'cancelled',
            retry,
          },
        });
        return;
      }
      if (error instanceof CoachRequestError && error.status === 429) {
        setChatRetry({ prompt, reason: 'quota' });
        toast.info(t.quotaExceeded);
      } else if (
        error instanceof CoachRequestError &&
        (error.status === 504 || error.code === 'provider_timeout')
      ) {
        setChatRetry({ prompt, reason: 'timeout' });
        toast.info(t.requestTimeout);
      } else {
        setChatRetry({ prompt, reason: 'unavailable' });
        toast.info(t.unavailable);
      }
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      setChatLoading(false);
    }
  }

  function sendChat(event: FormEvent) {
    event.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt || chatLoading) return;
    setChatInput('');
    void requestChat(prompt);
  }

  function retryChat() {
    if (!chatRetry || chatLoading) return;
    void requestChat(chatRetry.prompt, true);
  }

  function stopChat() {
    chatAbortRef.current?.abort();
  }

  if (!loaded) {
    return (
      <div className="text-muted-foreground flex min-h-[70svh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

  if (!problem || !text) {
    const exactVersionUnavailable =
      versionUnavailable || requestedContentVersion !== undefined;
    return (
      <div className="mx-auto flex min-h-[70svh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <CircleAlert className="text-muted-foreground size-10" />
        <h1 className="mt-5 text-xl font-semibold">
          {exactVersionUnavailable ? t.versionUnavailable : t.notFound}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {exactVersionUnavailable
            ? t.versionUnavailableDetail
            : t.notFoundDetail}
        </p>
        <Button asChild className="mt-5">
          <Link href="/problems">{t.back}</Link>
        </Button>
      </div>
    );
  }

  const problemPanel = (
    <ProblemPanel
      problem={problem}
      locale={locale}
      copy={t}
      imported={imported}
    />
  );
  const editorPanel = (
    <EditorPanel
      copy={t}
      problem={problem}
      language={language}
      availableLanguages={availableLanguages}
      code={code}
      result={result}
      running={running}
      onLanguageChange={switchLanguage}
      onCodeChange={setCode}
      onRun={() => execute('sample')}
      onSubmit={() => execute('all')}
      onReset={() => {
        setCode(getProblemTemplate(problem, language));
        setResult(null);
        resetReviewCardGeneration();
      }}
    />
  );
  const coachPanel = (
    <CoachPanel
      copy={t}
      artifacts={artifacts}
      correctionEpisodes={correctionEpisodes}
      hintLevel={hintLevel}
      hintPreviews={currentHintPreviews}
      aiLoading={aiLoading}
      messages={messages}
      chatInput={chatInput}
      chatLoading={chatLoading}
      chatRetry={chatRetry}
      locale={locale}
      reviewCardStatus={reviewCardStatus}
      hasResult={Boolean(result)}
      onArtifact={requestArtifact}
      onHint={(level) => requestArtifact('hint', result, false, level)}
      onChatInput={setChatInput}
      onChatSubmit={sendChat}
      onChatStop={stopChat}
      onChatRetry={retryChat}
      onReviewCardRetry={() => void generateReviewCard()}
    />
  );

  return (
    <div className="mx-auto max-w-[1680px] min-w-0 p-3 md:p-4">
      <div className="bg-card mb-3 flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5">
        <Button asChild variant="ghost" size="icon" aria-label={t.back}>
          <Link href="/problems">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold md:text-base">
              {text.titleText}
            </h1>
            {imported ? <Badge variant="outline">{t.imported}</Badge> : null}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {problem.topics
              .map(
                (topic) =>
                  TOPIC_LABELS[topic as keyof typeof TOPIC_LABELS]?.[locale] ??
                  topic
              )
              .join(' · ')}
          </p>
        </div>
        <Badge variant="secondary" className="rounded-md">
          {difficultyLabel(problem.difficulty, locale)}
        </Badge>
      </div>

      <div className="bg-card hidden min-h-[720px] grid-cols-[minmax(280px,0.85fr)_minmax(440px,1.25fr)_minmax(300px,0.9fr)] overflow-hidden rounded-lg border lg:grid lg:h-[calc(100svh-8.75rem)] lg:min-h-[620px]">
        <div className="min-h-0 overflow-hidden border-r">{problemPanel}</div>
        <div className="min-h-0 overflow-hidden border-r">{editorPanel}</div>
        <div className="min-h-0 overflow-hidden">{coachPanel}</div>
      </div>

      <Tabs
        value={activeMobileTab}
        onValueChange={setActiveMobileTab}
        className="lg:hidden"
      >
        <TabsList className="grid h-11 w-full grid-cols-3 rounded-lg">
          <TabsTrigger value="problem" className="rounded-md">
            <ClipboardProblemIcon />
            {t.problem}
          </TabsTrigger>
          <TabsTrigger value="code" className="rounded-md">
            <Code2 />
            {t.code}
          </TabsTrigger>
          <TabsTrigger value="coach" className="rounded-md">
            <Bot />
            {t.coach}
            {reviewCardStatus === 'pending' ? (
              <LoaderCircle
                aria-hidden="true"
                className="ml-1 size-3 animate-spin"
              />
            ) : reviewCardStatus === 'failed' ? (
              <CircleAlert
                aria-hidden="true"
                className="ml-1 size-3 text-amber-600 dark:text-amber-300"
              />
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="problem"
          className="bg-card mt-3 h-[calc(100svh-13rem)] min-h-[580px] overflow-hidden rounded-lg border"
        >
          {problemPanel}
        </TabsContent>
        <TabsContent
          value="code"
          className="bg-card mt-3 h-[calc(100svh-13rem)] min-h-[580px] overflow-hidden rounded-lg border"
        >
          {editorPanel}
        </TabsContent>
        <TabsContent
          value="coach"
          className="bg-card mt-3 h-[calc(100svh-13rem)] min-h-[580px] overflow-hidden rounded-lg border"
        >
          {coachPanel}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProblemPanel({
  problem,
  locale,
  copy: t,
  imported,
}: {
  problem: Problem;
  locale: 'zh' | 'en';
  copy: (typeof copy)['zh'] | (typeof copy)['en'];
  imported: boolean;
}) {
  const text = localizedProblem(problem, locale);
  const examples = problem.examples;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b px-4 text-sm font-semibold">
        {t.problem}
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {imported ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
            {t.importedNotice}
          </div>
        ) : null}
        <div className="text-sm leading-7 whitespace-pre-wrap">
          {text.descriptionText}
        </div>
        {examples.map((example, index) => (
          <section key={example.id ?? index}>
            <h2 className="text-sm font-semibold">
              {t.sample} {index + 1}
            </h2>
            <div className="bg-muted/35 mt-2 overflow-hidden rounded-md border font-mono text-xs leading-5">
              <div className="border-b px-3 py-2">
                <span className="text-muted-foreground">{t.input}: </span>
                {formatValue(example.input)}
              </div>
              <div className="px-3 py-2">
                <span className="text-muted-foreground">{t.expected}: </span>
                {formatValue(example.expected ?? example.output)}
              </div>
            </div>
          </section>
        ))}
        {text.constraintsText.length ? (
          <section>
            <h2 className="text-sm font-semibold">{t.constraints}</h2>
            <ul className="text-muted-foreground mt-2 space-y-2 text-xs leading-5">
              {text.constraintsText.map((constraint, index) => (
                <li key={index} className="flex gap-2">
                  <span className="bg-primary mt-2 size-1 shrink-0 rounded-full" />
                  <span>{constraint}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function EditorPanel({
  copy: t,
  problem,
  language,
  availableLanguages,
  code,
  result,
  running,
  onLanguageChange,
  onCodeChange,
  onRun,
  onSubmit,
  onReset,
}: {
  copy: (typeof copy)['zh'] | (typeof copy)['en'];
  problem: Problem;
  language: Language;
  availableLanguages: readonly Language[];
  code: string;
  result: CodeRunResult | null;
  running: 'sample' | 'all' | null;
  onLanguageChange: (language: Language) => void;
  onCodeChange: (value: string) => void;
  onRun: () => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const tests = getTestResults(result);
  const error = runError(result);
  const passed = runPassed(result);
  const hasTests = problem.tests.length > 0;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(280px,1fr)_minmax(190px,0.62fr)]">
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Select
          value={language}
          onValueChange={(value) => onLanguageChange(value as Language)}
        >
          <SelectTrigger size="sm" className="w-32 rounded-md">
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onReset}
          title={t.reset}
          aria-label={t.reset}
        >
          <RotateCcw />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {!hasTests ? (
            <Badge
              variant="outline"
              className="rounded-md border-amber-500/30 text-amber-700 dark:text-amber-300"
            >
              {t.noVerifiedTests}
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={onRun}
            disabled={Boolean(running) || !hasTests}
          >
            {running === 'sample' ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Play />
            )}
            {running === 'sample' ? t.running : t.run}
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={Boolean(running) || !hasTests}
          >
            {running === 'all' ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Check />
            )}
            {running === 'all' ? t.running : t.submit}
          </Button>
        </div>
      </div>
      <CodeEditor value={code} onChange={onCodeChange} language={language} />
      <div className="bg-muted/20 flex min-h-0 flex-col border-t">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs font-semibold">
          <Terminal className="size-4" />
          {t.console}
          {result ? (
            <span
              className={cn(
                'ml-auto flex items-center gap-1 font-normal',
                passed
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-red-700 dark:text-red-300'
              )}
            >
              {passed ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <XCircle className="size-3.5" />
              )}
              {passed ? t.passed : t.failed}
            </span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!result ? (
            <div className="text-muted-foreground flex h-full min-h-28 flex-col items-center justify-center text-center text-xs">
              <Terminal className="mb-2 size-5" />
              {t.noRun}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-muted-foreground flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <Clock3 className="size-3.5" />
                  {t.duration}: {runDuration(result)} ms
                </span>
                <span>
                  {tests.filter((test) => test.passed).length}/{tests.length}{' '}
                  {t.test}
                </span>
              </div>
              {error ? (
                <pre className="overflow-x-auto rounded-md border border-red-500/30 bg-red-500/8 p-3 text-xs leading-5 whitespace-pre-wrap text-red-800 dark:text-red-200">
                  {error}
                </pre>
              ) : null}
              {tests.map((test, index) => (
                <details
                  key={test.testId ?? index}
                  className="group bg-background rounded-md border"
                  open={!test.passed}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
                    {test.passed ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <XCircle className="size-4 text-red-600" />
                    )}
                    {t.test} {index + 1}
                    <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="grid gap-2 border-t p-3 font-mono text-[11px] leading-5 sm:grid-cols-3">
                    <ValueBlock
                      label={t.input}
                      value={
                        problem.tests.find((item) => item.id === test.testId)
                          ?.args
                      }
                    />
                    <ValueBlock label={t.expected} value={test.expected} />
                    <ValueBlock label={t.actual} value={test.actual} />
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CoachPanel({
  copy: t,
  artifacts,
  correctionEpisodes,
  hintLevel,
  hintPreviews,
  aiLoading,
  messages,
  chatInput,
  chatLoading,
  chatRetry,
  locale,
  reviewCardStatus,
  hasResult,
  onArtifact,
  onHint,
  onChatInput,
  onChatSubmit,
  onChatStop,
  onChatRetry,
  onReviewCardRetry,
}: {
  copy: (typeof copy)['zh'] | (typeof copy)['en'];
  artifacts: ArtifactView[];
  correctionEpisodes: CorrectionEpisode[];
  hintLevel: number;
  hintPreviews: HintPreview[];
  aiLoading: string | null;
  messages: CoachMessage[];
  chatInput: string;
  chatLoading: boolean;
  chatRetry: ChatRetryState | null;
  locale: 'zh' | 'en';
  reviewCardStatus: ReviewCardGenerationStatus;
  hasResult: boolean;
  onArtifact: (
    action: 'diagnose' | 'hint' | 'counterexample' | 'review_card'
  ) => void;
  onHint: (level: 1 | 2 | 3) => void;
  onChatInput: (value: string) => void;
  onChatSubmit: (event: FormEvent) => void;
  onChatStop: () => void;
  onChatRetry: () => void;
  onReviewCardRetry: () => void;
}) {
  const hintLabels = [t.hintConcept, t.hintDirection, t.hintPseudo];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-sm font-semibold">
        <Bot className="text-primary size-4" />
        {t.coach}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 border-b p-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-w-0"
              onClick={() => onArtifact('diagnose')}
              disabled={Boolean(aiLoading)}
            >
              {aiLoading === 'diagnose' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <TriangleAlert />
              )}
              <span className="truncate">
                {aiLoading === 'diagnose' ? t.diagnosing : t.diagnosis}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0"
              onClick={() => onArtifact('counterexample')}
              disabled={Boolean(aiLoading)}
            >
              {aiLoading === 'counterexample' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <FlaskConical />
              )}
              <span className="truncate">
                {aiLoading === 'counterexample'
                  ? t.counterexampleLoading
                  : t.counterexample}
              </span>
            </Button>
          </div>
          {!hasResult ? (
            <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {t.needRun}
            </p>
          ) : null}
          <ReviewCardGenerationNotice
            locale={locale}
            status={reviewCardStatus}
            onRetry={onReviewCardRetry}
          />
        </div>

        <div className="border-b p-4">
          <div className="flex items-start gap-2">
            <Lightbulb className="mt-0.5 size-4 text-amber-600 dark:text-amber-300" />
            <div>
              <h2 className="text-sm font-semibold">{t.hints}</h2>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                {t.hintsDetail}
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {hintLabels.map((label, index) => {
              const level = (index + 1) as 1 | 2 | 3;
              const revealed = hintLevel >= level;
              const locked = hintLevel < index;
              const preview = hintPreviews.find((item) => item.level === level);
              return (
                <div
                  key={label}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2',
                    revealed && 'border-amber-500/30 bg-amber-500/8'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-sm border text-[10px]',
                      revealed &&
                        'border-amber-500/40 text-amber-700 dark:text-amber-300'
                    )}
                  >
                    {revealed ? <Check className="size-3" /> : level}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {label}
                  </span>
                  {!revealed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => onHint(level)}
                      disabled={
                        locked || Boolean(aiLoading && aiLoading !== 'hint')
                      }
                    >
                      {t.reveal}
                    </Button>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                      {preview?.status === 'enhancing' ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : null}
                      {preview?.status === 'enhancing'
                        ? t.refining
                        : t.revealed}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {hintPreviews.length ||
        artifacts.length ||
        correctionEpisodes.length ? (
          <div className="space-y-3 border-b p-4">
            <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold">
              <Clock3 className="size-3.5" />
              {t.timeline}
            </div>
            {[...hintPreviews].reverse().map((preview) => (
              <div
                key={preview.id}
                role="status"
                aria-live="polite"
                className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3"
              >
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Lightbulb className="size-3.5 text-amber-600" />
                  <span>{hintLabels[preview.level - 1]}</span>
                  <Badge
                    variant="outline"
                    className="ml-auto gap-1 rounded-md px-1.5 py-0 text-[10px] font-normal"
                  >
                    {preview.status === 'enhancing' ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : null}
                    {preview.status === 'enhancing'
                      ? t.refining
                      : t.curatedHint}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-2 text-xs leading-6 whitespace-pre-wrap">
                  {preview.content}
                </p>
              </div>
            ))}
            {correctionEpisodes.map((episode) => (
              <div
                key={episode.id}
                className={cn(
                  'rounded-lg border p-3',
                  episode.resolved
                    ? 'border-emerald-500/25 bg-emerald-500/5'
                    : 'border-amber-500/25 bg-amber-500/5'
                )}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  {episode.resolved ? (
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                  ) : (
                    <TriangleAlert className="size-3.5 text-amber-600" />
                  )}
                  <span>
                    {episode.resolved ? t.episodeResolved : t.episodeOpen}
                  </span>
                  <Badge variant="outline" className="rounded-md text-[10px]">
                    {episode.diagnosisCategory}
                  </Badge>
                  {episode.passedWithinThreeRuns ? (
                    <Badge className="rounded-md bg-emerald-600 text-[10px] text-white">
                      {t.withinThree}
                    </Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground mt-2 space-y-1 text-xs leading-5">
                  <p>
                    {t.initialEvidence}: {episode.initialFailure.passedTests}/
                    {episode.initialFailure.totalTests} {t.testsPassed}
                    {episode.initialFailure.error
                      ? ` · ${episode.initialFailure.error}`
                      : ''}
                  </p>
                  {episode.attempts.slice(1).map((attempt, index) => {
                    const diff = attempt.diffFromPrevious;
                    return (
                      <p key={attempt.runId ?? attempt.executedAt}>
                        #{index + 1} {attempt.passedTests}/{attempt.totalTests}{' '}
                        {t.testsPassed}
                        {diff?.hasChanges
                          ? ` · ${t.changedLines} ${diff.changedLines} · ${t.addedLines} ${diff.addedLines} · ${t.removedLines} ${diff.removedLines}`
                          : ''}
                      </p>
                    );
                  })}
                  {episode.repairDurationMs !== undefined ? (
                    <p>
                      {t.repairTime}:{' '}
                      {Math.max(1, Math.round(episode.repairDurationMs / 1000))}{' '}
                      s
                    </p>
                  ) : null}
                  {episode.repeatedDiagnosisCategories.length ? (
                    <p>
                      {t.repeatedCause}:{' '}
                      {episode.repeatedDiagnosisCategories.join(', ')}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            {artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="bg-muted/30 rounded-lg border p-3"
              >
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {artifact.type === 'diagnose' ? (
                    <TriangleAlert className="size-3.5 text-red-600" />
                  ) : null}
                  {artifact.type === 'counterexample' ? (
                    <FlaskConical className="size-3.5 text-amber-600" />
                  ) : null}
                  {artifact.type === 'hint' ? (
                    <Lightbulb className="size-3.5 text-amber-600" />
                  ) : null}
                  {artifact.type === 'review_card' ? (
                    <Sparkles className="text-primary size-3.5" />
                  ) : null}
                  {artifact.type === 'run' ? (
                    artifact.status === 'passed' ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="size-3.5 text-red-600" />
                    )
                  ) : null}
                  <span>
                    {artifact.type === 'hint' && artifact.hintLevel
                      ? hintLabels[artifact.hintLevel - 1]
                      : artifactTitle(artifact.type, t)}
                  </span>
                  <Badge
                    variant="outline"
                    className="ml-auto rounded-md px-1.5 py-0 text-[10px] font-normal"
                  >
                    {artifact.mode === 'local' ? t.local : t.live}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-2 text-xs leading-6 whitespace-pre-wrap">
                  {artifact.content}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-3 p-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex gap-2',
                message.role === 'user' && 'justify-end'
              )}
            >
              {message.role === 'assistant' ? (
                <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
                  <Bot className="size-4" />
                </span>
              ) : null}
              <div
                className={cn(
                  'bg-muted/40 max-w-[85%] rounded-lg border px-3 py-2 text-xs leading-5',
                  message.role === 'user' && 'border-primary/20 bg-primary/10'
                )}
              >
                {message.content}
              </div>
            </div>
          ))}
          {chatLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <LoaderCircle className="size-4 animate-spin" />
              {t.diagnosing}
            </div>
          ) : null}
          {chatRetry && !chatLoading ? (
            <div
              className="rounded-md border border-amber-500/30 bg-amber-500/8 p-3"
              role="status"
            >
              <div className="flex items-start gap-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {chatRetry.reason === 'stopped'
                    ? t.stopped
                    : chatRetry.reason === 'quota'
                      ? t.quotaExceeded
                      : chatRetry.reason === 'timeout'
                        ? t.requestTimeout
                        : t.unavailable}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7 bg-transparent text-xs"
                onClick={onChatRetry}
              >
                <RotateCcw />
                {t.retryChat}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <form onSubmit={onChatSubmit} className="shrink-0 border-t p-3">
        <div className="relative">
          <Textarea
            value={chatInput}
            onChange={(event) => onChatInput(event.target.value)}
            placeholder={t.chatPlaceholder}
            className="min-h-20 resize-none rounded-lg pr-12 text-xs leading-5"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type={chatLoading ? 'button' : 'submit'}
            size="icon-sm"
            className="absolute right-2 bottom-2"
            aria-label={chatLoading ? t.stop : t.send}
            title={chatLoading ? t.stop : t.send}
            disabled={!chatLoading && !chatInput.trim()}
            onClick={chatLoading ? onChatStop : undefined}
          >
            {chatLoading ? <Square /> : <Send />}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ValueBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 overflow-x-auto whitespace-pre-wrap">
        {formatValue(value)}
      </p>
    </div>
  );
}

function formatValue(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}

function artifactTitle(
  type: string,
  t: (typeof copy)['zh'] | (typeof copy)['en']
) {
  if (type === 'diagnose') return t.diagnosis;
  if (type === 'counterexample') return t.counterexample;
  if (type === 'review_card') return t.reviewCard;
  if (type === 'run') return t.runTimeline;
  return t.hints;
}

function ClipboardProblemIcon() {
  return <MessageSquareText className="size-4" />;
}
