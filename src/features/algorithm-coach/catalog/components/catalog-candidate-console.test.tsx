import type { PropsWithChildren } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CatalogReviewDraftV2,
  CatalogSourceProvenanceV1,
} from '../admin-contracts';
import { CatalogCandidateConsole } from './catalog-candidate-console';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    options?: { ariaLabel?: string; readOnly?: boolean };
  }) => (
    <textarea
      aria-label={options?.ariaLabel}
      value={value}
      readOnly={options?.readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  loader: { config: vi.fn() },
}));
vi.mock('@/shared/components/ui/tabs', () => ({
  Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: PropsWithChildren) => (
    <button type="button">{children}</button>
  ),
  TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/shared/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
    'aria-label': ariaLabel,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

type CandidateStatus =
  | 'discovered'
  | 'drafting'
  | 'quarantined'
  | 'validated'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'archived';

type StructuredReviewMode = 'off' | 'shadow' | 'write';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function reviewDraft(
  overrides: Partial<CatalogReviewDraftV2> = {}
): CatalogReviewDraftV2 {
  return {
    schemaVersion: 2,
    id: 'ex-101',
    slug: 'two-fer',
    title: { zh: '候选题', en: 'Two Fer' },
    description: {
      zh: '给定姓名，返回分享字符串。',
      en: 'Return a sharing string for a name.',
    },
    difficulty: 'easy',
    topics: ['strings'],
    learningObjectives: [
      { zh: '练习默认参数', en: 'Practice default parameters' },
    ],
    prerequisiteTopics: ['functions'],
    solutionPatterns: ['nullish fallback'],
    constraints: [{ zh: '必须返回字符串', en: 'Return a string' }],
    hints: [
      { zh: '先处理空值', en: 'Handle missing input first' },
      { zh: '构造分享文本', en: 'Build the sharing text' },
      { zh: '返回最终结果', en: 'Return the final result' },
    ],
    reviewPoints: [{ zh: '检查默认姓名', en: 'Check the default name' }],
    estimatedMinutes: 15,
    functionProtocol: {
      signature: {
        parameters: [{ name: 'name', type: { kind: 'string' } }],
        returns: { kind: 'string' },
      },
      entryPoints: {
        javascript: 'twoFer',
        python: 'two_fer',
        typescript: 'twoFer',
      },
      templates: {
        javascript: 'export function twoFer(name) {}',
        python: 'def two_fer(name):\n    pass',
        typescript: 'export function twoFer(name: string): string {}',
      },
    },
    canonicalSelections: [],
    manualTests: [],
    ...overrides,
  };
}

function sourceEvidence(): CatalogSourceProvenanceV1 {
  const revision = 'a'.repeat(40);
  const hash = `sha256:${'b'.repeat(64)}`;
  return {
    provider: 'exercism',
    repository: 'exercism/problem-specifications',
    externalId: 'two-fer',
    upstreamUrl: `https://github.com/exercism/problem-specifications/tree/${revision}/exercises/two-fer`,
    statementPath: 'exercises/two-fer/.docs/instructions.md',
    canonicalPath: 'exercises/two-fer/canonical-data.json',
    sourceRevision: revision,
    licenseSpdx: 'MIT',
    attribution: 'Exercism contributors',
    statementHash: hash,
    canonicalDataHash: hash,
    licenseContentHash: hash,
    statementBlobSha: 'c'.repeat(40),
    canonicalBlobSha: 'd'.repeat(40),
  };
}

function summary(
  id = 'candidate-1',
  title = '候选题',
  status: CandidateStatus = 'validated',
  draftRevision = 2
) {
  return {
    id,
    externalId: `external-${id}`,
    status,
    changeKind: 'new',
    draftRevision,
    sourceRevision: 'a'.repeat(40),
    updatedAt: '2026-07-15T00:00:00.000Z',
    title: { zh: title, en: title },
  };
}

function detail(
  overrides: Partial<
    ReturnType<typeof summary> & {
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
      targetProblemSlug?: string;
      evidence?: Record<string, unknown>;
    }
  > = {}
) {
  return {
    ...summary(),
    upstreamUrl:
      'https://github.com/exercism/problem-specifications/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/exercises/two-fer',
    contentHash: `sha256:${'e'.repeat(64)}`,
    licenseSpdx: 'MIT',
    attribution: 'Exercism contributors',
    draftKind: 'review_v2' as const,
    reviewDraft: reviewDraft(),
    lockedSourceEvidence: sourceEvidence(),
    editable: true,
    validation: { valid: true, issues: [] },
    evidence: { reviewer: 'reviewer-1' },
    ...overrides,
  };
}

function capabilities(
  structuredReviewMode: StructuredReviewMode = 'write',
  overrides: Partial<{
    review: boolean;
    publish: boolean;
    rollback: boolean;
  }> = {}
) {
  return {
    review: true,
    publish: false,
    rollback: false,
    structuredReviewMode,
    ...overrides,
  };
}

function canonicalPage(
  items: Array<{
    sourceTestUuid: string;
    description?: string;
    sourceOrder: number;
    status: 'mapped' | 'unmappable';
    args?: unknown[];
    expected?: unknown;
    reason?: string;
  }> = [],
  templates?: CatalogReviewDraftV2['functionProtocol']['templates']
) {
  return {
    items,
    total: items.length,
    mapped: items.filter((item) => item.status === 'mapped').length,
    selected: [],
    ...(templates ? { templates } : {}),
  };
}

type FetchHandler = (
  url: string,
  init: RequestInit
) => Response | undefined | Promise<Response | undefined>;

function installServer({
  candidate = detail(),
  items,
  access = capabilities(),
  canonical = canonicalPage(),
  handle,
}: {
  candidate?: ReturnType<typeof detail> | (() => ReturnType<typeof detail>);
  items?: ReturnType<typeof summary>[];
  access?: ReturnType<typeof capabilities>;
  canonical?:
    | ReturnType<typeof canonicalPage>
    | ((url: string, init: RequestInit) => ReturnType<typeof canonicalPage>);
  handle?: FetchHandler;
} = {}) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const handled = await handle?.(url, init);
      if (handled) return handled;

      if (url.includes('/canonical-cases')) {
        const page =
          typeof canonical === 'function' ? canonical(url, init) : canonical;
        return json({ data: page });
      }
      if (url.startsWith('/api/admin/catalog/candidates?')) {
        const current = typeof candidate === 'function' ? undefined : candidate;
        const listedItems =
          items ??
          (current
            ? [
                summary(
                  current.id,
                  current.title?.zh || current.externalId,
                  current.status,
                  current.draftRevision
                ),
              ]
            : [summary()]);
        return json({
          data: {
            items: listedItems,
            capabilities: access,
          },
        });
      }
      if (url === '/api/admin/catalog/candidates/candidate-1' && !init.method) {
        const current =
          typeof candidate === 'function' ? candidate() : candidate;
        return json({ data: current });
      }
      throw new Error(`Unexpected request: ${init.method || 'GET'} ${url}`);
    }
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CatalogCandidateConsole V2 review workflow', () => {
  it('renders structured fields read-only in shadow mode and never links an unsafe upstream URL', async () => {
    const unsafeUrl = 'javascript:alert(document.domain)';
    installServer({
      candidate: detail({ upstreamUrl: unsafeUrl }),
      access: capabilities('shadow'),
    });

    render(<CatalogCandidateConsole locale="zh" />);

    expect(
      await screen.findByRole('heading', { name: '候选题' })
    ).toBeVisible();
    expect(screen.getByText('影子模式')).toBeVisible();
    expect(screen.getByLabelText('题目 ID')).toHaveValue('ex-101');
    expect(screen.getByLabelText('题目 ID')).toBeDisabled();
    expect(screen.getByLabelText('JavaScript starter template')).toHaveValue(
      'export function twoFer(name) {}'
    );
    expect(
      screen.getByLabelText('JavaScript starter template')
    ).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
    expect(screen.getByText('锁定来源证据')).toBeVisible();
    expect(screen.queryByRole('link', { name: unsafeUrl })).toBeNull();
    expect(screen.getByText(unsafeUrl)).toBeVisible();
  });

  it('sends the exact V2 save payload and confirms before discarding a dirty draft', async () => {
    const initialDraft = reviewDraft();
    let saveRequest: RequestInit | undefined;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = installServer({
      candidate: detail({
        reviewDraft: initialDraft,
        targetProblemSlug: 'existing-two-fer',
      }),
      handle: (url, init) => {
        if (
          url === '/api/admin/catalog/candidates/candidate-1' &&
          init.method === 'PATCH'
        ) {
          saveRequest = init;
          return json({
            data: { candidateId: 'candidate-1', draftRevision: 3 },
          });
        }
      },
    });

    render(<CatalogCandidateConsole locale="zh" />);
    expect(await screen.findByLabelText('题目 ID')).toBeDisabled();
    expect(screen.getByLabelText('Slug')).toBeDisabled();
    fireEvent.change(await screen.findByDisplayValue('候选题'), {
      target: { value: '本地编辑题目' },
    });

    expect(screen.getByText('未保存')).toBeVisible();
    const listCallsBeforeRefresh = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith('/api/admin/catalog/candidates?')
    ).length;
    fireEvent.click(screen.getByLabelText('刷新候选列表'));
    expect(confirm).toHaveBeenCalledWith(
      '当前候选有未保存的更改。放弃这些更改吗？'
    );
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith('/api/admin/catalog/candidates?')
      )
    ).toHaveLength(listCallsBeforeRefresh);

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(saveRequest).toBeDefined());

    expect(saveRequest?.method).toBe('PATCH');
    expect(JSON.parse(String(saveRequest?.body))).toEqual({
      schemaVersion: 2,
      expectedDraftRevision: 2,
      draft: {
        ...initialDraft,
        title: { ...initialDraft.title, zh: '本地编辑题目' },
      },
    });
    expect(saveRequest?.headers).toEqual(
      expect.objectContaining({
        'content-type': 'application/json',
        'idempotency-key': expect.stringMatching(/^save:/),
      })
    );
  });

  it('normalizes discovery data with only the expected revision', async () => {
    let normalizeRequest: RequestInit | undefined;
    installServer({
      candidate: detail({
        status: 'discovered',
        draftKind: 'discovery',
        reviewDraft: undefined,
      }),
      handle: (url, init) => {
        if (url.endsWith('/candidate-1/normalize')) {
          normalizeRequest = init;
          return json({
            data: { candidateId: 'candidate-1', draftRevision: 3 },
          });
        }
      },
    });

    render(<CatalogCandidateConsole locale="zh" />);
    fireEvent.click(
      await screen.findByRole('button', { name: '转换为结构化草稿' })
    );

    await waitFor(() => expect(normalizeRequest).toBeDefined());
    expect(normalizeRequest?.method).toBe('POST');
    expect(JSON.parse(String(normalizeRequest?.body))).toEqual({
      expectedDraftRevision: 2,
    });
    expect(normalizeRequest?.headers).toEqual(
      expect.objectContaining({
        'idempotency-key': expect.stringMatching(/^normalize:/),
      })
    );
  });

  it('loads saved canonical mappings with GET, previews mappings with POST, and saves selection metadata only', async () => {
    const getCase = {
      sourceTestUuid: 'uuid-from-get',
      description: 'saved mapping',
      sourceOrder: 0,
      status: 'mapped' as const,
      args: ['Alice'],
      expected: 'One for Alice, one for me.',
    };
    const postCase = {
      sourceTestUuid: 'uuid-from-post',
      description: 'preview mapping',
      sourceOrder: 1,
      status: 'mapped' as const,
      args: ['Bob'],
      expected: 'One for Bob, one for me.',
    };
    let saveRequest: RequestInit | undefined;
    const fetchMock = installServer({
      canonical: (_url, init) =>
        init.method === 'POST'
          ? canonicalPage([postCase])
          : canonicalPage([getCase]),
      handle: (url, init) => {
        if (
          url === '/api/admin/catalog/candidates/candidate-1' &&
          init.method === 'PATCH'
        ) {
          saveRequest = init;
          return json({
            data: { candidateId: 'candidate-1', draftRevision: 3 },
          });
        }
      },
    });

    render(<CatalogCandidateConsole locale="zh" />);
    fireEvent.click(await screen.findByLabelText('选择 uuid-from-get'));
    fireEvent.click(screen.getByRole('button', { name: '刷新映射' }));
    fireEvent.click(await screen.findByLabelText('选择 uuid-from-post'));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(saveRequest).toBeDefined());
    const canonicalCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/canonical-cases')
    );
    expect(String(canonicalCalls[0]?.[0])).toBe(
      '/api/admin/catalog/candidates/candidate-1/canonical-cases?cursor=0&limit=50'
    );
    expect(canonicalCalls[0]?.[1]).toEqual({ cache: 'no-store' });

    const postCall = canonicalCalls.find(([, init]) => init?.method === 'POST');
    expect(String(postCall?.[0])).toBe(
      '/api/admin/catalog/candidates/candidate-1/canonical-cases'
    );
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      signature: reviewDraft().functionProtocol.signature,
      entryPoints: reviewDraft().functionProtocol.entryPoints,
      cursor: 0,
      limit: 50,
    });

    const payload = JSON.parse(String(saveRequest?.body)) as {
      draft: CatalogReviewDraftV2;
    };
    expect(payload.draft.canonicalSelections).toEqual([
      {
        sourceTestUuid: 'uuid-from-get',
        id: 'canonical-1',
        isSample: true,
      },
      {
        sourceTestUuid: 'uuid-from-post',
        id: 'canonical-2',
        isSample: false,
      },
    ]);
    expect(payload.draft.canonicalSelections[0]).not.toHaveProperty('args');
    expect(payload.draft.canonicalSelections[0]).not.toHaveProperty('expected');
  });

  it('marks templates stale after a protocol edit and regenerates them only after confirmation', async () => {
    const regeneratedTemplates = {
      javascript: 'function twoFer(name) { throw new Error("TODO"); }',
      python: 'def two_fer_v2(name):\n    pass',
      typescript:
        'function twoFer(name: string): string { throw new Error("TODO"); }',
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = installServer({
      canonical: (_url, init) =>
        init.method === 'POST'
          ? canonicalPage([], regeneratedTemplates)
          : canonicalPage(),
    });

    render(<CatalogCandidateConsole locale="zh" />);
    fireEvent.change(await screen.findByLabelText('Python 入口函数'), {
      target: { value: 'two_fer_v2' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('当前模板已过期');
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重新生成模板' }));
    expect(confirm).toHaveBeenCalledWith(
      '将按当前函数签名和入口函数重新生成三语言模板，并覆盖现有模板。是否继续？'
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Python starter template')).toHaveValue(
        regeneratedTemplates.python
      )
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();

    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes('/canonical-cases') && init?.method === 'POST'
    );
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      entryPoints: {
        javascript: 'twoFer',
        python: 'two_fer_v2',
        typescript: 'twoFer',
      },
    });
  });

  it('loads JSON previews lazily and caches each preview kind', async () => {
    const previewRequests: string[] = [];
    installServer({
      handle: (url) => {
        if (url.includes('/preview?kind=')) {
          previewRequests.push(url);
          return json({
            data: {
              kind: 'upstream',
              payload: { source: 'exercism', exercise: 'two-fer' },
            },
          });
        }
      },
    });

    render(<CatalogCandidateConsole locale="zh" />);
    await screen.findByRole('heading', { name: '候选题' });
    expect(previewRequests).toEqual([]);

    const upstream = screen.getByRole('button', { name: '上游 JSON' });
    fireEvent.click(upstream);
    expect(
      await screen.findByLabelText('upstream JSON preview')
    ).toHaveTextContent('"source": "exercism"');
    fireEvent.click(upstream);
    await waitFor(() => expect(previewRequests).toHaveLength(1));
    expect(previewRequests[0]).toBe(
      '/api/admin/catalog/candidates/candidate-1/preview?kind=upstream'
    );
  });

  it('recovers a 409 by keeping local fields on the latest server revision', async () => {
    const localBase = reviewDraft();
    const serverDraft = reviewDraft({
      title: { zh: '服务器题目', en: 'Server title' },
    });
    let detailReads = 0;
    const saveRequests: RequestInit[] = [];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    installServer({
      candidate: () => {
        detailReads += 1;
        return detailReads === 1
          ? detail({ draftRevision: 2, reviewDraft: localBase })
          : detail({
              draftRevision: 5,
              reviewDraft: serverDraft,
              title: serverDraft.title,
            });
      },
      handle: (url, init) => {
        if (
          url === '/api/admin/catalog/candidates/candidate-1' &&
          init.method === 'PATCH'
        ) {
          saveRequests.push(init);
          if (saveRequests.length === 1) {
            return json(
              {
                error: {
                  code: 'candidate_revision_conflict',
                  message: 'The candidate draft revision changed.',
                },
              },
              409
            );
          }
          return json({
            data: { candidateId: 'candidate-1', draftRevision: 6 },
          });
        }
      },
    });

    render(<CatalogCandidateConsole locale="zh" />);
    fireEvent.change(await screen.findByDisplayValue('候选题'), {
      target: { value: '保留的本地题目' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '检测到版本冲突'
    );
    fireEvent.click(screen.getByRole('button', { name: '保留本地更改' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(confirm).toHaveBeenCalledWith(
      '这会使用服务器的最新修订号保留本地内容。再次保存将覆盖服务器草稿，是否继续？'
    );
    expect(screen.getByDisplayValue('保留的本地题目')).toBeVisible();
    expect(screen.getByText(/· v5$/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(saveRequests).toHaveLength(2));
    const firstPayload = JSON.parse(String(saveRequests[0]?.body));
    const secondPayload = JSON.parse(String(saveRequests[1]?.body));
    expect(firstPayload.expectedDraftRevision).toBe(2);
    expect(secondPayload.expectedDraftRevision).toBe(5);
    expect(secondPayload.draft.title.zh).toBe('保留的本地题目');
    expect(
      (saveRequests[1]?.headers as Record<string, string>)['idempotency-key']
    ).not.toBe(
      (saveRequests[0]?.headers as Record<string, string>)['idempotency-key']
    );
  });

  it('reuses an idempotency key when the identical approval is retried', async () => {
    const mutationRequests: RequestInit[] = [];
    installServer({
      handle: (url, init) => {
        if (url.endsWith('/candidate-1/approve')) {
          mutationRequests.push(init);
          if (mutationRequests.length === 1) {
            throw new Error('Network interrupted');
          }
          return json({ data: { approved: 1 } });
        }
      },
    });

    render(<CatalogCandidateConsole locale="zh" />);
    const approve = await screen.findByRole('button', { name: '批准' });
    fireEvent.change(screen.getByLabelText('审核说明'), {
      target: { value: '测试与署名已检查' },
    });
    fireEvent.click(approve);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Network interrupted')
    );
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() => expect(mutationRequests).toHaveLength(2));

    const firstHeaders = mutationRequests[0]?.headers as Record<string, string>;
    const secondHeaders = mutationRequests[1]?.headers as Record<
      string,
      string
    >;
    expect(firstHeaders['idempotency-key']).toMatch(/^approve:/);
    expect(secondHeaders['idempotency-key']).toBe(
      firstHeaders['idempotency-key']
    );
    expect(JSON.parse(String(mutationRequests[1]?.body))).toEqual({
      notes: '测试与署名已检查',
      expectedDraftRevision: 2,
    });
  });

  it('submits rollback only with capability, target version, and notes', async () => {
    let rollbackRequest: RequestInit | undefined;
    installServer({
      candidate: detail({
        status: 'published',
        draftKind: 'released',
        editable: false,
        problemSlug: 'two-fer',
      }),
      access: capabilities('write', { publish: true, rollback: true }),
      handle: (url, init) => {
        if (url === '/api/admin/catalog/rollback') {
          rollbackRequest = init;
          return json({
            data: { problemSlug: 'two-fer', fromVersion: 3, toVersion: 1 },
          });
        }
      },
    });

    render(<CatalogCandidateConsole locale="zh" />);
    const rollback = await screen.findByRole('button', { name: '确认回滚' });
    expect(rollback).toBeDisabled();
    fireEvent.change(screen.getByLabelText('目标版本'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText('回滚说明'), {
      target: { value: '新版本存在边界回归' },
    });
    expect(rollback).toBeEnabled();
    fireEvent.click(rollback);

    await waitFor(() => expect(rollbackRequest).toBeDefined());
    expect(JSON.parse(String(rollbackRequest?.body))).toEqual({
      slug: 'two-fer',
      targetVersion: 1,
      notes: '新版本存在边界回归',
    });
    expect(rollbackRequest?.headers).toEqual(
      expect.objectContaining({
        'idempotency-key': expect.stringMatching(/^rollback:/),
      })
    );
  });
});
