import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialCoachState } from '../storage';
import type {
  CodeRunResult,
  LearningArtifact,
  Problem,
  ReviewItem,
} from '../types';
import { ReviewPage } from './review-page';

const mocks = vi.hoisted(() => ({
  coach: null as unknown as Record<string, unknown>,
}));

vi.mock('next-intl', () => ({ useLocale: () => 'zh' }));
vi.mock('@/core/i18n/navigation', () => ({
  Link: ({ href, ...props }: React.ComponentProps<'a'>) => (
    <a href={String(href)} {...props} />
  ),
}));
vi.mock('@/shared/components/ui/tabs', () => ({
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: React.PropsWithChildren) => (
    <button type="button">{children}</button>
  ),
  TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('../store', () => ({ useCoachStore: () => mocks.coach }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function problem(version: number, title: string): Problem {
  return {
    id: 'versioned-problem',
    slug: 'versioned-problem',
    title: { zh: title, en: title },
    description: { zh: '题面', en: 'Statement' },
    difficulty: 'medium',
    topics: [version === 1 ? 'stack' : 'binary-search'],
    languageConfigs: {
      javascript: { entryPoint: 'solve', template: 'function solve() {}' },
    },
    version: { contentVersion: version },
    tests: [],
    examples: [],
    constraints: [],
    hints: {
      zh: ['提示一', '提示二', '提示三'],
      en: ['Hint one', 'Hint two', 'Hint three'],
    },
    reviewPoints: [],
    estimatedMinutes: 15,
  };
}

function failedRun(version: number, executedAt: string): CodeRunResult {
  return {
    id: `failed-v${version}`,
    problemSlug: 'versioned-problem',
    problemContentVersion: version,
    language: 'javascript',
    status: 'failed',
    passedTests: 0,
    totalTests: 1,
    testResults: [],
    console: [],
    durationMs: 2,
    executedAt,
    testScope: 'full',
    error: `version ${version} error`,
  };
}

describe('ReviewPage revision isolation', () => {
  const rateReview = vi.fn();
  const markReviewMastered = vi.fn();

  beforeEach(() => {
    rateReview.mockReset();
    markReviewMastered.mockReset();
    const state = createInitialCoachState();
    state.runs = [
      failedRun(1, '2026-07-14T10:00:00.000Z'),
      failedRun(2, '2026-07-14T11:00:00.000Z'),
    ];
    state.artifacts = [
      {
        id: 'review-v1',
        type: 'review_card',
        locale: 'zh',
        problemSlug: 'versioned-problem',
        problemContentVersion: 1,
        title: '历史版本复习卡',
        summary: '历史版本归纳',
        details: [],
        evidence: [],
        createdAt: '2026-07-14T12:00:00.000Z',
      } satisfies LearningArtifact,
    ];
    const reviewItem: ReviewItem = {
      problemSlug: 'versioned-problem',
      problemContentVersion: 1,
      status: 'due',
      source: 'mistake',
      dueAt: '2026-07-14T10:00:00.000Z',
      intervalDays: 1,
      repetitions: 0,
      easeFactor: 2.5,
      updatedAt: '2026-07-14T10:00:00.000Z',
    };
    mocks.coach = {
      problems: [problem(2, '当前版本标题'), problem(1, '历史版本标题')],
      reviewItems: { 'versioned-problem': reviewItem },
      state,
      rateReview,
      markReviewMastered,
      addArtifact: vi.fn(),
      recordReviewAttempt: vi.fn(),
    };
  });

  it('keeps the mistake count, actions, and retry link on the review revision', () => {
    render(<ReviewPage />);

    expect(screen.getAllByText('历史版本标题')).toHaveLength(2);
    expect(screen.queryByText('当前版本标题')).not.toBeInTheDocument();
    expect(screen.getByText('1 次未通过')).toBeVisible();
    expect(screen.getByText('version 1 error')).toBeVisible();
    expect(screen.queryByText('version 2 error')).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole('link', { name: '重新练习' })
        .every(
          (link) =>
            link.getAttribute('href') ===
            '/practice/versioned-problem?version=1'
        )
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '标记已掌握' }));
    expect(markReviewMastered).toHaveBeenCalledWith('versioned-problem', 1);
  });

  it('rates the matching revision from its review card', () => {
    render(<ReviewPage />);
    fireEvent.click(screen.getByRole('button', { name: '掌握' }));

    expect(rateReview).toHaveBeenCalledWith(
      'versioned-problem',
      'good',
      expect.objectContaining({ problemContentVersion: 1 })
    );
    expect(
      screen
        .getAllByRole('link', { name: '重新练习' })
        .every(
          (link) =>
            link.getAttribute('href') ===
            '/practice/versioned-problem?version=1'
        )
    ).toBe(true);
  });

  it('preserves the response and offers manual rating when AI grading fails', async () => {
    const recordReviewAttempt = vi.fn();
    const state = createInitialCoachState();
    state.artifacts = [
      {
        id: 'structured-card',
        type: 'review_card',
        locale: 'zh',
        problemSlug: 'versioned-problem',
        problemContentVersion: 1,
        title: '主动回忆卡',
        summary: '总结',
        details: [],
        evidence: [],
        reviewCard: {
          front: '核心思路是什么？',
          back: '维护单调结构并处理边界条件。',
          tags: ['stack'],
        },
        createdAt: '2026-07-14T12:00:00.000Z',
      },
    ];
    mocks.coach = {
      ...mocks.coach,
      state,
      recordReviewAttempt,
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'provider_timeout' } }),
            { status: 504, headers: { 'content-type': 'application/json' } }
          )
        )
    );

    const rendered = render(<ReviewPage />);
    const rerenderPage = rendered.rerender;
    recordReviewAttempt.mockImplementation((attempt) => {
      state.reviewAttempts.push(attempt);
      rerenderPage(<ReviewPage />);
    });
    fireEvent.change(screen.getByPlaceholderText(/使用哈希表记录/), {
      target: { value: '使用单调栈，时间复杂度 O(n)。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '评分并查看答案' }));

    await waitFor(() =>
      expect(recordReviewAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: '使用单调栈，时间复杂度 O(n)。',
          gradeMode: 'manual_fallback',
          gradeErrorCode: 'timeout',
        })
      )
    );
    expect(screen.queryByText('维护单调结构并处理边界条件。')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: '跳过 AI 评分并查看答案' })
    );
    expect(screen.getByText('维护单调结构并处理边界条件。')).toBeVisible();
    expect(screen.getByRole('button', { name: '掌握' })).toBeVisible();
  });
});
