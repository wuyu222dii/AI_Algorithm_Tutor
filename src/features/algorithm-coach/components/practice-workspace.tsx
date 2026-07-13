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
import { getProblemBySlug } from '../data/problems';
import { runCode } from '../runner';
import { useCoachStore } from '../store';
import type { CoachResponse, CodeRunResult, Language, Problem } from '../types';
import { CodeEditor } from './code-editor';
import {
  artifactText,
  difficultyLabel,
  getPreferredLanguage,
  getSavedCode,
  getTestResults,
  localeKey,
  localizedProblem,
  runDuration,
  runError,
  runPassed,
} from './domain-adapter';

const copy = {
  zh: {
    back: '返回题库',
    problem: '题目',
    code: '代码',
    coach: 'AI 教练',
    sample: '样例',
    constraints: '约束条件',
    run: '运行样例',
    submit: '提交测试',
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
    needRun: '请先运行代码，AI 才能依据真实错误或测试结果诊断。',
    aiWelcome:
      '我会基于当前题目、代码和真实运行结果提供引导，不直接给出完整答案。',
    chatPlaceholder: '追问思路、复杂度或某个错误…',
    send: '发送',
    you: '你',
    unavailable: 'AI 服务暂时不可用，请稍后重试。',
    error: '代码运行失败，请检查语法或稍后重试。',
    completed: '本题已完成。',
    imported: '导入题',
    importedNotice:
      '该导入草稿当前没有可验证测试；你可以编辑代码，但运行与提交会保持关闭。',
    noVerifiedTests: '无验证测试',
    notFound: '没有找到这道题',
    notFoundDetail: '题目可能已被移除，或导入草稿已从浏览器中清除。',
    live: '在线 AI',
    local: '本地演示',
    reviewCard: '复习卡片',
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
    submit: 'Submit tests',
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
    needRun:
      'Run your code first so the diagnosis can cite a real error or test result.',
    aiWelcome:
      'I use the current problem, code, and real run results to guide you without revealing a full solution.',
    chatPlaceholder: 'Ask about the approach, complexity, or an error…',
    send: 'Send',
    you: 'You',
    unavailable: 'AI is temporarily unavailable. Please try again later.',
    error: 'Code execution failed. Check the syntax or try again.',
    completed: 'Problem completed.',
    imported: 'Imported',
    importedNotice:
      'This imported draft has no verified tests yet. You can edit code, but run and submit stay disabled.',
    noVerifiedTests: 'No verified tests',
    notFound: 'Problem not found',
    notFoundDetail:
      'It may have been removed, or the imported draft was cleared from this browser.',
    live: 'Live AI',
    local: 'Local demo',
    reviewCard: 'Review card',
    javascript: 'JavaScript',
    python: 'Python',
  },
} as const;

type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ArtifactView = {
  type: string;
  content: string;
  mode: CoachResponse['mode'];
};

export function PracticeWorkspace({ slug }: { slug: string }) {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const coach = useCoachStore();
  const state = coach.state;
  const problem: Problem | null =
    slug === 'imported-draft'
      ? coach.importedProblem
      : (getProblemBySlug(slug) ?? null);
  const loaded = coach.hydrated;
  const [language, setLanguage] = useState<Language>(
    getPreferredLanguage(state)
  );
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CodeRunResult | null>(null);
  const [running, setRunning] = useState<'sample' | 'all' | null>(null);
  const [activeMobileTab, setActiveMobileTab] = useState('problem');
  const [hintLevel, setHintLevel] = useState(0);
  const [artifacts, setArtifacts] = useState<ArtifactView[]>([]);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([
    { id: 'welcome', role: 'assistant', content: t.aiWelcome },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const codeInitializedFor = useRef('');

  useEffect(() => {
    if (!problem) return;
    const key = `${problem.id}:${language}`;
    if (codeInitializedFor.current === key) return;
    setCode(
      getSavedCode(state, problem.slug, language) ||
        problem.templates[language] ||
        ''
    );
    codeInitializedFor.current = key;
  }, [language, problem, state]);

  useEffect(() => {
    if (!problem || !codeInitializedFor.current) return;
    const save = coach.saveCode as (
      problemSlug: string,
      lang: Language,
      value: string
    ) => void;
    const timeout = window.setTimeout(
      () => save(problem.slug, language, code),
      350
    );
    return () => window.clearTimeout(timeout);
  }, [coach.saveCode, code, language, problem]);

  const text = useMemo(
    () => (problem ? localizedProblem(problem, locale) : null),
    [locale, problem]
  );

  function switchLanguage(nextLanguage: Language) {
    if (!problem) return;
    coach.saveCode(problem.slug, language, code);
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
      coach.saveCode(problem.slug, language, code);
      const rawResult = await runCode({ problem, language, code, scope });
      const nextResult: CodeRunResult = {
        ...rawResult,
        id: rawResult.id ?? crypto.randomUUID(),
        codeSnapshot: code,
        testScope: scope === 'all' ? 'full' : 'sample',
        submitted: scope === 'all',
      };
      setResult(nextResult);
      coach.recordRun(problem.slug, nextResult, {
        submitted: scope === 'all',
      });

      if (scope === 'all' && runPassed(nextResult)) {
        toast.success(t.completed);
        await requestArtifact('review_card', nextResult, true);
      }
    } catch (error) {
      const fallback = {
        passed: false,
        error: error instanceof Error ? error.message : t.error,
        tests: [],
        durationMs: 0,
      } as unknown as CodeRunResult;
      setResult(fallback);
      toast.error(t.error);
    } finally {
      setRunning(null);
    }
  }

  async function requestArtifact(
    action: 'diagnose' | 'hint' | 'counterexample' | 'review_card',
    runResult = result,
    silent = false
  ) {
    if (!problem || aiLoading) return;
    if (action === 'diagnose' && !runResult) {
      toast.info(t.needRun);
      return;
    }
    const nextHintLevel =
      action === 'hint' ? Math.min(3, hintLevel + 1) : hintLevel;
    setAiLoading(action);
    if (!silent) setActiveMobileTab('coach');
    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          problemSlug: problem.slug,
          problem: {
            slug: problem.slug,
            title: text?.titleText ?? problem.slug,
            description: text?.descriptionText ?? '',
            difficulty: problem.difficulty,
            topics: problem.topics,
            constraints: text?.constraintsText ?? [],
            entryPoint: problem.entryPoint,
          },
          language,
          code,
          runResult,
          ...(action === 'hint' ? { hintLevel: nextHintLevel } : {}),
          experimentVariant: getExperimentVariant(
            problem.slug,
            coach.storageScope
          ),
          locale,
        }),
      });
      if (!response.ok) throw new Error('Coach request failed');
      const payload = (await response.json()) as CoachResponse;
      const artifact = payload.artifact;
      const content = artifactText(artifact, locale);
      if (!content) throw new Error('Empty coach response');

      const view = {
        type: action,
        content,
        mode: payload.mode,
      };
      setArtifacts((current) => [
        view,
        ...current.filter((item) => item.type !== action),
      ]);
      coach.addArtifact({
        ...artifact,
        type: action,
        problemSlug: problem.slug,
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
        });
      } else if (action === 'review_card') {
        coach.trackEvent('review_card_created', {
          problemSlug: problem.slug,
        });
      }
      if (action === 'hint') {
        setHintLevel(nextHintLevel);
        coach.revealHint(problem.slug);
      }
    } catch {
      if (!silent) toast.info(t.unavailable);
    } finally {
      setAiLoading(null);
    }
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt || !problem || chatLoading) return;
    const userMessage: CoachMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);
    try {
      const response = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemSlug: problem.slug,
          language,
          code,
          runResult: result,
          locale,
          problem: {
            slug: problem.slug,
            title: text?.titleText ?? problem.slug,
            description: text?.descriptionText ?? '',
            difficulty: problem.difficulty,
            topics: problem.topics,
            constraints: text?.constraintsText ?? [],
            entryPoint: problem.entryPoint,
          },
          messages: nextMessages.map(({ role, content }) => ({
            role,
            content,
          })),
        }),
      });
      if (!response.ok) throw new Error('Chat failed');
      const contentType = response.headers.get('content-type') ?? '';
      let content = '';
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        content = String(
          payload.message ?? payload.content ?? payload.text ?? ''
        );
      } else {
        content = await response.text();
      }
      if (!content) throw new Error('Empty chat response');
      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: 'assistant', content },
      ]);
      coach.trackEvent('coach_chat_message', {
        problemSlug: problem.slug,
        properties: { messageLength: prompt.length },
      });
    } catch {
      toast.info(t.unavailable);
    } finally {
      setChatLoading(false);
    }
  }

  if (!loaded) {
    return (
      <div className="text-muted-foreground flex min-h-[70svh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

  if (!problem || !text) {
    return (
      <div className="mx-auto flex min-h-[70svh] max-w-xl flex-col items-center justify-center px-6 text-center">
        <CircleAlert className="text-muted-foreground size-10" />
        <h1 className="mt-5 text-xl font-semibold">{t.notFound}</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {t.notFoundDetail}
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
      imported={slug === 'imported-draft'}
    />
  );
  const editorPanel = (
    <EditorPanel
      copy={t}
      problem={problem}
      language={language}
      code={code}
      result={result}
      running={running}
      onLanguageChange={switchLanguage}
      onCodeChange={setCode}
      onRun={() => execute('sample')}
      onSubmit={() => execute('all')}
      onReset={() => {
        setCode(problem.templates[language] ?? '');
        setResult(null);
      }}
    />
  );
  const coachPanel = (
    <CoachPanel
      copy={t}
      artifacts={artifacts}
      hintLevel={hintLevel}
      aiLoading={aiLoading}
      messages={messages}
      chatInput={chatInput}
      chatLoading={chatLoading}
      hasResult={Boolean(result)}
      onArtifact={requestArtifact}
      onChatInput={setChatInput}
      onChatSubmit={sendChat}
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
            {slug === 'imported-draft' ? (
              <Badge variant="outline">{t.imported}</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {problem.topics.join(' · ')}
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
            <SelectItem value="javascript">{t.javascript}</SelectItem>
            <SelectItem value="python">{t.python}</SelectItem>
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
  hintLevel,
  aiLoading,
  messages,
  chatInput,
  chatLoading,
  hasResult,
  onArtifact,
  onChatInput,
  onChatSubmit,
}: {
  copy: (typeof copy)['zh'] | (typeof copy)['en'];
  artifacts: ArtifactView[];
  hintLevel: number;
  aiLoading: string | null;
  messages: CoachMessage[];
  chatInput: string;
  chatLoading: boolean;
  hasResult: boolean;
  onArtifact: (
    action: 'diagnose' | 'hint' | 'counterexample' | 'review_card'
  ) => void;
  onChatInput: (value: string) => void;
  onChatSubmit: (event: FormEvent) => void;
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
              const level = index + 1;
              const revealed = hintLevel >= level;
              const locked = hintLevel < index;
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
                      onClick={() => onArtifact('hint')}
                      disabled={locked || Boolean(aiLoading)}
                    >
                      {aiLoading === 'hint' && !locked ? (
                        <LoaderCircle className="animate-spin" />
                      ) : null}
                      {t.reveal}
                    </Button>
                  ) : (
                    <span className="text-[11px] text-amber-700 dark:text-amber-300">
                      {t.revealed}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {artifacts.length ? (
          <div className="space-y-3 border-b p-4">
            {artifacts.map((artifact) => (
              <div
                key={artifact.type}
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
                  <span>{artifactTitle(artifact.type, t)}</span>
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
            type="submit"
            size="icon-sm"
            className="absolute right-2 bottom-2"
            aria-label={t.send}
            disabled={!chatInput.trim() || chatLoading}
          >
            <Send />
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
  return t.hints;
}

function ClipboardProblemIcon() {
  return <MessageSquareText className="size-4" />;
}
