'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  ExternalLink,
  FileDiff,
  Link2,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/components/ui/collapsible';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import { Textarea } from '@/shared/components/ui/textarea';

import type {
  CatalogLanguage,
  CatalogReviewDraftV2,
  CatalogSourceProvenanceV1,
} from '../admin-contracts';
import type { CatalogJsonValue, CatalogTypeSpec } from '../raw-types';

loader.config({ paths: { vs: '/monaco/vs' } });

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
  draftKind: 'review_v2' | 'discovery' | 'released';
  reviewDraft?: CatalogReviewDraftV2;
  lockedSourceEvidence?: CatalogSourceProvenanceV1;
  problemSlug?: string;
  editable: boolean;
  validation?: {
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
  structuredReviewMode: 'off' | 'shadow' | 'write';
}

interface CanonicalCaseOption {
  sourceTestUuid: string;
  description?: string;
  sourceOrder: number;
  status: 'mapped' | 'unmappable';
  args?: CatalogJsonValue[];
  expected?: CatalogJsonValue;
  reason?: string;
}

interface CanonicalCasePage {
  items: CanonicalCaseOption[];
  total: number;
  mapped: number;
  nextCursor?: number;
  selected: CatalogReviewDraftV2['canonicalSelections'];
  templates?: CatalogReviewDraftV2['functionProtocol']['templates'];
}

type MutationOperation =
  | 'normalize'
  | 'save'
  | 'associate'
  | 'validate'
  | 'approve'
  | 'reject'
  | 'publish'
  | 'rollback';

type PreviewKind = 'upstream' | 'compiled';

const EMPTY_CAPABILITIES: Capabilities = {
  review: false,
  publish: false,
  rollback: false,
  structuredReviewMode: 'off',
};

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

const LANGUAGES: Array<{ id: CatalogLanguage; label: string }> = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'typescript', label: 'TypeScript' },
];

const TYPE_KINDS: CatalogTypeSpec['kind'][] = [
  'unknown',
  'integer',
  'number',
  'string',
  'boolean',
  'null',
  'array',
  'object',
  'union',
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

function defaultTypeSpec(kind: CatalogTypeSpec['kind']): CatalogTypeSpec {
  if (kind === 'array') return { kind, items: { kind: 'unknown' } };
  if (kind === 'object') return { kind, fields: {} };
  if (kind === 'union') return { kind, options: [{ kind: 'unknown' }] };
  return { kind };
}

function cloneDraft(draft: CatalogReviewDraftV2): CatalogReviewDraftV2 {
  return structuredClone(draft);
}

function draftFingerprint(draft?: CatalogReviewDraftV2): string {
  return draft ? JSON.stringify(draft) : '';
}

function templateProtocolFingerprint(draft?: CatalogReviewDraftV2): string {
  return JSON.stringify({
    signature: draft?.functionProtocol.signature ?? null,
    entryPoints: draft?.functionProtocol.entryPoints ?? null,
  });
}

function compactJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? '' : serialized;
}

function nextTestId(draft: CatalogReviewDraftV2, sourceOrder: number): string {
  const used = new Set([
    ...draft.canonicalSelections.map((item) => item.id),
    ...draft.manualTests.map((item) => item.id),
  ]);
  const base = `canonical-${sourceOrder + 1}`;
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

class ApiResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || payload.data === undefined) {
    throw new ApiResponseError(
      payload.error?.message || `Request failed (${response.status})`,
      response.status,
      payload.error?.code
    );
  }
  return payload.data;
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function LocalizedFields({
  id,
  label,
  value,
  onChange,
  disabled,
  multiline = false,
  zh,
}: {
  id: string;
  label: string;
  value: { zh: string; en: string };
  onChange: (value: { zh: string; en: string }) => void;
  disabled: boolean;
  multiline?: boolean;
  zh: boolean;
}) {
  const Control = multiline ? Textarea : Input;
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-muted-foreground text-xs" htmlFor={`${id}-zh`}>
            {zh ? '中文' : 'Chinese'}
          </Label>
          <Control
            id={`${id}-zh`}
            value={value.zh}
            onChange={(event) => onChange({ ...value, zh: event.target.value })}
            disabled={disabled}
            className={multiline ? 'min-h-24 resize-y' : undefined}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-muted-foreground text-xs" htmlFor={`${id}-en`}>
            English
          </Label>
          <Control
            id={`${id}-en`}
            value={value.en}
            onChange={(event) => onChange({ ...value, en: event.target.value })}
            disabled={disabled}
            className={multiline ? 'min-h-24 resize-y' : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function StringListEditor({
  id,
  label,
  values,
  onChange,
  disabled,
  max,
  zh,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  max: number;
  zh: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || values.length >= max}
          onClick={() => onChange([...values, ''])}
        >
          <Plus className="size-4" />
          {zh ? '添加' : 'Add'}
        </Button>
      </div>
      {values.length === 0 ? (
        <p className="text-muted-foreground border px-3 py-2 text-xs">
          {zh ? '暂无条目' : 'No entries'}
        </p>
      ) : (
        <div className="space-y-2">
          {values.map((value, index) => (
            <div key={`${id}-${index}`} className="flex min-w-0 gap-2">
              <Input
                aria-label={`${label} ${index + 1}`}
                value={value}
                onChange={(event) => {
                  const next = [...values];
                  next[index] = event.target.value;
                  onChange(next);
                }}
                disabled={disabled}
                maxLength={200}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`${zh ? '删除' : 'Remove'} ${label} ${index + 1}`}
                disabled={disabled}
                onClick={() =>
                  onChange(values.filter((_, item) => item !== index))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocalizedListEditor({
  id,
  label,
  values,
  onChange,
  disabled,
  max,
  zh,
}: {
  id: string;
  label: string;
  values: Array<{ zh: string; en: string }>;
  onChange: (values: Array<{ zh: string; en: string }>) => void;
  disabled: boolean;
  max: number;
  zh: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || values.length >= max}
          onClick={() => onChange([...values, { zh: '', en: '' }])}
        >
          <Plus className="size-4" />
          {zh ? '添加' : 'Add'}
        </Button>
      </div>
      {values.length === 0 ? (
        <p className="text-muted-foreground border px-3 py-2 text-xs">
          {zh ? '暂无条目' : 'No entries'}
        </p>
      ) : (
        values.map((value, index) => (
          <div
            key={`${id}-${index}`}
            className="grid min-w-0 gap-2 border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <Input
              aria-label={`${label} ${index + 1} ${zh ? '中文' : 'Chinese'}`}
              value={value.zh}
              onChange={(event) => {
                const next = structuredClone(values);
                next[index]!.zh = event.target.value;
                onChange(next);
              }}
              disabled={disabled}
              placeholder={zh ? '中文' : 'Chinese'}
            />
            <Input
              aria-label={`${label} ${index + 1} English`}
              value={value.en}
              onChange={(event) => {
                const next = structuredClone(values);
                next[index]!.en = event.target.value;
                onChange(next);
              }}
              disabled={disabled}
              placeholder="English"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`${zh ? '删除' : 'Remove'} ${label} ${index + 1}`}
              disabled={disabled}
              onClick={() =>
                onChange(values.filter((_, item) => item !== index))
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

function TypeSpecEditor({
  value,
  onChange,
  disabled,
  label,
  depth = 0,
}: {
  value: CatalogTypeSpec;
  onChange: (value: CatalogTypeSpec) => void;
  disabled: boolean;
  label: string;
  depth?: number;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Select
        value={value.kind}
        disabled={disabled}
        onValueChange={(kind) =>
          onChange(defaultTypeSpec(kind as CatalogTypeSpec['kind']))
        }
      >
        <SelectTrigger aria-label={label} className="w-full sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TYPE_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {kind}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.kind === 'array' ? (
        <div className="border-l pl-3">
          <TypeSpecEditor
            value={value.items}
            onChange={(items) => onChange({ kind: 'array', items })}
            disabled={disabled}
            label={`${label} items`}
            depth={depth + 1}
          />
        </div>
      ) : null}
      {value.kind === 'object' ? (
        <div className="space-y-2 border-l pl-3">
          {Object.entries(value.fields).map(([name, field], index) => (
            <div
              key={`${name}-${index}`}
              className="grid min-w-0 gap-2 sm:grid-cols-[minmax(120px,0.45fr)_minmax(0,1fr)_auto]"
            >
              <Input
                aria-label={`${label} field ${index + 1} name`}
                value={name}
                disabled={disabled}
                onChange={(event) => {
                  const entries = Object.entries(value.fields);
                  entries[index] = [event.target.value, field];
                  onChange({
                    kind: 'object',
                    fields: Object.fromEntries(entries),
                  });
                }}
              />
              <TypeSpecEditor
                value={field}
                onChange={(nextField) => {
                  const fields = { ...value.fields, [name]: nextField };
                  onChange({ kind: 'object', fields });
                }}
                disabled={disabled}
                label={`${label} field ${index + 1} type`}
                depth={depth + 1}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${label} field ${index + 1}`}
                disabled={disabled}
                onClick={() => {
                  const entries = Object.entries(value.fields).filter(
                    (_, item) => item !== index
                  );
                  onChange({
                    kind: 'object',
                    fields: Object.fromEntries(entries),
                  });
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || depth >= 6}
            onClick={() => {
              let index = Object.keys(value.fields).length + 1;
              while (Object.hasOwn(value.fields, `field${index}`)) index += 1;
              onChange({
                kind: 'object',
                fields: {
                  ...value.fields,
                  [`field${index}`]: { kind: 'unknown' },
                },
              });
            }}
          >
            <Plus className="size-4" /> Add field
          </Button>
        </div>
      ) : null}
      {value.kind === 'union' ? (
        <div className="space-y-2 border-l pl-3">
          {value.options.map((option, index) => (
            <div
              key={`${label}-option-${index}`}
              className="flex min-w-0 items-start gap-2"
            >
              <div className="min-w-0 flex-1">
                <TypeSpecEditor
                  value={option}
                  onChange={(nextOption) => {
                    const options = structuredClone(value.options);
                    options[index] = nextOption;
                    onChange({ kind: 'union', options });
                  }}
                  disabled={disabled}
                  label={`${label} option ${index + 1}`}
                  depth={depth + 1}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${label} option ${index + 1}`}
                disabled={disabled || value.options.length === 1}
                onClick={() =>
                  onChange({
                    kind: 'union',
                    options: value.options.filter((_, item) => item !== index),
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || value.options.length >= 8 || depth >= 6}
            onClick={() =>
              onChange({
                kind: 'union',
                options: [...value.options, { kind: 'unknown' }],
              })
            }
          >
            <Plus className="size-4" /> Add option
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TemplateEditor({
  language,
  value,
  onChange,
  readOnly,
}: {
  language: CatalogLanguage;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const label = `${LANGUAGES.find((item) => item.id === language)?.label} starter template`;
  return (
    <div className="h-[340px] min-h-[280px] overflow-hidden border bg-[#1e1e1e]">
      <Editor
        height="100%"
        language={language}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
        value={value}
        onChange={(next) => onChange(next ?? '')}
        loading={
          <div className="bg-muted text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading editor...
          </div>
        }
        options={{
          readOnly,
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 21,
          padding: { top: 14, bottom: 14 },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          ariaLabel: label,
        }}
      />
    </div>
  );
}

function JsonValueEditor({
  label,
  value,
  expectArray = false,
  disabled,
  onChange,
  onValidityChange,
}: {
  label: string;
  value: CatalogJsonValue | CatalogJsonValue[];
  expectArray?: boolean;
  disabled: boolean;
  onChange: (value: CatalogJsonValue | CatalogJsonValue[]) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const serialized = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized);
  const [invalid, setInvalid] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <Textarea
        aria-label={label}
        value={text}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={invalid}
        className="min-h-24 resize-y font-mono text-xs"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          try {
            const parsed = JSON.parse(next) as CatalogJsonValue;
            const valid = !expectArray || Array.isArray(parsed);
            setInvalid(!valid);
            onValidityChange(valid);
            if (valid) onChange(parsed);
          } catch {
            setInvalid(true);
            onValidityChange(false);
          }
        }}
      />
      {invalid ? (
        <p className="text-destructive text-xs">
          {expectArray ? 'Enter a valid JSON array.' : 'Enter valid JSON.'}
        </p>
      ) : null}
    </div>
  );
}

export function CatalogCandidateConsole({ locale }: { locale: string }) {
  const zh = locale === 'zh';
  const [items, setItems] = useState<CandidateSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [capabilities, setCapabilities] =
    useState<Capabilities>(EMPTY_CAPABILITIES);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<CandidateDetail>();
  const [draft, setDraft] = useState<CatalogReviewDraftV2>();
  const [savedDraftFingerprint, setSavedDraftFingerprint] = useState('');
  const [status, setStatus] = useState('pending');
  const [query, setQuery] = useState('');
  const [serverQuery, setServerQuery] = useState('');
  const [targetProblemSlug, setTargetProblemSlug] = useState('');
  const [notes, setNotes] = useState('');
  const [rollbackVersion, setRollbackVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [action, setAction] = useState<MutationOperation>();
  const [conflict, setConflict] = useState<string>();
  const [canonicalCases, setCanonicalCases] = useState<CanonicalCaseOption[]>(
    []
  );
  const [canonicalSummary, setCanonicalSummary] = useState({
    total: 0,
    mapped: 0,
  });
  const [canonicalCursor, setCanonicalCursor] = useState<number>();
  const [canonicalLoading, setCanonicalLoading] = useState(false);
  const [canonicalPreview, setCanonicalPreview] = useState(false);
  const [canonicalSignatureFingerprint, setCanonicalSignatureFingerprint] =
    useState('');
  const [generatedTemplateFingerprint, setGeneratedTemplateFingerprint] =
    useState('');
  const [previewKind, setPreviewKind] = useState<PreviewKind>();
  const [previewPayloads, setPreviewPayloads] = useState<
    Partial<Record<PreviewKind, unknown>>
  >({});
  const [previewLoading, setPreviewLoading] = useState<PreviewKind>();
  const [invalidJsonFields, setInvalidJsonFields] = useState<Set<string>>(
    new Set()
  );
  const mutationAttempt = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const canonicalRequestSequence = useRef(0);

  const selectedDetail = detail?.id === selectedId ? detail : undefined;
  const dirty = Boolean(
    draft && draftFingerprint(draft) !== savedDraftFingerprint
  );
  const signatureFingerprint = JSON.stringify(
    draft?.functionProtocol.signature ?? null
  );
  const currentTemplateFingerprint = templateProtocolFingerprint(draft);
  const templatesStale = Boolean(
    draft && currentTemplateFingerprint !== generatedTemplateFingerprint
  );
  const canEdit = Boolean(
    selectedDetail?.editable &&
      selectedDetail.draftKind === 'review_v2' &&
      draft &&
      capabilities.review &&
      capabilities.structuredReviewMode === 'write'
  );
  const upstreamUrl = selectedDetail
    ? safeExternalUrl(selectedDetail.upstreamUrl)
    : undefined;

  const confirmDiscard = useCallback(() => {
    if (!dirty) return true;
    return window.confirm(
      zh
        ? '当前候选有未保存的更改。放弃这些更改吗？'
        : 'This candidate has unsaved changes. Discard them?'
    );
  }, [dirty, zh]);

  const applyDetail = useCallback(
    (data: CandidateDetail, preserveLocalDraft = false) => {
      setDetail(data);
      setSavedDraftFingerprint(draftFingerprint(data.reviewDraft));
      if (!preserveLocalDraft) {
        setDraft(data.reviewDraft ? cloneDraft(data.reviewDraft) : undefined);
        setTargetProblemSlug(data.targetProblemSlug ?? '');
        setNotes('');
        setRollbackVersion('');
        setInvalidJsonFields(new Set());
      }
      setConflict(undefined);
      setCanonicalCases([]);
      setCanonicalSummary({ total: 0, mapped: 0 });
      setCanonicalCursor(undefined);
      setCanonicalPreview(false);
      setCanonicalSignatureFingerprint(
        JSON.stringify(data.reviewDraft?.functionProtocol.signature ?? null)
      );
      setGeneratedTemplateFingerprint(
        templateProtocolFingerprint(data.reviewDraft)
      );
      setPreviewKind(undefined);
      setPreviewPayloads({});
    },
    []
  );

  const loadList = useCallback(
    async (
      options: { cursor?: string; append?: boolean; signal?: AbortSignal } = {}
    ) => {
      const requestSequence = ++listRequestSequence.current;
      if (options.append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '25' });
        if (status !== 'all') params.set('status', status);
        if (serverQuery) params.set('query', serverQuery);
        if (options.cursor) params.set('cursor', options.cursor);
        const data = await responseData<{
          items: CandidateSummary[];
          nextCursor?: string;
          capabilities: Capabilities;
        }>(
          await fetch(`/api/admin/catalog/candidates?${params}`, {
            cache: 'no-store',
            signal: options.signal,
          })
        );
        if (
          options.signal?.aborted ||
          requestSequence !== listRequestSequence.current
        ) {
          return;
        }
        setItems((current) => {
          if (!options.append) return data.items;
          const merged = new Map(current.map((item) => [item.id, item]));
          data.items.forEach((item) => merged.set(item.id, item));
          return [...merged.values()];
        });
        setNextCursor(data.nextCursor);
        setCapabilities({ ...EMPTY_CAPABILITIES, ...data.capabilities });
        setSelectedId((current) => current ?? data.items[0]?.id);
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
          !options.signal?.aborted &&
          requestSequence === listRequestSequence.current
        ) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [serverQuery, status]
  );

  const loadDetail = useCallback(
    async (
      candidateId: string,
      options: { signal?: AbortSignal; preserveLocalDraft?: boolean } = {}
    ) => {
      const requestSequence = ++detailRequestSequence.current;
      setDetailLoading(true);
      try {
        const data = await responseData<CandidateDetail>(
          await fetch(
            `/api/admin/catalog/candidates/${encodeURIComponent(candidateId)}`,
            { cache: 'no-store', signal: options.signal }
          )
        );
        if (
          options.signal?.aborted ||
          requestSequence !== detailRequestSequence.current
        ) {
          return;
        }
        applyDetail(data, options.preserveLocalDraft);
        return data;
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
        if (!options.preserveLocalDraft) setDetail(undefined);
      } finally {
        if (
          !options.signal?.aborted &&
          requestSequence === detailRequestSequence.current
        ) {
          setDetailLoading(false);
        }
      }
    },
    [applyDetail]
  );

  const loadCanonicalCases = useCallback(
    async ({
      append = false,
      preview = false,
      regenerateTemplates = false,
    }: {
      append?: boolean;
      preview?: boolean;
      regenerateTemplates?: boolean;
    } = {}) => {
      if (!selectedDetail || !draft) return;
      const requestSequence = ++canonicalRequestSequence.current;
      setCanonicalLoading(true);
      try {
        const cursor = append ? (canonicalCursor ?? 0) : 0;
        const endpoint = `/api/admin/catalog/candidates/${encodeURIComponent(
          selectedDetail.id
        )}/canonical-cases`;
        const data = await responseData<CanonicalCasePage>(
          await fetch(
            preview
              ? endpoint
              : `${endpoint}?${new URLSearchParams({
                  cursor: String(cursor),
                  limit: '50',
                })}`,
            preview
              ? {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    signature: draft.functionProtocol.signature,
                    entryPoints: draft.functionProtocol.entryPoints,
                    cursor,
                    limit: 50,
                  }),
                }
              : { cache: 'no-store' }
          )
        );
        if (requestSequence !== canonicalRequestSequence.current) return;
        setCanonicalCases((current) =>
          append ? [...current, ...data.items] : data.items
        );
        setCanonicalSummary({ total: data.total, mapped: data.mapped });
        setCanonicalCursor(data.nextCursor);
        setCanonicalPreview(preview);
        setCanonicalSignatureFingerprint(signatureFingerprint);
        if (regenerateTemplates && data.templates) {
          setDraft((current) => {
            if (!current) return current;
            const next = cloneDraft(current);
            next.functionProtocol.templates = data.templates!;
            return next;
          });
          setGeneratedTemplateFingerprint(currentTemplateFingerprint);
        }
      } catch (error) {
        if (requestSequence !== canonicalRequestSequence.current) return;
        toast.error(
          error instanceof Error ? error.message : 'Canonical cases unavailable'
        );
      } finally {
        if (requestSequence === canonicalRequestSequence.current) {
          setCanonicalLoading(false);
        }
      }
    },
    [
      canonicalCursor,
      currentTemplateFingerprint,
      draft,
      selectedDetail,
      signatureFingerprint,
    ]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setServerQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadList({ signal: controller.signal }));
    return () => controller.abort();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void Promise.resolve().then(() =>
      loadDetail(selectedId, { signal: controller.signal })
    );
    return () => controller.abort();
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (!selectedDetail?.reviewDraft || !draft) return;
    void Promise.resolve().then(() => loadCanonicalCases());
    // A detail revision owns one initial canonical request. Local signature edits
    // are remapped only when the reviewer explicitly requests a preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetail?.id, selectedDetail?.draftRevision]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const updateDraft = useCallback(
    (update: (next: CatalogReviewDraftV2) => void) => {
      setDraft((current) => {
        if (!current) return current;
        const next = cloneDraft(current);
        update(next);
        return next;
      });
    },
    []
  );

  const setJsonValidity = useCallback((key: string, valid: boolean) => {
    setInvalidJsonFields((current) => {
      const next = new Set(current);
      if (valid) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  async function mutate(operation: MutationOperation) {
    if (!selectedDetail) return;
    if (
      operation === 'save' &&
      (!draft || invalidJsonFields.size > 0 || templatesStale)
    ) {
      toast.error(
        templatesStale
          ? zh
            ? '函数协议已变化，请先确认并重新生成三语言模板'
            : 'Regenerate the three language templates for the changed protocol before saving'
          : zh
            ? '请先修正测试用例中的 JSON'
            : 'Fix invalid test JSON before saving'
      );
      return;
    }
    if (operation === 'reject' && !notes.trim()) {
      toast.error(
        zh ? '拒绝候选前请填写审核说明' : 'Add review notes before rejecting'
      );
      return;
    }
    if (
      operation === 'rollback' &&
      (!selectedDetail.problemSlug ||
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
      let endpoint = `/api/admin/catalog/candidates/${encodeURIComponent(
        selectedDetail.id
      )}/${operation}`;
      let body: Record<string, unknown> = {
        notes,
        expectedDraftRevision: selectedDetail.draftRevision,
      };
      if (operation === 'save') {
        method = 'PATCH';
        endpoint = `/api/admin/catalog/candidates/${encodeURIComponent(
          selectedDetail.id
        )}`;
        body = {
          schemaVersion: 2,
          expectedDraftRevision: selectedDetail.draftRevision,
          draft,
        };
      } else if (operation === 'normalize') {
        body = { expectedDraftRevision: selectedDetail.draftRevision };
      } else if (operation === 'validate') {
        body = { expectedDraftRevision: selectedDetail.draftRevision };
      } else if (operation === 'associate') {
        method = 'PATCH';
        endpoint = `/api/admin/catalog/candidates/${encodeURIComponent(
          selectedDetail.id
        )}`;
        body = {
          targetProblemSlug: targetProblemSlug.trim() || null,
          expectedDraftRevision: selectedDetail.draftRevision,
        };
      } else if (operation === 'rollback') {
        endpoint = '/api/admin/catalog/rollback';
        body = {
          slug: selectedDetail.problemSlug,
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
      setConflict(undefined);
      toast.success(zh ? '操作已完成' : 'Operation completed');
      await loadList();
      await loadDetail(selectedDetail.id);
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
        mutationAttempt.current = null;
        setConflict(error.message);
      } else if (error instanceof ApiResponseError && error.status < 500) {
        mutationAttempt.current = null;
      }
      toast.error(error instanceof Error ? error.message : 'Operation failed');
    } finally {
      setAction(undefined);
    }
  }

  async function recoverConflict(preserveLocalDraft: boolean) {
    if (!selectedDetail) return;
    if (
      preserveLocalDraft &&
      !window.confirm(
        zh
          ? '这会使用服务器的最新修订号保留本地内容。再次保存将覆盖服务器草稿，是否继续？'
          : 'This keeps your local content on the latest revision. Saving again will overwrite the server draft. Continue?'
      )
    ) {
      return;
    }
    await loadDetail(selectedDetail.id, { preserveLocalDraft });
  }

  async function loadPreview(kind: PreviewKind) {
    if (!selectedDetail) return;
    setPreviewKind(kind);
    if (Object.hasOwn(previewPayloads, kind)) return;
    setPreviewLoading(kind);
    try {
      const data = await responseData<{ kind: PreviewKind; payload: unknown }>(
        await fetch(
          `/api/admin/catalog/candidates/${encodeURIComponent(
            selectedDetail.id
          )}/preview?kind=${kind}`,
          { cache: 'no-store' }
        )
      );
      setPreviewPayloads((current) => ({
        ...current,
        [kind]: data.payload,
      }));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Preview unavailable'
      );
    } finally {
      setPreviewLoading(undefined);
    }
  }

  function chooseCandidate(candidateId: string) {
    if (candidateId === selectedId || !confirmDiscard()) return;
    setSelectedId(candidateId);
  }

  async function refreshCurrent() {
    if (!confirmDiscard()) return;
    await loadList();
    if (selectedId) await loadDetail(selectedId);
  }

  function toggleCanonical(option: CanonicalCaseOption, checked: boolean) {
    if (!draft || option.status !== 'mapped') return;
    updateDraft((next) => {
      if (!checked) {
        next.canonicalSelections = next.canonicalSelections.filter(
          (selection) => selection.sourceTestUuid !== option.sourceTestUuid
        );
        return;
      }
      if (
        next.canonicalSelections.some(
          (selection) => selection.sourceTestUuid === option.sourceTestUuid
        )
      ) {
        return;
      }
      next.canonicalSelections.push({
        sourceTestUuid: option.sourceTestUuid,
        id: nextTestId(next, option.sourceOrder),
        isSample: next.canonicalSelections.length === 0,
      });
    });
  }

  function renderBasicEditor(current: CatalogReviewDraftV2) {
    return (
      <div className="space-y-6">
        <section className="space-y-4 border-b pb-6">
          <SectionHeading
            title={zh ? '基础信息' : 'Basics'}
            description={
              zh
                ? '维护稳定标识、双语题面和难度信息。'
                : 'Maintain stable identity, bilingual copy, and difficulty.'
            }
          />
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="catalog-problem-id">
                {zh ? '题目 ID' : 'Problem ID'}
              </Label>
              <Input
                id="catalog-problem-id"
                value={current.id}
                disabled
                readOnly
                placeholder="ex-101"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="catalog-problem-slug">Slug</Label>
              <Input
                id="catalog-problem-slug"
                value={current.slug}
                disabled={
                  !canEdit || Boolean(selectedDetail?.targetProblemSlug)
                }
                onChange={(event) =>
                  updateDraft((next) => {
                    next.slug = event.target.value;
                  })
                }
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label>{zh ? '难度' : 'Difficulty'}</Label>
              <Select
                value={current.difficulty ?? 'unset'}
                disabled={!canEdit}
                onValueChange={(value) =>
                  updateDraft((next) => {
                    next.difficulty =
                      value === 'unset'
                        ? null
                        : (value as CatalogReviewDraftV2['difficulty']);
                  })
                }
              >
                <SelectTrigger
                  aria-label={zh ? '难度' : 'Difficulty'}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">
                    {zh ? '未设置' : 'Not set'}
                  </SelectItem>
                  <SelectItem value="easy">easy</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="hard">hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="catalog-estimated-minutes">
                {zh ? '预计用时（分钟）' : 'Estimated minutes'}
              </Label>
              <Input
                id="catalog-estimated-minutes"
                type="number"
                min={1}
                max={480}
                value={current.estimatedMinutes ?? ''}
                disabled={!canEdit}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.estimatedMinutes = event.target.value
                      ? Number(event.target.value)
                      : null;
                  })
                }
              />
            </div>
          </div>
          <LocalizedFields
            id="catalog-title"
            label={zh ? '标题' : 'Title'}
            value={current.title}
            onChange={(value) =>
              updateDraft((next) => {
                next.title = value;
              })
            }
            disabled={!canEdit}
            zh={zh}
          />
          <LocalizedFields
            id="catalog-description"
            label={zh ? '题目描述' : 'Description'}
            value={current.description}
            onChange={(value) =>
              updateDraft((next) => {
                next.description = value;
              })
            }
            disabled={!canEdit}
            multiline
            zh={zh}
          />
          <StringListEditor
            id="catalog-topics"
            label={zh ? '主题' : 'Topics'}
            values={current.topics}
            onChange={(values) =>
              updateDraft((next) => {
                next.topics = values;
              })
            }
            disabled={!canEdit}
            max={20}
            zh={zh}
          />
        </section>

        <section className="space-y-4 border-b pb-6">
          <SectionHeading title={zh ? '教学设计' : 'Pedagogy'} />
          <LocalizedListEditor
            id="catalog-objectives"
            label={zh ? '学习目标' : 'Learning objectives'}
            values={current.learningObjectives}
            onChange={(values) =>
              updateDraft((next) => {
                next.learningObjectives = values;
              })
            }
            disabled={!canEdit}
            max={6}
            zh={zh}
          />
          <StringListEditor
            id="catalog-prerequisites"
            label={zh ? '前置主题' : 'Prerequisite topics'}
            values={current.prerequisiteTopics}
            onChange={(values) =>
              updateDraft((next) => {
                next.prerequisiteTopics = values;
              })
            }
            disabled={!canEdit}
            max={12}
            zh={zh}
          />
          <StringListEditor
            id="catalog-patterns"
            label={zh ? '解题模式' : 'Solution patterns'}
            values={current.solutionPatterns}
            onChange={(values) =>
              updateDraft((next) => {
                next.solutionPatterns = values;
              })
            }
            disabled={!canEdit}
            max={12}
            zh={zh}
          />
          <LocalizedListEditor
            id="catalog-constraints"
            label={zh ? '约束' : 'Constraints'}
            values={current.constraints}
            onChange={(values) =>
              updateDraft((next) => {
                next.constraints = values;
              })
            }
            disabled={!canEdit}
            max={20}
            zh={zh}
          />
          <LocalizedListEditor
            id="catalog-hints"
            label={zh ? '提示' : 'Hints'}
            values={current.hints}
            onChange={(values) =>
              updateDraft((next) => {
                next.hints = values;
              })
            }
            disabled={!canEdit}
            max={3}
            zh={zh}
          />
          <LocalizedListEditor
            id="catalog-review-points"
            label={zh ? '复盘要点' : 'Review points'}
            values={current.reviewPoints}
            onChange={(values) =>
              updateDraft((next) => {
                next.reviewPoints = values;
              })
            }
            disabled={!canEdit}
            max={20}
            zh={zh}
          />
        </section>

        <section className="space-y-4 pb-2">
          <SectionHeading
            title={zh ? '函数协议' : 'Function protocol'}
            description={
              zh
                ? '函数签名决定 canonical 用例能否映射。修改后请刷新映射预览。'
                : 'The signature controls canonical mapping. Refresh the mapping preview after edits.'
            }
          />
          {current.functionProtocol.signature ? (
            <div className="space-y-4">
              {current.functionProtocol.signature.parameters.map(
                (parameter, index) => (
                  <div
                    key={`parameter-${index}`}
                    className="grid min-w-0 gap-3 border p-3 md:grid-cols-[minmax(130px,0.35fr)_minmax(0,1fr)_auto]"
                  >
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {zh ? `参数 ${index + 1}` : `Parameter ${index + 1}`}
                      </Label>
                      <Input
                        aria-label={
                          zh
                            ? `参数 ${index + 1} 名称`
                            : `Parameter ${index + 1} name`
                        }
                        value={parameter.name}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateDraft((next) => {
                            next.functionProtocol.signature!.parameters[
                              index
                            ]!.name = event.target.value;
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{zh ? '类型' : 'Type'}</Label>
                      <TypeSpecEditor
                        value={parameter.type}
                        onChange={(value) =>
                          updateDraft((next) => {
                            next.functionProtocol.signature!.parameters[
                              index
                            ]!.type = value;
                          })
                        }
                        disabled={!canEdit}
                        label={
                          zh
                            ? `参数 ${index + 1} 类型`
                            : `Parameter ${index + 1} type`
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="md:mt-6"
                      aria-label={
                        zh
                          ? `删除参数 ${index + 1}`
                          : `Remove parameter ${index + 1}`
                      }
                      disabled={!canEdit}
                      onClick={() =>
                        updateDraft((next) => {
                          next.functionProtocol.signature!.parameters.splice(
                            index,
                            1
                          );
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  !canEdit ||
                  current.functionProtocol.signature.parameters.length >= 8
                }
                onClick={() =>
                  updateDraft((next) => {
                    next.functionProtocol.signature!.parameters.push({
                      name: `arg${next.functionProtocol.signature!.parameters.length + 1}`,
                      type: { kind: 'unknown' },
                    });
                  })
                }
              >
                <Plus className="size-4" />
                {zh ? '添加参数' : 'Add parameter'}
              </Button>
              <div className="space-y-1.5">
                <Label>{zh ? '返回类型' : 'Return type'}</Label>
                <TypeSpecEditor
                  value={current.functionProtocol.signature.returns}
                  onChange={(value) =>
                    updateDraft((next) => {
                      next.functionProtocol.signature!.returns = value;
                    })
                  }
                  disabled={!canEdit}
                  label={zh ? '返回类型' : 'Return type'}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border p-3">
              <p className="text-muted-foreground text-sm">
                {zh ? '尚未定义函数签名' : 'No function signature defined'}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canEdit}
                onClick={() =>
                  updateDraft((next) => {
                    next.functionProtocol.signature = {
                      parameters: [],
                      returns: { kind: 'unknown' },
                    };
                  })
                }
              >
                <Plus className="size-4" />
                {zh ? '定义签名' : 'Define signature'}
              </Button>
            </div>
          )}
          <div className="grid min-w-0 gap-3 md:grid-cols-3">
            {LANGUAGES.map((language) => (
              <div key={language.id} className="space-y-1.5">
                <Label htmlFor={`entry-${language.id}`}>
                  {language.label} {zh ? '入口函数' : 'entry point'}
                </Label>
                <Input
                  id={`entry-${language.id}`}
                  value={current.functionProtocol.entryPoints[language.id]}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft((next) => {
                      next.functionProtocol.entryPoints[language.id] =
                        event.target.value;
                    })
                  }
                />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label>{zh ? '起始代码' : 'Starter templates'}</Label>
              {templatesStale ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    !canEdit ||
                    !current.functionProtocol.signature ||
                    canonicalLoading
                  }
                  onClick={() => {
                    const confirmed = window.confirm(
                      zh
                        ? '将按当前函数签名和入口函数重新生成三语言模板，并覆盖现有模板。是否继续？'
                        : 'Regenerate all three templates from the current signature and entry points, replacing the existing templates?'
                    );
                    if (confirmed) {
                      void loadCanonicalCases({
                        preview: true,
                        regenerateTemplates: true,
                      });
                    }
                  }}
                >
                  <RefreshCw
                    className={
                      canonicalLoading ? 'size-4 animate-spin' : 'size-4'
                    }
                  />
                  {zh ? '重新生成模板' : 'Regenerate templates'}
                </Button>
              ) : null}
            </div>
            {templatesStale ? (
              <div
                role="status"
                className="border border-amber-600/30 bg-amber-600/10 p-3 text-sm text-amber-800 dark:text-amber-200"
              >
                {zh
                  ? '函数签名或入口函数已变化，当前模板已过期。'
                  : 'The signature or entry point changed. Current templates are stale.'}
              </div>
            ) : null}
            <Tabs defaultValue="javascript" className="min-w-0">
              <TabsList className="grid w-full grid-cols-3 sm:w-auto">
                {LANGUAGES.map((language) => (
                  <TabsTrigger key={language.id} value={language.id}>
                    {language.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {LANGUAGES.map((language) => (
                <TabsContent
                  key={language.id}
                  value={language.id}
                  className="mt-2"
                >
                  <TemplateEditor
                    language={language.id}
                    value={current.functionProtocol.templates[language.id]}
                    readOnly={!canEdit}
                    onChange={(value) =>
                      updateDraft((next) => {
                        next.functionProtocol.templates[language.id] = value;
                      })
                    }
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </section>
      </div>
    );
  }

  function renderTestsEditor(current: CatalogReviewDraftV2) {
    const mappingStale = signatureFingerprint !== canonicalSignatureFingerprint;
    return (
      <div className="space-y-8">
        <section className="space-y-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <SectionHeading
              title={zh ? 'Canonical 用例' : 'Canonical cases'}
              description={
                zh
                  ? `${canonicalSummary.mapped}/${canonicalSummary.total} 个上游用例可映射；输入与期望值不可编辑。`
                  : `${canonicalSummary.mapped}/${canonicalSummary.total} upstream cases map cleanly. Inputs and expected values are locked.`
              }
            />
            <Button
              type="button"
              size="sm"
              variant={mappingStale ? 'default' : 'outline'}
              disabled={canonicalLoading || !draft}
              onClick={() => void loadCanonicalCases({ preview: true })}
            >
              <RefreshCw
                className={canonicalLoading ? 'size-4 animate-spin' : 'size-4'}
              />
              {zh ? '刷新映射' : 'Refresh mapping'}
            </Button>
          </div>
          {mappingStale ? (
            <div className="border border-amber-600/30 bg-amber-600/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              {zh
                ? '函数签名已更改。刷新映射后再选择 canonical 用例。'
                : 'The function signature changed. Refresh the mapping before selecting canonical cases.'}
            </div>
          ) : null}
          {canonicalLoading && canonicalCases.length === 0 ? (
            <div className="text-muted-foreground flex items-center gap-2 border p-4 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {zh ? '读取 canonical 用例' : 'Loading canonical cases'}
            </div>
          ) : canonicalCases.length === 0 ? (
            <div className="text-muted-foreground border p-4 text-sm">
              {zh
                ? '没有可显示的 canonical 用例'
                : 'No canonical cases available'}
            </div>
          ) : (
            <div className="border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">
                      {zh ? '选择' : 'Use'}
                    </TableHead>
                    <TableHead className="w-16">
                      {zh ? '示例' : 'Sample'}
                    </TableHead>
                    <TableHead>UUID</TableHead>
                    <TableHead>{zh ? '映射' : 'Mapping'}</TableHead>
                    <TableHead>{zh ? '参数' : 'Arguments'}</TableHead>
                    <TableHead>{zh ? '期望' : 'Expected'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {canonicalCases.map((item) => {
                    const selection = current.canonicalSelections.find(
                      (selected) =>
                        selected.sourceTestUuid === item.sourceTestUuid
                    );
                    return (
                      <TableRow
                        key={`${item.sourceTestUuid}-${item.sourceOrder}`}
                      >
                        <TableCell>
                          <Checkbox
                            aria-label={`${zh ? '选择' : 'Select'} ${item.sourceTestUuid}`}
                            checked={Boolean(selection)}
                            disabled={
                              !canEdit ||
                              item.status !== 'mapped' ||
                              mappingStale
                            }
                            onCheckedChange={(checked) =>
                              toggleCanonical(item, checked === true)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Checkbox
                            aria-label={`${zh ? '设为示例' : 'Mark sample'} ${item.sourceTestUuid}`}
                            checked={Boolean(selection?.isSample)}
                            disabled={!canEdit || !selection}
                            onCheckedChange={(checked) =>
                              updateDraft((next) => {
                                const selected = next.canonicalSelections.find(
                                  (candidate) =>
                                    candidate.sourceTestUuid ===
                                    item.sourceTestUuid
                                );
                                if (selected)
                                  selected.isSample = checked === true;
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="max-w-72 whitespace-normal">
                          <p className="font-mono text-xs break-all">
                            {item.sourceTestUuid}
                          </p>
                          {item.description ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              {item.description}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              item.status === 'mapped'
                                ? 'border-emerald-600/30 text-emerald-700 dark:text-emerald-300'
                                : 'border-amber-600/30 text-amber-700 dark:text-amber-300'
                            }
                          >
                            {item.status}
                          </Badge>
                          {item.reason ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              {item.reason}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-64 font-mono text-xs whitespace-normal">
                          {item.args === undefined
                            ? '-'
                            : compactJson(item.args)}
                        </TableCell>
                        <TableCell className="max-w-64 font-mono text-xs whitespace-normal">
                          {item.expected === undefined
                            ? '-'
                            : compactJson(item.expected)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {canonicalCursor !== undefined ? (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={canonicalLoading}
              onClick={() =>
                void loadCanonicalCases({
                  append: true,
                  preview: canonicalPreview,
                })
              }
            >
              {canonicalLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {zh ? '加载更多用例' : 'Load more cases'}
            </Button>
          ) : null}
        </section>

        <section className="space-y-4 border-t pt-6">
          <div className="flex items-center justify-between gap-3">
            <SectionHeading
              title={zh ? '人工补充用例' : 'Manual tests'}
              description={
                zh
                  ? '人工用例需要明确的审核说明，且不能替代 canonical 用例。'
                  : 'Manual tests require a review note and do not replace canonical coverage.'
              }
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canEdit || current.manualTests.length >= 100}
              onClick={() =>
                updateDraft((next) => {
                  next.manualTests.push({
                    id: `manual-${next.manualTests.length + 1}`,
                    args: [],
                    expected: null,
                    isSample: false,
                    reviewNote: '',
                  });
                })
              }
            >
              <Plus className="size-4" />
              {zh ? '添加人工用例' : 'Add manual test'}
            </Button>
          </div>
          {current.manualTests.length === 0 ? (
            <div className="text-muted-foreground border p-4 text-sm">
              {zh ? '没有人工补充用例' : 'No manual tests'}
            </div>
          ) : (
            <div className="space-y-3">
              {current.manualTests.map((test, index) => (
                <div
                  key={`${selectedDetail?.id}-${selectedDetail?.draftRevision}-${test.id}-${index}`}
                  className="space-y-3 border p-3"
                >
                  <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                    <div className="space-y-1.5">
                      <Label htmlFor={`manual-id-${index}`}>
                        {zh ? '用例 ID' : 'Test ID'}
                      </Label>
                      <Input
                        id={`manual-id-${index}`}
                        value={test.id}
                        disabled={!canEdit}
                        onChange={(event) =>
                          updateDraft((next) => {
                            next.manualTests[index]!.id = event.target.value;
                          })
                        }
                      />
                    </div>
                    <Label className="flex h-9 items-center gap-2 border px-3 text-sm">
                      <Checkbox
                        checked={test.isSample}
                        disabled={!canEdit}
                        onCheckedChange={(checked) =>
                          updateDraft((next) => {
                            next.manualTests[index]!.isSample =
                              checked === true;
                          })
                        }
                      />
                      {zh ? '示例' : 'Sample'}
                    </Label>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={
                        zh
                          ? `删除人工用例 ${index + 1}`
                          : `Remove manual test ${index + 1}`
                      }
                      disabled={!canEdit}
                      onClick={() =>
                        updateDraft((next) => {
                          next.manualTests.splice(index, 1);
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="grid min-w-0 gap-3 md:grid-cols-2">
                    <JsonValueEditor
                      label={`${zh ? '参数 JSON' : 'Arguments JSON'} ${index + 1}`}
                      value={test.args}
                      expectArray
                      disabled={!canEdit}
                      onValidityChange={(valid) =>
                        setJsonValidity(`manual-${index}-args`, valid)
                      }
                      onChange={(value) =>
                        updateDraft((next) => {
                          next.manualTests[index]!.args =
                            value as CatalogJsonValue[];
                        })
                      }
                    />
                    <JsonValueEditor
                      label={`${zh ? '期望 JSON' : 'Expected JSON'} ${index + 1}`}
                      value={test.expected}
                      disabled={!canEdit}
                      onValidityChange={(valid) =>
                        setJsonValidity(`manual-${index}-expected`, valid)
                      }
                      onChange={(value) =>
                        updateDraft((next) => {
                          next.manualTests[index]!.expected =
                            value as CatalogJsonValue;
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`manual-note-${index}`}>
                      {zh ? '审核说明' : 'Review note'}
                    </Label>
                    <Textarea
                      id={`manual-note-${index}`}
                      value={test.reviewNote}
                      disabled={!canEdit}
                      maxLength={2000}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.manualTests[index]!.reviewNote =
                            event.target.value;
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderEvidence() {
    if (!selectedDetail) return null;
    const source = selectedDetail.lockedSourceEvidence;
    const sourceEntries = source
      ? [
          ['Provider', source.provider],
          ['Repository', source.repository],
          ['Statement path', source.statementPath],
          ['Canonical path', source.canonicalPath],
          ['Statement hash', source.statementHash],
          ['Canonical hash', source.canonicalDataHash],
          ['License hash', source.licenseContentHash],
        ]
      : [];
    return (
      <div className="space-y-6">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <SectionHeading
              title={zh ? '锁定来源证据' : 'Locked source evidence'}
              description={
                zh
                  ? '这些字段来自固定的上游修订，审核草稿无法修改。'
                  : 'These fields come from a pinned upstream revision and cannot be edited in the review draft.'
              }
            />
            <Badge variant="outline" className="shrink-0 gap-1">
              <LockKeyhole className="size-3" />
              {zh ? '只读' : 'Read only'}
            </Badge>
          </div>
          <dl className="grid min-w-0 gap-x-4 gap-y-3 border p-4 text-sm md:grid-cols-[150px_minmax(0,1fr)]">
            <dt className="text-muted-foreground">License</dt>
            <dd className="min-w-0 break-words">
              {selectedDetail.licenseSpdx}
            </dd>
            <dt className="text-muted-foreground">Attribution</dt>
            <dd className="min-w-0 break-words">
              {selectedDetail.attribution}
            </dd>
            <dt className="text-muted-foreground">Source revision</dt>
            <dd className="min-w-0 font-mono text-xs break-all">
              {selectedDetail.sourceRevision}
            </dd>
            <dt className="text-muted-foreground">Content hash</dt>
            <dd className="min-w-0 font-mono text-xs break-all">
              {selectedDetail.contentHash}
            </dd>
            <dt className="text-muted-foreground">Upstream</dt>
            <dd className="min-w-0 break-all">
              {upstreamUrl ? (
                <a
                  className="inline-flex items-start gap-1 text-teal-700 underline underline-offset-4 dark:text-teal-300"
                  href={upstreamUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="min-w-0 break-all">
                    {selectedDetail.upstreamUrl}
                  </span>
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
                </a>
              ) : (
                <span>{selectedDetail.upstreamUrl}</span>
              )}
            </dd>
            {sourceEntries.map(([label, value]) => (
              <div className="contents" key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 font-mono text-xs break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-3 border-t pt-6">
          <SectionHeading
            title={zh ? 'JSON 预览' : 'JSON previews'}
            description={
              zh
                ? '预览按需加载，不会进入可编辑草稿。'
                : 'Previews load on demand and never become editable draft fields.'
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={previewKind === 'upstream' ? 'default' : 'outline'}
              onClick={() => void loadPreview('upstream')}
            >
              {previewLoading === 'upstream' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Code2 className="size-4" />
              )}
              {zh ? '上游 JSON' : 'Upstream JSON'}
            </Button>
            <Button
              type="button"
              variant={previewKind === 'compiled' ? 'default' : 'outline'}
              onClick={() => void loadPreview('compiled')}
            >
              {previewLoading === 'compiled' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Code2 className="size-4" />
              )}
              {zh ? '编译后 JSON' : 'Compiled JSON'}
            </Button>
          </div>
          {previewKind && Object.hasOwn(previewPayloads, previewKind) ? (
            <pre
              aria-label={`${previewKind} JSON preview`}
              className="bg-muted max-h-[520px] max-w-full overflow-auto border p-3 font-mono text-xs leading-5 whitespace-pre"
            >
              {JSON.stringify(previewPayloads[previewKind], null, 2)}
            </pre>
          ) : null}
        </section>

        {selectedDetail.evidence ? (
          <Collapsible className="border-t pt-4">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-between"
              >
                {zh ? '审核审计记录' : 'Review audit evidence'}
                <ChevronDown className="size-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="bg-muted mt-2 max-h-96 overflow-auto border p-3 text-xs leading-5">
                {JSON.stringify(selectedDetail.evidence, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {selectedDetail.status === 'published' && selectedDetail.problemSlug ? (
          <section className="space-y-4 border border-amber-600/30 p-4">
            <SectionHeading
              title={zh ? '回滚已发布版本' : 'Roll back published revision'}
              description={selectedDetail.problemSlug}
            />
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
                onChange={(event) => setRollbackVersion(event.target.value)}
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
              />
            </div>
            <Button
              variant="destructive"
              disabled={
                !capabilities.rollback ||
                capabilities.structuredReviewMode !== 'write' ||
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
          </section>
        ) : null}
      </div>
    );
  }

  function renderValidation() {
    if (!selectedDetail) return null;
    if (selectedDetail.validation?.valid) {
      return (
        <div className="flex items-center gap-2 border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="size-4 shrink-0" />
          <span>
            {zh ? '所有确定性门禁已通过' : 'All deterministic gates passed'}
          </span>
        </div>
      );
    }
    const issues = selectedDetail.validation?.issues ?? [];
    if (issues.length === 0) {
      return (
        <div className="text-muted-foreground border p-4 text-sm">
          {zh ? '尚未执行校验' : 'Validation has not run yet'}
        </div>
      );
    }
    return (
      <div className="min-w-0 divide-y border">
        {issues.map((issue, index) => (
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
        ))}
      </div>
    );
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
        <Select
          value={status}
          onValueChange={(value) => {
            if (value === status || !confirmDiscard()) return;
            setStatus(value);
          }}
        >
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
          onClick={() => void refreshCurrent()}
          disabled={loading || detailLoading}
          title={zh ? '刷新' : 'Refresh'}
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </div>

      <div className="grid min-w-0 gap-2 lg:hidden">
        <Label htmlFor="catalog-mobile-candidate-select">
          {zh ? '选择审核候选' : 'Select candidate'}
        </Label>
        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select
            value={selectedId ?? ''}
            onValueChange={(value) => chooseCandidate(value)}
          >
            <SelectTrigger
              id="catalog-mobile-candidate-select"
              aria-label={zh ? '选择审核候选' : 'Select candidate'}
              className="w-full min-w-0"
            >
              <SelectValue
                placeholder={zh ? '选择一个候选' : 'Choose a candidate'}
              />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title?.zh || item.title?.en || item.externalId} ·{' '}
                  {item.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {nextCursor ? (
            <Button
              type="button"
              variant="outline"
              disabled={loadingMore}
              onClick={() =>
                void loadList({ cursor: nextCursor, append: true })
              }
            >
              {loadingMore ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {zh ? '加载更多候选' : 'Load more candidates'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-[640px] w-full max-w-full min-w-0 flex-1 overflow-hidden border lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden min-w-0 border-b lg:block lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3 text-sm font-medium">
            <span>
              {zh ? `${items.length} 个候选` : `${items.length} candidates`}
            </span>
            {serverQuery ? (
              <Badge variant="outline">
                {zh ? '服务器搜索' : 'Server search'}
              </Badge>
            ) : null}
          </div>
          <div className="max-h-72 overflow-y-auto lg:max-h-[760px]">
            {loading ? (
              <div
                aria-live="polite"
                className="text-muted-foreground flex items-center gap-2 p-4 text-sm"
              >
                <Loader2 className="size-4 animate-spin" />
                {zh ? '加载中' : 'Loading'}
              </div>
            ) : items.length === 0 ? (
              <div className="text-muted-foreground p-6 text-center text-sm">
                {zh ? '没有符合条件的候选' : 'No matching candidates'}
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selectedId === item.id}
                  onClick={() => chooseCandidate(item.id)}
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
          {nextCursor ? (
            <div className="border-t p-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={loadingMore}
                onClick={() =>
                  void loadList({ cursor: nextCursor, append: true })
                }
              >
                {loadingMore ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {zh ? '加载更多候选' : 'Load more candidates'}
              </Button>
            </div>
          ) : null}
        </aside>

        <section className="min-w-0 overflow-y-auto">
          {detailLoading && !selectedDetail ? (
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
              <div className="flex min-w-0 flex-col gap-3 border-b p-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="min-w-0 text-lg font-semibold break-words">
                      {draft?.title.zh ||
                        draft?.title.en ||
                        selectedDetail.title?.zh ||
                        selectedDetail.title?.en ||
                        selectedDetail.externalId}
                    </h2>
                    <Badge
                      variant="outline"
                      className={statusTone(selectedDetail.status)}
                    >
                      {selectedDetail.status}
                    </Badge>
                    {dirty ? (
                      <Badge
                        variant="outline"
                        className="border-amber-600/30 text-amber-700 dark:text-amber-300"
                      >
                        {zh ? '未保存' : 'Unsaved'}
                      </Badge>
                    ) : null}
                    {capabilities.structuredReviewMode !== 'write' ? (
                      <Badge variant="outline">
                        {capabilities.structuredReviewMode === 'shadow'
                          ? zh
                            ? '影子模式'
                            : 'Shadow mode'
                          : zh
                            ? '结构化审核关闭'
                            : 'Structured review off'}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs break-all">
                    {selectedDetail.externalId} ·{' '}
                    {selectedDetail.sourceRevision.slice(0, 12)} ·{' '}
                    {selectedDetail.changeKind || 'update'} · v
                    {selectedDetail.draftRevision}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !capabilities.review ||
                      capabilities.structuredReviewMode !== 'write' ||
                      !selectedDetail.reviewDraft ||
                      ![
                        'discovered',
                        'drafting',
                        'quarantined',
                        'validated',
                      ].includes(selectedDetail.status) ||
                      dirty ||
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
                      capabilities.structuredReviewMode !== 'write' ||
                      selectedDetail.status !== 'validated' ||
                      dirty ||
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
                      capabilities.structuredReviewMode !== 'write' ||
                      selectedDetail.status !== 'approved' ||
                      dirty ||
                      Boolean(action)
                    }
                    onClick={() => void mutate('publish')}
                  >
                    <Rocket className="size-4" />
                    {zh ? '发布' : 'Publish'}
                  </Button>
                </div>
              </div>

              {conflict ? (
                <div
                  role="alert"
                  className="m-4 mb-0 border border-amber-600/40 bg-amber-600/10 p-4"
                >
                  <div className="flex min-w-0 gap-3">
                    <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {zh ? '检测到版本冲突' : 'Revision conflict detected'}
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {conflict}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void recoverConflict(false)}
                        >
                          <RefreshCw className="size-4" />
                          {zh ? '载入服务器版本' : 'Load server version'}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void recoverConflict(true)}
                        >
                          {zh ? '保留本地更改' : 'Keep local edits'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {!selectedDetail.reviewDraft ? (
                <div className="m-4 min-w-0 space-y-5">
                  <div className="space-y-4 border p-5">
                    <SectionHeading
                      title={
                        zh ? '需要结构化草稿' : 'Structured draft required'
                      }
                      description={
                        zh
                          ? '此候选仍是旧版或发现阶段格式。先转换后才能使用字段化审核工具。'
                          : 'This candidate is still in a legacy or discovery format. Normalize it before structured review.'
                      }
                    />
                    <Button
                      disabled={
                        !capabilities.review ||
                        capabilities.structuredReviewMode !== 'write' ||
                        !selectedDetail.editable ||
                        Boolean(action)
                      }
                      onClick={() => void mutate('normalize')}
                    >
                      {action === 'normalize' ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <FileDiff className="size-4" />
                      )}
                      {zh ? '转换为结构化草稿' : 'Normalize structured draft'}
                    </Button>
                  </div>
                  <Tabs defaultValue="evidence" className="min-w-0">
                    <TabsList className="grid w-full grid-cols-2 sm:w-auto">
                      <TabsTrigger value="evidence">
                        {zh ? '来源证据' : 'Evidence'}
                      </TabsTrigger>
                      <TabsTrigger value="validation">
                        {zh ? '校验结果' : 'Validation'}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="evidence" className="mt-5 min-w-0">
                      {renderEvidence()}
                    </TabsContent>
                    <TabsContent value="validation" className="mt-5 min-w-0">
                      {renderValidation()}
                    </TabsContent>
                  </Tabs>
                </div>
              ) : draft ? (
                <Tabs defaultValue="content" className="min-w-0 p-4">
                  <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4 lg:w-auto lg:grid-flow-col lg:grid-cols-none">
                    <TabsTrigger value="content">
                      {zh ? '题目内容' : 'Content'}
                    </TabsTrigger>
                    <TabsTrigger value="tests">
                      {zh ? '测试用例' : 'Tests'}
                    </TabsTrigger>
                    <TabsTrigger value="evidence">
                      {zh ? '来源证据' : 'Evidence'}
                    </TabsTrigger>
                    <TabsTrigger value="validation">
                      {zh ? '校验结果' : 'Validation'}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="content" className="mt-5 min-w-0">
                    {renderBasicEditor(draft)}
                  </TabsContent>
                  <TabsContent value="tests" className="mt-5 min-w-0">
                    {renderTestsEditor(draft)}
                  </TabsContent>
                  <TabsContent value="evidence" className="mt-5 min-w-0">
                    {renderEvidence()}
                  </TabsContent>
                  <TabsContent value="validation" className="mt-5 min-w-0">
                    {renderValidation()}
                  </TabsContent>
                </Tabs>
              ) : null}

              <div className="space-y-4 border-t p-4">
                <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="catalog-notes">
                      {zh ? '审核说明' : 'Review notes'}
                    </Label>
                    <Textarea
                      id="catalog-notes"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      maxLength={2000}
                      placeholder={
                        zh
                          ? '记录翻译、测试或发布判断依据'
                          : 'Record translation, test, or release rationale'
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedDetail.reviewDraft ? (
                      <Button
                        disabled={
                          !canEdit ||
                          !dirty ||
                          invalidJsonFields.size > 0 ||
                          templatesStale ||
                          Boolean(action)
                        }
                        onClick={() => void mutate('save')}
                      >
                        {action === 'save' ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Save className="size-4" />
                        )}
                        {zh ? '保存草稿' : 'Save draft'}
                      </Button>
                    ) : null}
                    <Button
                      variant="destructive"
                      disabled={
                        !capabilities.review ||
                        capabilities.structuredReviewMode !== 'write' ||
                        !notes.trim() ||
                        dirty ||
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
                </div>

                <div className="grid min-w-0 gap-2 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
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
                        capabilities.structuredReviewMode !== 'write' ||
                        [
                          'approved',
                          'published',
                          'rejected',
                          'archived',
                        ].includes(selectedDetail.status)
                      }
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={
                      !capabilities.review ||
                      capabilities.structuredReviewMode !== 'write' ||
                      dirty ||
                      [
                        'approved',
                        'published',
                        'rejected',
                        'archived',
                      ].includes(selectedDetail.status) ||
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
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
