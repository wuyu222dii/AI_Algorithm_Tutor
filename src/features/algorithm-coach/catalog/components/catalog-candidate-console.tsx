'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  FileDiff,
  Link2,
  Loader2,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
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

type CandidateStatus =
  | 'discovered'
  | 'drafting'
  | 'quarantined'
  | 'validated'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'archived';

interface CandidateSummary {
  id: string;
  externalId: string;
  status: CandidateStatus;
  changeKind?: string;
  draftRevision: number;
  sourceRevision: string;
  updatedAt: string;
  title?: { zh?: string; en?: string };
}

interface CandidateDetail extends CandidateSummary {
  upstreamUrl: string;
  contentHash: string;
  licenseSpdx: string;
  attribution: string;
  upstreamPayload: unknown;
  draftProblem: unknown;
  validation: {
    valid?: boolean;
    issues?: Array<{ code: string; message: string; path?: string }>;
  };
  approval?: { approvedByUserId?: string; approvedAt?: string };
  targetProblemSlug?: string;
  evidence?: Record<string, unknown>;
}

interface Capabilities {
  review: boolean;
  publish: boolean;
  rollback: boolean;
}

const STATUS_OPTIONS: CandidateStatus[] = [
  'discovered',
  'drafting',
  'quarantined',
  'validated',
  'approved',
  'published',
  'rejected',
  'archived',
];

function requestKey(action: string): string {
  return `${action}:${crypto.randomUUID()}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function problemSlugFromDraft(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const slug = (value as { slug?: unknown }).slug;
  return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? slug
    : undefined;
}

function statusTone(status: CandidateStatus): string {
  if (status === 'published')
    return 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'validated' || status === 'approved')
    return 'border-teal-600/30 bg-teal-600/10 text-teal-700 dark:text-teal-300';
  if (status === 'rejected')
    return 'border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300';
  if (status === 'quarantined')
    return 'border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-300';
  return 'border-border bg-muted text-muted-foreground';
}

class ApiResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data === undefined) {
    throw new ApiResponseError(
      payload.error?.message || `Request failed (${response.status})`,
      response.status
    );
  }
  return payload.data;
}

export function CatalogCandidateConsole({ locale }: { locale: string }) {
  const zh = locale === 'zh';
  const [items, setItems] = useState<CandidateSummary[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>({
    review: false,
    publish: false,
    rollback: false,
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<CandidateDetail>();
  const [status, setStatus] = useState<string>('pending');
  const [query, setQuery] = useState('');
  const [draftText, setDraftText] = useState('');
  const [targetProblemSlug, setTargetProblemSlug] = useState('');
  const [notes, setNotes] = useState('');
  const [rollbackVersion, setRollbackVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [action, setAction] = useState<string>();
  const mutationAttempt = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);

  const loadList = useCallback(
    async (signal?: AbortSignal) => {
      const requestSequence = ++listRequestSequence.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '100' });
        if (status !== 'all') params.set('status', status);
        const data = await responseData<{
          items: CandidateSummary[];
          capabilities: Capabilities;
        }>(
          await fetch(`/api/admin/catalog/candidates?${params}`, {
            cache: 'no-store',
            signal,
          })
        );
        if (
          signal?.aborted ||
          requestSequence !== listRequestSequence.current
        ) {
          return;
        }
        setItems(data.items);
        setCapabilities(data.capabilities);
        setSelectedId((current) =>
          current && data.items.some((item) => item.id === current)
            ? current
            : data.items[0]?.id
        );
        return data.items;
      } catch (error) {
        if (
          isAbortError(error) ||
          requestSequence !== listRequestSequence.current
        ) {
          return;
        }
        toast.error(
          error instanceof Error ? error.message : 'Catalog unavailable'
        );
      } finally {
        if (
          !signal?.aborted &&
          requestSequence === listRequestSequence.current
        ) {
          setLoading(false);
        }
      }
    },
    [status]
  );

  const loadDetail = useCallback(
    async (candidateId: string, signal?: AbortSignal) => {
      const requestSequence = ++detailRequestSequence.current;
      setDetailLoading(true);
      try {
        const data = await responseData<CandidateDetail>(
          await fetch(
            `/api/admin/catalog/candidates/${encodeURIComponent(candidateId)}`,
            { cache: 'no-store', signal }
          )
        );
        if (
          signal?.aborted ||
          requestSequence !== detailRequestSequence.current
        ) {
          return;
        }
        setDetail(data);
        setDraftText(JSON.stringify(data.draftProblem, null, 2));
        setTargetProblemSlug(data.targetProblemSlug ?? '');
        setNotes('');
        setRollbackVersion('');
      } catch (error) {
        if (
          isAbortError(error) ||
          requestSequence !== detailRequestSequence.current
        ) {
          return;
        }
        toast.error(
          error instanceof Error ? error.message : 'Candidate unavailable'
        );
        setDetail(undefined);
      } finally {
        if (
          !signal?.aborted &&
          requestSequence === detailRequestSequence.current
        ) {
          setDetailLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadList(controller.signal));
    return () => controller.abort();
  }, [loadList]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void Promise.resolve().then(() =>
      loadDetail(selectedId, controller.signal)
    );
    return () => controller.abort();
  }, [loadDetail, selectedId]);

  const selectedDetail = detail?.id === selectedId ? detail : undefined;
  const upstreamUrl = selectedDetail
    ? safeExternalUrl(selectedDetail.upstreamUrl)
    : undefined;
  const selectedProblemSlug = selectedDetail
    ? problemSlugFromDraft(selectedDetail.draftProblem)
    : undefined;

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [item.externalId, item.title?.zh, item.title?.en]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized))
    );
  }, [items, query]);

  async function mutate(
    operation:
      | 'save'
      | 'associate'
      | 'validate'
      | 'approve'
      | 'reject'
      | 'publish'
      | 'rollback'
  ) {
    if (!selectedDetail) return;
    if (operation === 'reject' && !notes.trim()) {
      toast.error(
        zh ? '拒绝候选前请填写审核说明' : 'Add review notes before rejecting'
      );
      return;
    }
    if (
      operation === 'rollback' &&
      (!selectedProblemSlug ||
        !Number.isInteger(Number(rollbackVersion)) ||
        Number(rollbackVersion) < 1 ||
        !notes.trim())
    ) {
      toast.error(
        zh
          ? '回滚前请填写有效目标版本和审核说明'
          : 'Add a valid target version and review notes before rollback'
      );
      return;
    }
    setAction(operation);
    try {
      let method = 'POST';
      let endpoint = `/api/admin/catalog/candidates/${selectedDetail.id}/${operation}`;
      let body: Record<string, unknown> = { notes };
      if (operation === 'save') {
        method = 'PATCH';
        endpoint = `/api/admin/catalog/candidates/${selectedDetail.id}`;
        body = {
          draftProblem: JSON.parse(draftText),
          expectedDraftRevision: selectedDetail.draftRevision,
        };
      } else if (operation === 'associate') {
        method = 'PATCH';
        endpoint = `/api/admin/catalog/candidates/${selectedDetail.id}`;
        body = {
          targetProblemSlug: targetProblemSlug.trim() || null,
          expectedDraftRevision: selectedDetail.draftRevision,
        };
      } else if (operation === 'rollback') {
        endpoint = '/api/admin/catalog/rollback';
        body = {
          slug: selectedProblemSlug,
          targetVersion: Number(rollbackVersion),
          notes,
        };
      }
      const serializedBody = JSON.stringify(body);
      const fingerprint = `${method}:${endpoint}:${serializedBody}`;
      if (mutationAttempt.current?.fingerprint !== fingerprint) {
        mutationAttempt.current = {
          fingerprint,
          idempotencyKey: requestKey(operation),
        };
      }
      await responseData(
        await fetch(endpoint, {
          method,
          headers: {
            'content-type': 'application/json',
            'idempotency-key': mutationAttempt.current.idempotencyKey,
          },
          body: serializedBody,
        })
      );
      mutationAttempt.current = null;
      toast.success(zh ? '操作已完成' : 'Operation completed');
      const refreshedItems = await loadList();
      if (refreshedItems?.some((item) => item.id === selectedDetail.id)) {
        await loadDetail(selectedDetail.id);
      }
    } catch (error) {
      if (error instanceof ApiResponseError && error.status < 500) {
        mutationAttempt.current = null;
      }
      toast.error(error instanceof Error ? error.message : 'Operation failed');
    } finally {
      setAction(undefined);
    }
  }

  return (
    <div className="flex min-h-0 max-w-full min-w-0 flex-1 flex-col gap-4 overflow-x-hidden">
      <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1 md:max-w-md">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4" />
          <Input
            aria-label={zh ? '搜索候选题目' : 'Search catalog candidates'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              zh ? '搜索题目或上游 ID' : 'Search title or upstream ID'
            }
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger
            aria-label={zh ? '筛选候选状态' : 'Filter candidate status'}
            className="w-full md:w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">{zh ? '待处理' : 'Pending'}</SelectItem>
            <SelectItem value="all">
              {zh ? '全部状态' : 'All statuses'}
            </SelectItem>
            {STATUS_OPTIONS.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          aria-label={zh ? '刷新候选列表' : 'Refresh candidates'}
          variant="outline"
          size="icon"
          onClick={() => void loadList()}
          disabled={loading}
          title={zh ? '刷新' : 'Refresh'}
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </div>

      <div className="grid min-h-[640px] w-full max-w-full min-w-0 flex-1 overflow-hidden border md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b md:border-r md:border-b-0">
          <div className="border-b px-4 py-3 text-sm font-medium">
            {zh
              ? `${visibleItems.length} 个候选`
              : `${visibleItems.length} candidates`}
          </div>
          <div className="max-h-72 overflow-y-auto md:max-h-[760px]">
            {loading ? (
              <div
                aria-live="polite"
                className="text-muted-foreground flex items-center gap-2 p-4 text-sm"
              >
                <Loader2 className="size-4 animate-spin" />
                {zh ? '加载中' : 'Loading'}
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="text-muted-foreground p-6 text-center text-sm">
                {zh ? '没有符合条件的候选' : 'No matching candidates'}
              </div>
            ) : (
              visibleItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selectedId === item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full border-b px-4 py-3 text-left transition-colors ${
                    selectedId === item.id
                      ? 'bg-teal-500/10'
                      : 'hover:bg-muted/60'
                  }`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {item.title?.zh || item.title?.en || item.externalId}
                    </span>
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[10px] ${statusTone(item.status)}`}
                    >
                      {item.status}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {item.externalId} · v{item.draftRevision}
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="min-w-0 overflow-y-auto">
          {detailLoading ? (
            <div
              aria-live="polite"
              className="text-muted-foreground flex h-64 items-center justify-center gap-2"
            >
              <Loader2 className="size-5 animate-spin" />
              {zh ? '读取候选详情' : 'Loading candidate'}
            </div>
          ) : !selectedDetail ? (
            <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-2 px-4 text-center text-sm">
              <FileDiff className="size-6" />
              {zh ? '选择一个候选开始审核' : 'Select a candidate to review'}
            </div>
          ) : (
            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 flex-col gap-3 border-b p-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="min-w-0 text-lg font-semibold break-words">
                      {selectedDetail.title?.zh ||
                        selectedDetail.title?.en ||
                        selectedDetail.externalId}
                    </h2>
                    <Badge
                      variant="outline"
                      className={statusTone(selectedDetail.status)}
                    >
                      {selectedDetail.status}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs break-all">
                    {selectedDetail.externalId} ·{' '}
                    {selectedDetail.sourceRevision.slice(0, 12)} ·{' '}
                    {selectedDetail.changeKind || 'update'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !capabilities.review ||
                      !['discovered', 'drafting', 'quarantined'].includes(
                        selectedDetail.status
                      ) ||
                      Boolean(action)
                    }
                    onClick={() => void mutate('validate')}
                  >
                    <ShieldCheck className="size-4" />
                    {zh ? '重新校验' : 'Validate'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !capabilities.review ||
                      selectedDetail.status !== 'validated' ||
                      Boolean(action)
                    }
                    onClick={() => void mutate('approve')}
                  >
                    <Check className="size-4" />
                    {zh ? '批准' : 'Approve'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !capabilities.publish ||
                      selectedDetail.status !== 'approved' ||
                      Boolean(action)
                    }
                    onClick={() => void mutate('publish')}
                  >
                    <Rocket className="size-4" />
                    {zh ? '发布' : 'Publish'}
                  </Button>
                </div>
              </div>

              <Tabs defaultValue="draft" className="min-w-0 p-4">
                <TabsList className="grid w-full grid-cols-3 md:w-auto md:grid-flow-col md:grid-cols-none">
                  <TabsTrigger value="draft">
                    {zh ? '内容草稿' : 'Draft'}
                  </TabsTrigger>
                  <TabsTrigger value="evidence">
                    {zh ? '来源证据' : 'Evidence'}
                  </TabsTrigger>
                  <TabsTrigger value="validation">
                    {zh ? '校验结果' : 'Validation'}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="draft" className="mt-4 space-y-4">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="catalog-draft">
                      {zh ? '结构化题目草稿' : 'Structured problem draft'}
                    </Label>
                    <Textarea
                      id="catalog-draft"
                      value={draftText}
                      onChange={(event) => setDraftText(event.target.value)}
                      spellCheck={false}
                      className="min-h-[420px] max-w-full resize-y font-mono text-xs leading-5"
                      disabled={!capabilities.review}
                    />
                  </div>
                  <div className="grid min-w-0 gap-2 border-y py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="catalog-target-problem">
                        {zh ? '已有题目 slug' : 'Existing problem slug'}
                      </Label>
                      <Input
                        id="catalog-target-problem"
                        value={targetProblemSlug}
                        onChange={(event) =>
                          setTargetProblemSlug(event.target.value)
                        }
                        maxLength={180}
                        spellCheck={false}
                        placeholder="exercism-two-fer"
                        disabled={
                          !capabilities.review ||
                          ['approved', 'published', 'archived'].includes(
                            selectedDetail.status
                          )
                        }
                      />
                    </div>
                    <Button
                      variant="outline"
                      disabled={
                        !capabilities.review ||
                        ['approved', 'published', 'archived'].includes(
                          selectedDetail.status
                        ) ||
                        Boolean(action)
                      }
                      onClick={() => void mutate('associate')}
                    >
                      <Link2 className="size-4" />
                      {targetProblemSlug.trim()
                        ? zh
                          ? '关联题目'
                          : 'Link problem'
                        : zh
                          ? '解除关联'
                          : 'Clear link'}
                    </Button>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="catalog-notes">
                      {zh ? '审核说明' : 'Review notes'}
                    </Label>
                    <Textarea
                      id="catalog-notes"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      maxLength={2000}
                      className="max-w-full"
                      placeholder={
                        zh
                          ? '记录翻译、测试或发布判断依据'
                          : 'Record translation, test, or release rationale'
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={
                        !capabilities.review ||
                        ['approved', 'published', 'archived'].includes(
                          selectedDetail.status
                        ) ||
                        Boolean(action)
                      }
                      onClick={() => void mutate('save')}
                    >
                      <Save className="size-4" />
                      {zh ? '保存草稿' : 'Save draft'}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={
                        !capabilities.review ||
                        !notes.trim() ||
                        ['published', 'rejected', 'archived'].includes(
                          selectedDetail.status
                        ) ||
                        Boolean(action)
                      }
                      onClick={() => void mutate('reject')}
                    >
                      <X className="size-4" />
                      {zh ? '拒绝候选' : 'Reject'}
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="evidence" className="mt-4 space-y-4">
                  <dl className="grid min-w-0 gap-3 text-sm md:grid-cols-[160px_minmax(0,1fr)]">
                    <dt className="text-muted-foreground">License</dt>
                    <dd className="min-w-0 break-words">
                      {selectedDetail.licenseSpdx}
                    </dd>
                    <dt className="text-muted-foreground">Attribution</dt>
                    <dd className="min-w-0 break-words">
                      {selectedDetail.attribution}
                    </dd>
                    <dt className="text-muted-foreground">Content hash</dt>
                    <dd className="min-w-0 font-mono text-xs break-all">
                      {selectedDetail.contentHash}
                    </dd>
                    <dt className="text-muted-foreground">Upstream</dt>
                    <dd className="min-w-0 break-all">
                      {upstreamUrl ? (
                        <a
                          className="text-teal-700 underline underline-offset-4 dark:text-teal-300"
                          href={upstreamUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {selectedDetail.upstreamUrl}
                        </a>
                      ) : (
                        <span>{selectedDetail.upstreamUrl}</span>
                      )}
                    </dd>
                  </dl>
                  <pre className="bg-muted max-h-[420px] max-w-full overflow-auto border p-3 text-xs leading-5 break-words whitespace-pre-wrap">
                    {JSON.stringify(
                      selectedDetail.evidence || selectedDetail.upstreamPayload,
                      null,
                      2
                    )}
                  </pre>
                  {selectedDetail.status === 'published' &&
                  selectedProblemSlug ? (
                    <div className="min-w-0 space-y-4 border border-amber-600/30 p-4">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {zh
                            ? '回滚已发布版本'
                            : 'Roll back published revision'}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs break-all">
                          {selectedProblemSlug}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="catalog-rollback-version">
                          {zh ? '目标版本' : 'Target version'}
                        </Label>
                        <Input
                          id="catalog-rollback-version"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={1_000_000}
                          step={1}
                          value={rollbackVersion}
                          onChange={(event) =>
                            setRollbackVersion(event.target.value)
                          }
                          className="w-full sm:max-w-48"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="catalog-rollback-notes">
                          {zh ? '回滚说明' : 'Rollback notes'}
                        </Label>
                        <Textarea
                          id="catalog-rollback-notes"
                          value={notes}
                          onChange={(event) => setNotes(event.target.value)}
                          maxLength={2000}
                          className="max-w-full"
                        />
                      </div>
                      <Button
                        variant="destructive"
                        disabled={
                          !capabilities.rollback ||
                          !notes.trim() ||
                          !Number.isInteger(Number(rollbackVersion)) ||
                          Number(rollbackVersion) < 1 ||
                          Boolean(action)
                        }
                        onClick={() => void mutate('rollback')}
                      >
                        <RotateCcw className="size-4" />
                        {zh ? '确认回滚' : 'Confirm rollback'}
                      </Button>
                    </div>
                  ) : null}
                </TabsContent>
                <TabsContent value="validation" className="mt-4 min-w-0">
                  {selectedDetail.validation?.valid ? (
                    <div className="flex items-center gap-2 border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="size-4 shrink-0" />
                      <span className="min-w-0 break-words">
                        {zh
                          ? '所有确定性门禁已通过'
                          : 'All deterministic gates passed'}
                      </span>
                    </div>
                  ) : (selectedDetail.validation?.issues?.length ?? 0) > 0 ? (
                    <div className="min-w-0 divide-y border">
                      {(selectedDetail.validation?.issues ?? []).map(
                        (issue, index) => (
                          <div
                            key={`${issue.code}-${index}`}
                            className="flex min-w-0 gap-3 p-3 text-sm"
                          >
                            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                            <div className="min-w-0 break-words">
                              <p className="font-medium">{issue.code}</p>
                              <p className="text-muted-foreground mt-1">
                                {issue.message}
                                {issue.path ? ` · ${issue.path}` : ''}
                              </p>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="text-muted-foreground border p-4 text-sm">
                      {zh ? '尚未执行校验' : 'Validation has not run yet'}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
