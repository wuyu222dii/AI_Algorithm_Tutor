import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogCandidateConsole } from './catalog-candidate-console';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock('@/shared/components/ui/tabs', () => ({
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: React.PropsWithChildren) => (
    <button type="button">{children}</button>
  ),
  TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function summary(
  id: string,
  title: string,
  status: 'quarantined' | 'validated' | 'published' = 'validated'
) {
  return {
    id,
    externalId: `external-${id}`,
    status,
    changeKind: 'new',
    draftRevision: 2,
    sourceRevision: 'abcdef1234567890',
    updatedAt: '2026-07-15T00:00:00.000Z',
    title: { zh: title, en: title },
  };
}

function detail(
  id: string,
  title: string,
  status: 'quarantined' | 'validated' | 'published' = 'validated',
  upstreamUrl = 'https://github.com/exercism/problem-specifications'
) {
  return {
    ...summary(id, title, status),
    upstreamUrl,
    contentHash: 'sha256:123',
    licenseSpdx: 'MIT',
    attribution: 'Exercism contributors',
    upstreamPayload: { source: 'exercism' },
    draftProblem: { slug: 'two-fer', title: { zh: title, en: title } },
    validation: { valid: true, issues: [] },
    evidence: { sourceRevision: 'abcdef1234567890' },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CatalogCandidateConsole', () => {
  it('renders a read-only review console and does not link unsafe upstream URLs', async () => {
    const item = summary('candidate-1', '候选题');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('?')) {
        return json({
          data: {
            items: [item],
            capabilities: { review: false, publish: false, rollback: false },
          },
        });
      }
      return json({
        data: detail(
          'candidate-1',
          '候选题',
          'validated',
          'javascript:alert(document.domain)'
        ),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CatalogCandidateConsole locale="zh" />);

    expect(
      await screen.findByRole('heading', { name: '候选题' })
    ).toBeVisible();
    expect(screen.getByLabelText('搜索候选题目')).toBeVisible();
    expect(screen.getByLabelText('筛选候选状态')).toBeVisible();
    expect(screen.getByLabelText('刷新候选列表')).toBeVisible();
    expect(screen.getByLabelText('结构化题目草稿')).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新校验' })).toBeDisabled();
    expect(
      screen.queryByRole('link', { name: 'javascript:alert(document.domain)' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('javascript:alert(document.domain)')).toBeVisible();
  });

  it('reuses the idempotency key when the same mutation is retried', async () => {
    const item = summary('candidate-1', '候选题');
    const mutationRequests: RequestInit[] = [];
    let mutationAttempt = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        if (url.endsWith('/candidate-1/approve')) {
          mutationRequests.push(init);
          mutationAttempt += 1;
          if (mutationAttempt === 1) throw new Error('Network interrupted');
          return json({ data: { approved: 1 } });
        }
        if (url.includes('?')) {
          return json({
            data: {
              items: [item],
              capabilities: { review: true, publish: false, rollback: false },
            },
          });
        }
        return json({ data: detail('candidate-1', '候选题') });
      }
    );
    vi.stubGlobal('fetch', fetchMock);

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
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());

    expect(mutationRequests).toHaveLength(2);
    const firstHeaders = mutationRequests[0].headers as Record<string, string>;
    const secondHeaders = mutationRequests[1].headers as Record<string, string>;
    expect(firstHeaders['idempotency-key']).toMatch(/^approve:/);
    expect(secondHeaders['idempotency-key']).toBe(
      firstHeaders['idempotency-key']
    );
    expect(JSON.parse(String(mutationRequests[1].body))).toEqual({
      notes: '测试与署名已检查',
    });
  });

  it('links a renamed exercise to an existing problem identity', async () => {
    const item = summary('candidate-1', '候选题', 'quarantined');
    let patchRequest: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        if (
          url === '/api/admin/catalog/candidates/candidate-1' &&
          init.method
        ) {
          patchRequest = init;
          return json({
            data: {
              candidateId: 'candidate-1',
              draftRevision: 3,
              targetProblemId: 'problem-1',
            },
          });
        }
        if (url.includes('?')) {
          return json({
            data: {
              items: [item],
              capabilities: { review: true, publish: false, rollback: false },
            },
          });
        }
        return json({
          data: {
            ...detail('candidate-1', '候选题', 'quarantined'),
            targetProblemSlug: '',
          },
        });
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<CatalogCandidateConsole locale="zh" />);
    const target = await screen.findByLabelText('已有题目 slug');
    fireEvent.change(target, { target: { value: 'exercism-two-fer' } });
    fireEvent.click(screen.getByRole('button', { name: '关联题目' }));

    await waitFor(() => expect(patchRequest).toBeDefined());
    expect(JSON.parse(String(patchRequest?.body))).toEqual({
      targetProblemSlug: 'exercism-two-fer',
      expectedDraftRevision: 2,
    });
    expect(
      (patchRequest?.headers as Record<string, string>)['idempotency-key']
    ).toMatch(/^associate:/);
  });

  it('ignores a stale detail response after another candidate is selected', async () => {
    const first = summary('candidate-a', '候选 A');
    const second = summary('candidate-b', '候选 B');
    let resolveFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('?')) {
        return json({
          data: {
            items: [first, second],
            capabilities: { review: true, publish: false, rollback: false },
          },
        });
      }
      if (url.endsWith('/candidate-a')) return firstResponse;
      return json({ data: detail('candidate-b', '详情 B') });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CatalogCandidateConsole locale="zh" />);
    fireEvent.click(
      await screen.findByRole('button', { name: /候选 B.*validated/ })
    );
    expect(
      await screen.findByRole('heading', { name: '详情 B' })
    ).toBeVisible();

    resolveFirst?.(json({ data: detail('candidate-a', '详情 A') }));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByRole('heading', { name: '详情 A' })).toBeNull();
    expect(screen.getByRole('heading', { name: '详情 B' })).toBeVisible();
  });

  it('submits rollback only with capability, target version, and notes', async () => {
    const item = summary('candidate-1', '已发布候选', 'published');
    let rollbackRequest: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        if (url === '/api/admin/catalog/rollback') {
          rollbackRequest = init;
          return json({
            data: { problemSlug: 'two-fer', fromVersion: 3, toVersion: 1 },
          });
        }
        if (url.includes('?')) {
          return json({
            data: {
              items: [item],
              capabilities: { review: true, publish: true, rollback: true },
            },
          });
        }
        return json({
          data: detail('candidate-1', '已发布候选', 'published'),
        });
      }
    );
    vi.stubGlobal('fetch', fetchMock);

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
    const headers = rollbackRequest?.headers as Record<string, string>;
    expect(headers['idempotency-key']).toMatch(/^rollback:/);
  });
});
