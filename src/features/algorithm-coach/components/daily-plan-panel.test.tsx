import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DailyLearningPlan, DailyPlanTask } from '../daily-plan';
import type { Problem, ProblemTopic } from '../types';
import { DailyPlanPanel } from './daily-plan-panel';

afterEach(cleanup);

function problem(
  slug: string,
  title: string,
  topic: ProblemTopic,
  contentVersion = 1
): Problem {
  return {
    id: `problem-${slug}`,
    slug,
    title: { zh: title, en: `${title} EN` },
    description: {
      zh: `${title}的题目描述`,
      en: `Description for ${title}`,
    },
    difficulty: 'easy',
    topics: [topic],
    languageConfigs: {
      javascript: { entryPoint: 'solve', template: 'function solve() {}' },
    },
    version: { contentVersion },
    tests: [],
    examples: [],
    constraints: [],
    hints: {
      zh: ['提示一', '提示二', '提示三'],
      en: ['Hint one', 'Hint two', 'Hint three'],
    },
    reviewPoints: [],
    estimatedMinutes: 10,
  };
}

function task(
  problemValue: Problem,
  options: Partial<DailyPlanTask> = {}
): DailyPlanTask {
  return {
    id: `plan:${problemValue.slug}`,
    kind: 'new-topic',
    status: 'pending',
    problemId: problemValue.id,
    problemSlug: problemValue.slug,
    problemContentVersion: problemValue.version?.contentVersion ?? 1,
    primaryTopic: problemValue.topics[0] as ProblemTopic,
    difficulty: problemValue.difficulty,
    reason: 'new-topic',
    estimatedMinutes: problemValue.estimatedMinutes,
    ...options,
  };
}

function plan(tasks: DailyPlanTask[]): DailyLearningPlan {
  return {
    id: 'daily-plan:Pacific%2FAuckland:2026-07-15',
    localDate: '2026-07-15',
    timeZone: 'Pacific/Auckland',
    budgetMinutes: 45,
    estimatedMinutes: tasks
      .filter((item) => item.status !== 'skipped')
      .reduce((total, item) => total + item.estimatedMinutes, 0),
    preferredLanguage: 'javascript',
    goal: 'foundation',
    tasks,
    changes: [],
  };
}

function renderPanel(
  tasks: DailyPlanTask[],
  problems: Problem[],
  overrides: Partial<React.ComponentProps<typeof DailyPlanPanel>> = {}
) {
  const props: React.ComponentProps<typeof DailyPlanPanel> = {
    plan: plan(tasks),
    problems,
    locale: 'zh',
    onSkip: vi.fn(),
    onSwap: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
  render(<DailyPlanPanel {...props} />);
  return props;
}

describe('DailyPlanPanel', () => {
  it('renders the budget, statuses, and at most three tasks', () => {
    const first = problem('first', '数组求和', 'array-hash');
    const second = problem('second', '括号检查', 'stack');
    const third = problem('third', '二分边界', 'binary-search');
    const fourth = problem('fourth', '链表反转', 'linked-list');
    const onOpen = vi.fn();
    renderPanel(
      [
        task(first, {
          kind: 'due-review',
          reason: 'review-due',
          status: 'completed',
        }),
        task(second, {
          kind: 'weak-topic',
          reason: 'weak-mastery',
          status: 'skipped',
          skipReason: '今天时间不足',
        }),
        task(third),
        task(fourth),
      ],
      [first, second, third, fourth],
      { onOpen }
    );

    expect(screen.getByText('今日学习计划')).toBeVisible();
    expect(screen.getByText('预计 30 / 45 分钟')).toBeVisible();
    expect(screen.getByText('已完成')).toBeVisible();
    expect(screen.getByText('已跳过')).toBeVisible();
    expect(screen.getByText('跳过原因：今天时间不足')).toBeVisible();
    expect(screen.getByText('二分边界')).toBeVisible();
    expect(screen.queryByText('链表反转')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看任务：数组求和' }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ problemSlug: first.slug })
    );
  });

  it('requires an explicit skip reason before invoking the callback', async () => {
    const value = problem('array-sum', '数组求和', 'array-hash');
    const valueTask = task(value);
    const onSkip = vi.fn();
    renderPanel([valueTask], [value], { onSkip });

    fireEvent.click(screen.getByRole('button', { name: '跳过：数组求和' }));
    expect(screen.getByText('为什么跳过这项任务？')).toBeVisible();
    const confirm = screen.getByRole('button', { name: '确认跳过' });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByLabelText('今天时间不足'));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(onSkip).toHaveBeenCalledWith(valueTask.id, '今天时间不足')
    );
    expect(screen.queryByText('为什么跳过这项任务？')).not.toBeInTheDocument();
  });

  it('accepts a custom swap reason and keeps the callback contract localized', async () => {
    const value = problem('array-sum', 'Array sum', 'array-hash');
    const valueTask = task(value);
    const onSwap = vi.fn();
    renderPanel([valueTask], [value], {
      locale: 'en',
      onSwap,
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Swap problem：Array sum EN' })
    );
    fireEvent.click(screen.getByLabelText('Other reason'));
    const reason = screen.getByPlaceholderText('Briefly describe the reason');
    fireEvent.change(reason, { target: { value: 'Need another pattern' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm swap' }));

    await waitFor(() =>
      expect(onSwap).toHaveBeenCalledWith(valueTask.id, 'Need another pattern')
    );
  });

  it('keeps the dialog open and reports callback failures', async () => {
    const value = problem('array-sum', '数组求和', 'array-hash');
    const onSwap = vi.fn().mockRejectedValue(new Error('network'));
    renderPanel([task(value)], [value], { onSwap });

    fireEvent.click(screen.getByRole('button', { name: '换题：数组求和' }));
    fireEvent.click(screen.getByLabelText('希望调整难度'));
    fireEvent.click(screen.getByRole('button', { name: '确认换题' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '操作未完成，请重试。'
    );
    expect(screen.getByText('为什么想换一道题？')).toBeVisible();
  });

  it('renders a compact empty state', () => {
    renderPanel([], []);

    expect(screen.getByText('今天没有待安排任务')).toBeVisible();
    expect(screen.queryByRole('button', { name: /开始练习/ })).toBeNull();
  });

  it('uses metadata from the task revision instead of the current revision', () => {
    const historical = problem('versioned', '历史题目标题', 'stack', 1);
    const current = problem('versioned', '当前题目标题', 'binary-search', 2);

    renderPanel([task(historical)], [current, historical]);

    expect(screen.getByText('历史题目标题')).toBeVisible();
    expect(screen.queryByText('当前题目标题')).not.toBeInTheDocument();
  });
});
