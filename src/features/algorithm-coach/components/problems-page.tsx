'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CodeXml,
  ExternalLink,
  FileInput,
  Filter,
  LockKeyhole,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';

import { Link, useRouter } from '@/core/i18n/navigation';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';
import { cn } from '@/shared/lib/utils';

import { createImportedDraftSlug } from '../imported-drafts';
import {
  getProblemEntryPoint,
  getProblemTemplate,
  LANGUAGE_REGISTRY,
  normalizeProblemLanguageConfigs,
} from '../languages';
import { TOPIC_LABELS } from '../learning-progress';
import { parseProblemDraft } from '../parser';
import { useCoachStore } from '../store';
import type {
  CoachResponse,
  Language,
  ParsedProblemDraft,
  Problem,
} from '../types';
import { CoachPage, EmptyState, InlineNotice } from './coach-ui';
import {
  difficultyLabel,
  getCompletedProblemIds,
  localeKey,
  localized,
  localizedProblem,
} from './domain-adapter';

const copy = {
  zh: {
    title: '算法题库',
    description:
      '围绕高频算法模式组织练习；登录后，完成状态与代码草稿会同步到云端。',
    import: '导入题目',
    search: '搜索题目、知识点',
    allDifficulty: '全部难度',
    allTopics: '全部知识点',
    allStatus: '全部状态',
    todo: '待完成',
    completed: '已完成',
    results: '道题',
    practice: '进入练习',
    continue: '继续练习',
    empty: '没有匹配的题目',
    emptyDetail: '调整筛选条件或清空搜索词后再试。',
    importTitle: '从题面创建练习草稿',
    importDescription:
      '粘贴完整题面，系统会提取难度、约束、函数签名和初始模板。',
    statement: '题目内容',
    statementPlaceholder:
      '示例：给定一个整数数组 nums 和目标值 target，请返回两个数的下标……',
    parse: '解析题面',
    parsing: '解析中…',
    draft: '解析草稿',
    difficulty: '建议难度',
    entryPoint: '函数签名',
    constraints: '约束',
    template: '初始模板',
    confirm: '确认并练习',
    edit: '继续编辑',
    demoNotice: '导入题只包含题面中明确给出的样例，系统不会伪造隐藏测试。',
    parseError: '无法解析这段题面，请补充输入、输出和至少一个样例。',
    javascript: 'JavaScript 模板',
    python: 'Python 模板',
    onlineParse: '在线 AI 解析',
    localParse: '本地规则解析',
    sampleTests: '已确认样例测试',
    testArgs: '参数数组（JSON）',
    testExpected: '期望输出（JSON）',
    addTest: '添加样例',
    invalidTest: '参数必须是 JSON 数组，期望输出必须是有效 JSON。',
    noTests: '尚未添加可验证样例；练习页中的运行与提交将保持关闭。',
    removeTest: '删除样例',
    sourceUrl: '题目来源链接（可选）',
    invalidSourceUrl: '题目来源必须是有效的 HTTP 或 HTTPS 链接。',
    draftsTitle: '我的导入草稿',
    draftsDescription: '草稿仅保存在当前访客或账号空间，最多保留 20 道。',
    privateDraft: '私有草稿',
    openDraft: '打开草稿',
    deleteDraft: '删除草稿',
    deleteConfirm: '确定删除这道导入草稿吗？此操作无法撤销。',
    draftDeleted: '导入草稿已删除。',
    source: '查看来源',
    testCount: '个样例',
  },
  en: {
    title: 'Problem Library',
    description:
      'Practice common algorithm patterns. Sign in to sync completion and code drafts to the cloud.',
    import: 'Import problem',
    search: 'Search problems or topics',
    allDifficulty: 'All difficulties',
    allTopics: 'All topics',
    allStatus: 'All statuses',
    todo: 'To do',
    completed: 'Completed',
    results: 'problems',
    practice: 'Start practice',
    continue: 'Continue',
    empty: 'No matching problems',
    emptyDetail: 'Change the filters or clear the search query and try again.',
    importTitle: 'Create a practice draft from a prompt',
    importDescription:
      'Paste the full prompt to extract difficulty, constraints, function signature, and starter code.',
    statement: 'Problem statement',
    statementPlaceholder:
      'Example: Given an integer array nums and a target value, return the indices of two numbers…',
    parse: 'Parse statement',
    parsing: 'Parsing…',
    draft: 'Parsed draft',
    difficulty: 'Suggested difficulty',
    entryPoint: 'Function signature',
    constraints: 'Constraints',
    template: 'Starter template',
    confirm: 'Confirm and practice',
    edit: 'Keep editing',
    demoNotice:
      'Imported problems only use examples explicitly present in the prompt. The system never invents hidden tests.',
    parseError:
      'This statement could not be parsed. Add inputs, outputs, and at least one example.',
    javascript: 'JavaScript template',
    python: 'Python template',
    onlineParse: 'Live AI parse',
    localParse: 'Local rule-based parse',
    sampleTests: 'Confirmed example tests',
    testArgs: 'Argument array (JSON)',
    testExpected: 'Expected output (JSON)',
    addTest: 'Add example',
    invalidTest:
      'Arguments must be a JSON array and expected output must be valid JSON.',
    noTests:
      'No verified examples yet. Run and submit remain disabled in practice.',
    removeTest: 'Remove example',
    sourceUrl: 'Problem source URL (optional)',
    invalidSourceUrl: 'The problem source must be a valid HTTP or HTTPS URL.',
    draftsTitle: 'My imported drafts',
    draftsDescription:
      'Drafts stay private to this visitor or account space. Up to 20 are kept.',
    privateDraft: 'Private draft',
    openDraft: 'Open draft',
    deleteDraft: 'Delete draft',
    deleteConfirm: 'Delete this imported draft? This action cannot be undone.',
    draftDeleted: 'Imported draft deleted.',
    source: 'View source',
    testCount: 'examples',
  },
} as const;

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function ProblemsPage() {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const router = useRouter();
  const coach = useCoachStore();
  const problems = coach.problems;
  const enabledLanguages = coach.enabledLanguages;
  const completedIds = getCompletedProblemIds(coach.state);
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('all');
  const [topic, setTopic] = useState('all');
  const [status, setStatus] = useState('all');
  const [importOpen, setImportOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [draft, setDraft] = useState<ParsedProblemDraft | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseMode, setParseMode] = useState<'live' | 'local' | null>(null);
  const [sampleArgs, setSampleArgs] = useState('[]');
  const [sampleExpected, setSampleExpected] = useState('null');
  const [sourceUrl, setSourceUrl] = useState('');
  const [templateLanguage, setTemplateLanguage] =
    useState<Language>('javascript');
  const importedDrafts = coach.importedDrafts;

  const topics = useMemo(
    () =>
      Array.from(new Set(problems.flatMap((problem) => problem.topics))).sort(),
    [problems]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return problems.filter((problem) => {
      const text = localizedProblem(problem, locale);
      const completed =
        completedIds.has(problem.id) || completedIds.has(problem.slug);
      return (
        (!normalizedQuery ||
          text.titleText.toLowerCase().includes(normalizedQuery) ||
          text.descriptionText.toLowerCase().includes(normalizedQuery) ||
          problem.topics.some((item) =>
            item.toLowerCase().includes(normalizedQuery)
          )) &&
        (difficulty === 'all' || problem.difficulty === difficulty) &&
        (topic === 'all' || problem.topics.includes(topic)) &&
        (status === 'all' || (status === 'completed' ? completed : !completed))
      );
    });
  }, [completedIds, difficulty, locale, problems, query, status, topic]);

  async function handleParse() {
    if (statement.trim().length < 20) {
      toast.error(t.parseError);
      return;
    }
    setParsing(true);
    try {
      const localDraft = parseProblemDraft(statement.trim(), locale);
      try {
        const response = await fetch('/api/coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'parse',
            statement: statement.trim(),
            locale,
          }),
        });
        if (!response.ok) throw new Error('parse_unavailable');
        const payload = (await response.json()) as CoachResponse;
        setDraft(payload.artifact.draft ?? localDraft);
        setParseMode(payload.mode);
      } catch {
        setDraft(localDraft);
        setParseMode('local');
      }
    } catch {
      toast.error(t.parseError);
    } finally {
      setParsing(false);
    }
  }

  function addSampleTest() {
    if (!draft) return;
    try {
      const args = JSON.parse(sampleArgs) as unknown;
      const expected = JSON.parse(sampleExpected) as unknown;
      if (!Array.isArray(args)) throw new Error('args_not_array');
      setDraft({
        ...draft,
        tests: [
          ...draft.tests,
          {
            id: `imported-test-${crypto.randomUUID()}`,
            args: args as never[],
            expected: expected as never,
            isSample: true,
          },
        ],
      });
    } catch {
      toast.error(t.invalidTest);
    }
  }

  function openImportedPractice() {
    if (!draft || !coach.storageScope) return;
    let normalizedSourceUrl: string | undefined;
    if (sourceUrl.trim()) {
      try {
        const parsedSourceUrl = new URL(sourceUrl.trim());
        if (!['http:', 'https:'].includes(parsedSourceUrl.protocol)) {
          throw new Error('unsupported_protocol');
        }
        normalizedSourceUrl = parsedSourceUrl.toString();
      } catch {
        toast.error(t.invalidSourceUrl);
        return;
      }
    }
    const now = Date.now();
    const importedId = crypto.randomUUID();
    const importedSlug = createImportedDraftSlug(importedDrafts, now);
    const imported: Problem & {
      sourceStatement?: string;
      sourceUrl?: string;
    } = {
      id: `imported-${importedId}`,
      slug: importedSlug,
      title: { zh: draft.title, en: draft.title },
      description: { zh: draft.description, en: draft.description },
      difficulty: draft.difficulty ?? 'medium',
      topics: ['custom'],
      entryPoint: draft.entryPoint,
      templates: draft.templates,
      languageConfigs: normalizeProblemLanguageConfigs({
        entryPoint: draft.entryPoint,
        templates: draft.templates,
      }),
      tests: draft.tests,
      examples: [],
      constraints: draft.constraints.map((constraint) => ({
        zh: constraint,
        en: constraint,
      })),
      hints: {
        zh: ['', '', ''],
        en: ['', '', ''],
      },
      reviewPoints: [],
      estimatedMinutes: 20,
      sourceStatement: statement.trim(),
      sourceUrl: normalizedSourceUrl,
    };
    coach.saveImportedProblem(imported);
    coach.trackEvent('imported_problem_saved', {
      problemSlug: imported.slug,
      properties: {
        parserMode: parseMode ?? 'local',
        verifiedSampleCount: imported.tests.length,
        hasSourceUrl: Boolean(normalizedSourceUrl),
      },
    });
    setImportOpen(false);
    setStatement('');
    setDraft(null);
    setSourceUrl('');
    router.push(`/practice/${imported.slug}`);
  }

  function removeImportedDraft(slug: string) {
    if (!coach.storageScope || !window.confirm(t.deleteConfirm)) return;
    coach.deleteImportedProblem(slug);
    toast.success(t.draftDeleted);
  }

  const visibleTemplate = draft
    ? getProblemTemplate(draft, templateLanguage)
    : '';

  return (
    <CoachPage
      title={t.title}
      description={t.description}
      actions={
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button>
              <FileInput />
              {t.import}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t.importTitle}</DialogTitle>
              <DialogDescription>{t.importDescription}</DialogDescription>
            </DialogHeader>
            {!draft ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="problem-statement"
                    className="text-sm font-medium"
                  >
                    {t.statement}
                  </label>
                  <Textarea
                    id="problem-statement"
                    value={statement}
                    onChange={(event) => setStatement(event.target.value)}
                    placeholder={t.statementPlaceholder}
                    className="min-h-64 resize-y rounded-md font-mono text-xs leading-5"
                  />
                </div>
                <InlineNotice>{t.demoNotice}</InlineNotice>
                <DialogFooter>
                  <Button onClick={handleParse} disabled={parsing}>
                    <Sparkles />
                    {parsing ? t.parsing : t.parse}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border">
                  <div className="border-b px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{t.draft}</p>
                      {parseMode ? (
                        <Badge variant="outline" className="rounded-md">
                          {parseMode === 'live' ? t.onlineParse : t.localParse}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <dl className="grid gap-4 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <dt className="text-muted-foreground text-xs">
                        {t.statement}
                      </dt>
                      <dd>
                        <Input
                          value={draft.title}
                          onChange={(event) =>
                            setDraft({ ...draft, title: event.target.value })
                          }
                          className="rounded-md"
                        />
                      </dd>
                    </div>
                    <div className="space-y-1.5">
                      <dt className="text-muted-foreground text-xs">
                        {t.difficulty}
                      </dt>
                      <dd>
                        <Select
                          value={draft.difficulty}
                          onValueChange={(value) =>
                            setDraft({
                              ...draft,
                              difficulty:
                                value as ParsedProblemDraft['difficulty'],
                            })
                          }
                        >
                          <SelectTrigger className="w-full rounded-md">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(['easy', 'medium', 'hard'] as const).map(
                              (value) => (
                                <SelectItem key={value} value={value}>
                                  {difficultyLabel(value, locale)}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </dd>
                    </div>
                    <div className="space-y-1.5">
                      <dt className="text-muted-foreground text-xs">
                        {t.entryPoint}
                      </dt>
                      <dd>
                        <Input
                          value={draft.entryPoint ?? ''}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              entryPoint: event.target.value,
                            })
                          }
                          className="rounded-md font-mono"
                        />
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground text-xs">
                        {t.constraints}
                      </dt>
                      <dd className="mt-1">
                        <Textarea
                          value={(draft.constraints ?? [])
                            .map((item) => localized(item, locale))
                            .join('\n')}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              constraints: event.target.value
                                .split('\n')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            })
                          }
                          className="min-h-24 rounded-md text-xs leading-5"
                        />
                      </dd>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <dt className="text-muted-foreground text-xs">
                        {t.sourceUrl}
                      </dt>
                      <dd>
                        <Input
                          type="url"
                          value={sourceUrl}
                          onChange={(event) => setSourceUrl(event.target.value)}
                          placeholder="https://"
                          className="rounded-md"
                        />
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                    <p className="text-sm font-semibold">{t.template}</p>
                    <Select
                      value={templateLanguage}
                      onValueChange={(value) =>
                        setTemplateLanguage(value as Language)
                      }
                    >
                      <SelectTrigger size="sm" className="rounded-md">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {enabledLanguages.map((languageId) => (
                          <SelectItem key={languageId} value={languageId}>
                            {LANGUAGE_REGISTRY[languageId].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    value={visibleTemplate}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        templates: {
                          javascript: draft.templates?.javascript ?? '',
                          python: draft.templates?.python ?? '',
                          ...draft.templates,
                          [templateLanguage]: event.target.value,
                        },
                      })
                    }
                    className="bg-muted/40 min-h-44 rounded-none border-0 font-mono text-xs leading-5 shadow-none focus-visible:ring-0"
                  />
                </div>
                <div className="rounded-lg border">
                  <div className="border-b px-4 py-3">
                    <p className="text-sm font-semibold">{t.sampleTests}</p>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        value={sampleArgs}
                        onChange={(event) => setSampleArgs(event.target.value)}
                        placeholder={t.testArgs}
                        aria-label={t.testArgs}
                        className="rounded-md font-mono text-xs"
                      />
                      <Input
                        value={sampleExpected}
                        onChange={(event) =>
                          setSampleExpected(event.target.value)
                        }
                        placeholder={t.testExpected}
                        aria-label={t.testExpected}
                        className="rounded-md font-mono text-xs"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addSampleTest}
                    >
                      <CodeXml />
                      {t.addTest}
                    </Button>
                    {draft.tests.length ? (
                      <div className="divide-y rounded-md border">
                        {draft.tests.map((test, index) => (
                          <div
                            key={test.id}
                            className="flex min-w-0 items-center gap-3 px-3 py-2"
                          >
                            <code className="min-w-0 flex-1 truncate text-xs">
                              {JSON.stringify(test.args)} →{' '}
                              {JSON.stringify(test.expected)}
                            </code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t.removeTest}
                              title={t.removeTest}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  tests: draft.tests.filter(
                                    (_, itemIndex) => itemIndex !== index
                                  ),
                                })
                              }
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs leading-5">
                        {t.noTests}
                      </p>
                    )}
                  </div>
                </div>
                <InlineNotice>{t.demoNotice}</InlineNotice>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDraft(null)}>
                    {t.edit}
                  </Button>
                  <Button onClick={openImportedPractice}>
                    {t.confirm}
                    <ArrowRight />
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      }
    >
      {importedDrafts.length ? (
        <section
          className="border-b pb-5"
          aria-labelledby="imported-drafts-title"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="imported-drafts-title"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <LockKeyhole className="text-primary size-4" />
                {t.draftsTitle}
              </h2>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                {t.draftsDescription}
              </p>
            </div>
            <Badge variant="outline" className="rounded-md">
              {importedDrafts.length} / 20
            </Badge>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {importedDrafts.map((record) => {
              const importedText = localizedProblem(record.problem, locale);
              const externalSourceUrl = safeHttpUrl(record.problem.sourceUrl);
              return (
                <article
                  key={record.problem.id}
                  className="bg-card flex min-w-0 items-center gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="truncate text-sm font-medium">
                        {importedText.titleText}
                      </h3>
                      <Badge
                        variant="secondary"
                        className="shrink-0 rounded-md text-[10px]"
                      >
                        {t.privateDraft}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-xs">
                      <span>
                        {difficultyLabel(record.problem.difficulty, locale)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {record.problem.tests.length} {t.testCount}
                      </span>
                      {externalSourceUrl ? (
                        <a
                          href={externalSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground inline-flex min-w-0 items-center gap-1"
                        >
                          <ExternalLink className="size-3 shrink-0" />
                          <span className="truncate">{t.source}</span>
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <Button asChild size="icon-sm" variant="outline">
                    <Link
                      href={`/practice/${record.problem.slug}`}
                      aria-label={`${t.openDraft}: ${importedText.titleText}`}
                      title={t.openDraft}
                    >
                      <ArrowRight />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t.deleteDraft}: ${importedText.titleText}`}
                    title={t.deleteDraft}
                    onClick={() => removeImportedDraft(record.problem.slug)}
                  >
                    <Trash2 />
                  </Button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-3 border-y py-4 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1 lg:max-w-md">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.search}
            className="w-full rounded-md pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="w-full rounded-md lg:w-40">
              <Filter className="size-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.allDifficulty}</SelectItem>
              <SelectItem value="easy">
                {difficultyLabel('easy', locale)}
              </SelectItem>
              <SelectItem value="medium">
                {difficultyLabel('medium', locale)}
              </SelectItem>
              <SelectItem value="hard">
                {difficultyLabel('hard', locale)}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={topic} onValueChange={setTopic}>
            <SelectTrigger className="w-full rounded-md lg:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.allTopics}</SelectItem>
              {topics.map((item) => (
                <SelectItem key={item} value={item}>
                  {TOPIC_LABELS[item as keyof typeof TOPIC_LABELS]?.[locale] ??
                    item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="col-span-2 w-full rounded-md sm:col-span-1 lg:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.allStatus}</SelectItem>
              <SelectItem value="todo">{t.todo}</SelectItem>
              <SelectItem value="completed">{t.completed}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="text-muted-foreground mt-4 flex items-center justify-between text-sm">
        <span>
          {filtered.length} {t.results}
        </span>
      </div>

      {filtered.length ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((problem) => {
            const text = localizedProblem(problem, locale);
            const completed =
              completedIds.has(problem.id) || completedIds.has(problem.slug);
            return (
              <article
                key={problem.id}
                className="bg-card hover:border-primary/40 flex min-h-64 flex-col rounded-lg border p-5 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <Badge
                    variant="outline"
                    className={cn(
                      'rounded-md',
                      problem.difficulty === 'easy' &&
                        'border-emerald-500/35 text-emerald-700 dark:text-emerald-300',
                      problem.difficulty === 'medium' &&
                        'border-amber-500/35 text-amber-700 dark:text-amber-300',
                      problem.difficulty === 'hard' &&
                        'border-red-500/35 text-red-700 dark:text-red-300'
                    )}
                  >
                    {difficultyLabel(problem.difficulty, locale)}
                  </Badge>
                  {completed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-4" />
                      {t.completed}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-4 text-base font-semibold">
                  {text.titleText}
                </h2>
                <p className="text-muted-foreground mt-2 line-clamp-3 text-sm leading-6">
                  {text.descriptionText}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {problem.topics.slice(0, 3).map((item) => (
                    <Badge
                      key={item}
                      variant="secondary"
                      className="rounded-md font-normal"
                    >
                      {TOPIC_LABELS[item as keyof typeof TOPIC_LABELS]?.[
                        locale
                      ] ?? item}
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                  <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                    <CodeXml className="size-3.5" />
                    {getProblemEntryPoint(problem, 'javascript')}
                  </span>
                  <Button
                    asChild
                    size="sm"
                    variant={completed ? 'outline' : 'default'}
                  >
                    <Link href={`/practice/${problem.slug}`}>
                      {completed ? t.continue : t.practice}
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border">
          <EmptyState
            title={t.empty}
            description={t.emptyDetail}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setDifficulty('all');
                  setTopic('all');
                  setStatus('all');
                }}
              >
                {t.allStatus}
              </Button>
            }
          />
        </div>
      )}
    </CoachPage>
  );
}
