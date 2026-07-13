import { expect, test } from '@playwright/test';

import { createDemoArtifact } from '../../src/features/algorithm-coach/fixtures';
import type { CoachRequest } from '../../src/features/algorithm-coach/types';

async function completeOnboarding(page: import('@playwright/test').Page) {
  await page.goto('/learn');
  const start = page.getByRole('button', { name: '开始学习' });
  const learningHub = page.getByRole('heading', {
    name: '今天，从一道好题开始',
  });
  await expect(start.or(learningHub)).toBeVisible();
  if (await start.isVisible()) {
    await expect(start).toBeEnabled();
    await start.click();
  }
  await expect(learningHub).toBeVisible();
}

async function setEditorCode(
  page: import('@playwright/test').Page,
  solution: string
) {
  const editor = page.locator('.monaco-editor:visible');
  await expect(editor).toBeVisible({ timeout: 20_000 });
  const modelUpdated = await page.evaluate((value) => {
    const monaco = (
      window as typeof window & {
        monaco?: {
          editor?: {
            getModels: () => Array<{ setValue: (code: string) => void }>;
          };
        };
      }
    ).monaco;
    const model = monaco?.editor?.getModels()[0];
    if (!model) return false;
    model.setValue(value);
    return true;
  }, solution);
  if (!modelUpdated) {
    const input = page.locator('.monaco-editor:visible textarea');
    await input.click({ force: true });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(solution);
  }
}

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/coach$/, async (route) => {
    const request = route.request().postDataJSON() as CoachRequest;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        artifact: createDemoArtifact(request),
        mode: 'live',
        model: 'test/fixture',
        promptVersion: 'e2e-v1',
        latencyMs: 1,
        traceId: `e2e-${Date.now()}`,
      }),
    });
  });
  await page.route(/\/api\/coach\/chat$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '先说明你当前维护的不变量，再检查它在哪一步被破坏。',
    });
  });
  await page.addInitScript(() => {
    const marker = '__algocoach_e2e_initialized__';
    if (window.sessionStorage.getItem(marker) === 'true') return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(marker, 'true');
  });
});

test('onboarding, problem filtering, and imported draft flow', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/about$/);
  await expect(
    page.getByRole('dialog').getByRole('heading', {
      name: '先看看 AI 算法教练能做什么',
    })
  ).toBeVisible();
  await page.getByRole('link', { name: '以访客身份开始' }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(
    page.getByRole('heading', { name: '先定一个学习目标' })
  ).toBeVisible();

  await page.getByRole('button', { name: '开始学习' }).click();
  await page.getByRole('link', { name: '浏览全部题目' }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await expect(page.getByRole('heading', { name: '算法题库' })).toBeVisible();

  await page.getByPlaceholder('搜索题目、知识点').fill('有序');
  await expect(
    page.getByRole('heading', { name: '有序数组目标配对' })
  ).toBeVisible();
  await page.getByPlaceholder('搜索题目、知识点').fill('');

  await page.getByRole('button', { name: '导入题目' }).click();
  await page
    .getByLabel('题目内容')
    .fill(
      '数组求和练习\n给定整数数组 values，返回所有元素之和。\n输入：[1,2,3]\n输出：6\n约束：数组长度至少为 1。'
    );
  await page.getByRole('button', { name: '解析题面' }).click();
  await expect(page.getByText('解析草稿', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认并练习' }).click();

  await expect(page).toHaveURL(/\/practice\/imported-draft$/);
  await expect(page.getByText('导入题', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/没有可验证测试/).filter({ visible: true })
  ).toBeVisible();
});

test('runs JavaScript, submits, reveals a hint, and creates review data', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.startsWith('mobile'),
    'Covered by desktop runner flow'
  );
  await completeOnboarding(page);
  await page.goto('/practice/first-unique-position');

  await page.getByRole('button', { name: '运行样例' }).click();
  await expect(page.getByText('仍需调整', { exact: true }).first()).toBeVisible(
    {
      timeout: 15_000,
    }
  );

  await page.getByRole('button', { name: '诊断错因' }).click();
  await expect(
    page
      .getByText('本次运行通过 0/2 个测试；诊断只依据上方真实运行结果。', {
        exact: true,
      })
      .first()
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: '生成反例' }).click();
  await expect(
    page
      .getByText('请手动跟踪测试 fu-1，重点观察边界初始化和返回条件。', {
        exact: true,
      })
      .first()
  ).toBeVisible({ timeout: 10_000 });

  for (const hint of [
    '先想清楚需要为每个值保存什么信息。',
    '第一次遍历统计频次，第二次按原顺序查找。',
    'freq = 计数(values)；依次检查 i，若 freq[values[i]] == 1 则返回 i。',
  ]) {
    await page.getByRole('button', { name: '查看提示' }).first().click();
    await expect(page.getByText(hint, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
  }
  await expect(
    page.getByText('在线 AI', { exact: true }).first()
  ).toBeVisible();

  const solution = `function firstUniquePosition(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return values.findIndex((value) => counts.get(value) === 1);
}`;
  await setEditorCode(page, solution);

  await page.getByRole('button', { name: '运行样例' }).click();
  await expect(page.getByText('全部通过', { exact: true }).first()).toBeVisible(
    {
      timeout: 15_000,
    }
  );

  await page.getByRole('button', { name: '提交测试' }).click();
  await expect(page.getByText('本题已完成。')).toBeVisible({
    timeout: 15_000,
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('algocoach:state:v2');
        if (!raw) return [];
        return (JSON.parse(raw).artifacts ?? []).map(
          (artifact: { type?: string }) => artifact.type
        );
      })
    )
    .toContain('review_card');

  await page.goto('/review');
  await expect(page.getByRole('heading', { name: '复习中心' })).toBeVisible();
  await page.getByRole('tab', { name: /归纳卡/ }).click();
  await expect(page.getByText('AI 复习卡', { exact: true })).toBeVisible();

  await page.goto('/progress');
  await expect(page.getByRole('heading', { name: '学习进度' })).toBeVisible();
  await expect(page.getByText('3%', { exact: true })).toBeVisible();
  await expect(page.getByText('1 共 30 已完成', { exact: true })).toBeVisible();
});

test('runs Python in an isolated browser worker', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.startsWith('mobile'),
    'Covered by the desktop runner flow'
  );
  await completeOnboarding(page);
  await page.goto('/practice/first-unique-position');

  const languageSelect = page.locator('[role="combobox"]:visible');
  await expect(languageSelect).toHaveCount(1);
  await languageSelect.click();
  await page.getByRole('option', { name: 'Python' }).click({ force: true });
  await expect(languageSelect).toContainText('Python');
  await setEditorCode(
    page,
    `def first_unique_position(values):
    counts = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    for index, value in enumerate(values):
        if counts[value] == 1:
            return index
    return -1`
  );

  await page.getByRole('button', { name: '运行样例' }).click();
  await expect(page.getByText('全部通过', { exact: true }).first()).toBeVisible(
    { timeout: 30_000 }
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('algocoach:state:v2');
        if (!raw) return false;
        return (JSON.parse(raw).runs ?? []).some(
          (run: { language?: string; status?: string }) =>
            run.language === 'python' && run.status === 'passed'
        );
      })
    )
    .toBe(true);
});

test('mobile practice tabs and assessment remain usable', async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith('mobile'),
    'Mobile-only layout check'
  );
  await completeOnboarding(page);
  await page.goto('/practice/first-unique-position');

  await expect(page.getByRole('tab', { name: '题目' })).toBeVisible();
  await page.getByRole('tab', { name: '代码' }).click();
  await expect(page.locator('.monaco-editor:visible')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('tab', { name: 'AI 教练' }).click();
  await expect(
    page.locator('h2:visible').filter({ hasText: '逐级提示' })
  ).toBeVisible();

  await page.goto('/assessment');
  await expect(
    page.getByRole('heading', { name: '算法能力测评' })
  ).toBeVisible();
  await page.getByRole('button', { name: '开始测评' }).click();
  await expect(
    page.getByText('为保证结果可比较，测评中 AI 教练已关闭。')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '提交测评' })).toBeVisible();
  await page.getByRole('button', { name: '提交测评' }).click();
  await expect(page.getByRole('heading', { name: '测评完成' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('algocoach:state:v2');
        return raw ? (JSON.parse(raw).assessments ?? []).length : 0;
      })
    )
    .toBe(1);
});

test('English locale renders the complete onboarding surface', async ({
  page,
}) => {
  await page.goto('/en/learn');
  await expect(
    page.getByRole('heading', { name: 'Set your learning goal' })
  ).toBeVisible();
  await expect(page.getByText('Build strong foundations')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start learning' })
  ).toBeVisible();
});

test('core pages render without browser errors or horizontal overflow', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  for (const route of [
    '/learn',
    '/problems',
    '/practice/first-unique-position',
    '/assessment',
    '/review',
    '/progress',
    '/about',
  ]) {
    await page.goto(route);
    await page.waitForLoadState('domcontentloaded');
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        )
      )
      .toBe(true);

    if (
      route.startsWith('/practice/') &&
      testInfo.project.name.startsWith('desktop')
    ) {
      await expect(page.locator('.monaco-editor:visible')).toBeVisible({
        timeout: 20_000,
      });
    }

    if (route === '/learn' || route.startsWith('/practice/')) {
      const slug = route === '/learn' ? 'learn' : 'practice';
      await page.screenshot({
        path: testInfo.outputPath(`${slug}.png`),
        fullPage: false,
      });
    }
  }

  expect(browserErrors).toEqual([]);
});
