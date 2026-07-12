'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CodeXml,
  FileInput,
  Filter,
  Search,
  Sparkles,
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

import { problems } from '../data/problems';
import { parseProblemDraft } from '../parser';
import { useCoachStore } from '../store';
import type { Language, ParsedProblemDraft, Problem } from '../types';
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
      '围绕高频算法模式组织练习，完成状态与代码草稿会保存在当前设备。',
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
    demoNotice:
      '导入题在演示模式下只包含题面中明确给出的样例，不会伪造隐藏测试。',
    parseError: '无法解析这段题面，请补充输入、输出和至少一个样例。',
    javascript: 'JavaScript 模板',
    python: 'Python 模板',
  },
  en: {
    title: 'Problem Library',
    description:
      'Practice common algorithm patterns. Completion and code drafts stay on this device.',
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
      'Imported problems only use examples explicitly present in the prompt. Demo mode never invents hidden tests.',
    parseError:
      'This statement could not be parsed. Add inputs, outputs, and at least one example.',
    javascript: 'JavaScript template',
    python: 'Python template',
  },
} as const;

export function ProblemsPage() {
  const locale = localeKey(useLocale());
  const t = copy[locale];
  const router = useRouter();
  const coach = useCoachStore();
  const completedIds = getCompletedProblemIds(coach.state);
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('all');
  const [topic, setTopic] = useState('all');
  const [status, setStatus] = useState('all');
  const [importOpen, setImportOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [draft, setDraft] = useState<ParsedProblemDraft | null>(null);
  const [parsing, setParsing] = useState(false);
  const [templateLanguage, setTemplateLanguage] =
    useState<Language>('javascript');

  const topics = useMemo(
    () =>
      Array.from(new Set(problems.flatMap((problem) => problem.topics))).sort(),
    []
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
  }, [completedIds, difficulty, locale, query, status, topic]);

  async function handleParse() {
    if (statement.trim().length < 20) {
      toast.error(t.parseError);
      return;
    }
    setParsing(true);
    try {
      const parsed = await Promise.resolve(
        parseProblemDraft(statement.trim(), locale)
      );
      setDraft(parsed);
    } catch {
      toast.error(t.parseError);
    } finally {
      setParsing(false);
    }
  }

  function openImportedPractice() {
    if (!draft) return;
    const now = Date.now();
    const imported: Problem = {
      id: `imported-${now}`,
      slug: 'imported-draft',
      title: { zh: draft.title, en: draft.title },
      description: { zh: draft.description, en: draft.description },
      difficulty: draft.difficulty ?? 'medium',
      topics: ['custom'],
      entryPoint: draft.entryPoint,
      templates: draft.templates,
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
    };
    window.localStorage.setItem(
      'algocoach.imported-problem.v1',
      JSON.stringify(imported)
    );
    setImportOpen(false);
    router.push('/practice/imported-draft');
  }

  const visibleTemplate =
    draft?.templates[templateLanguage] ??
    (templateLanguage === 'javascript'
      ? 'function solve(input) {\n  // TODO\n}'
      : 'def solve(input):\n    # TODO\n    pass');

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
                    <p className="text-sm font-semibold">{t.draft}</p>
                  </div>
                  <dl className="grid gap-4 p-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t.difficulty}
                      </dt>
                      <dd className="mt-1 text-sm font-medium">
                        {difficultyLabel(
                          String(draft.difficulty ?? 'medium'),
                          locale
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        {t.entryPoint}
                      </dt>
                      <dd className="mt-1 font-mono text-sm">
                        {String(draft.entryPoint ?? 'solve')}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground text-xs">
                        {t.constraints}
                      </dt>
                      <dd className="mt-1 text-sm leading-6">
                        {(draft.constraints ?? []).length
                          ? (draft.constraints as unknown[])
                              .map((item) => localized(item, locale))
                              .join(' · ')
                          : '—'}
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
                        <SelectItem value="javascript">
                          {t.javascript}
                        </SelectItem>
                        <SelectItem value="python">{t.python}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <pre className="bg-muted/40 max-h-48 overflow-auto py-4 text-xs leading-5">
                    <code>{visibleTemplate}</code>
                  </pre>
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
                  {item}
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
                      {item}
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                  <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                    <CodeXml className="size-3.5" />
                    {problem.entryPoint}
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
