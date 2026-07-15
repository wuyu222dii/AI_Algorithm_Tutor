import { expect, test, type Locator, type Page } from '@playwright/test';

import { getProblemBySlug } from '../../src/features/algorithm-coach/data/problems';
import { createDemoArtifact } from '../../src/features/algorithm-coach/fixtures';
import type { CoachRequest } from '../../src/features/algorithm-coach/types';

const NAVIGATION_TIMEOUT = process.env.CI ? 30_000 : 15_000;

async function clickAndWaitForUrl(
  page: Page,
  target: Locator,
  expected: RegExp
) {
  await Promise.all([
    page.waitForURL(expected, {
      timeout: NAVIGATION_TIMEOUT,
      waitUntil: 'domcontentloaded',
    }),
    target.click(),
  ]);
}

async function completeOnboarding(page: Page) {
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

async function setEditorCode(page: Page, solution: string) {
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
    const problem = request.problemSlug
      ? getProblemBySlug(request.problemSlug)
      : undefined;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        artifact: createDemoArtifact(request, problem),
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

test('keeps legacy template routes disabled for public beta', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.startsWith('mobile'),
    'Server boundary is viewport independent'
  );

  for (const endpoint of [
    '/api/email/send-email',
    '/api/payment/checkout',
    '/api/user/get-user-credits',
    '/api/storage/upload-image',
  ]) {
    const response = await page.request.post(endpoint, { data: {} });
    expect(response.status(), endpoint).toBe(404);
  }

  for (const route of ['/pricing', '/blog', '/docs']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/learn$/);
  }
});

test('about header exposes sign-in on desktop and mobile', async ({
  page,
}, testInfo) => {
  await page.goto('/about');
  await page.evaluate(() => {
    window.sessionStorage.setItem('algocoach:visitor-welcome:v1', 'seen');
  });
  await page.reload();

  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: 'Open Menu' }).click();
  }

  const signIn = page.getByRole('button', { name: '登录', exact: true });
  await expect(signIn).toBeVisible();
  const signInBox = await signIn.boundingBox();
  const viewport = page.viewportSize();
  expect(signInBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(signInBox!.y).toBeGreaterThanOrEqual(0);
  expect(signInBox!.y + signInBox!.height).toBeLessThanOrEqual(
    viewport!.height
  );
  await page.screenshot({
    path: testInfo.outputPath('about-header.png'),
    fullPage: false,
  });
  await signIn.click();
  await expect(
    page.getByRole('dialog').getByRole('heading', {
      name: '登录',
      exact: true,
    })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    )
    .toBe(true);
});

test('onboarding, problem filtering, and imported draft flow', async ({
  page,
}) => {
  test.setTimeout(process.env.CI ? 120_000 : 60_000);
  await page.goto('/');
  await expect(page).toHaveURL(/\/about$/);
  await expect(
    page.getByRole('dialog').getByRole('heading', {
      name: '先看看 AI 算法教练能做什么',
    })
  ).toBeVisible();
  await clickAndWaitForUrl(
    page,
    page.getByRole('link', { name: '以访客身份开始' }),
    /\/learn$/
  );
  await expect(
    page.getByRole('heading', { name: '先定一个学习目标' })
  ).toBeVisible();

  await page.getByRole('button', { name: '开始学习' }).click();
  await clickAndWaitForUrl(
    page,
    page.getByRole('link', { name: '浏览全部题目' }),
    /\/problems$/
  );
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
  await clickAndWaitForUrl(
    page,
    page.getByRole('button', { name: '确认并练习' }),
    /\/practice\/imported-draft$/
  );
  await expect(page.getByText('导入题', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/没有可验证测试/).filter({ visible: true })
  ).toBeVisible();
});

test('keeps the daily plan stable and unlocks the two-week checkpoint', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.startsWith('mobile'),
    'Desktop covers the timed baseline completion flow'
  );
  test.setTimeout(process.env.CI ? 120_000 : 75_000);
  await completeOnboarding(page);
  await expect(page.getByText('今日学习计划', { exact: true })).toBeVisible();
  const initialPlanId = await page.evaluate(() => {
    const raw = window.localStorage.getItem('algocoach:state:v4');
    const plans = raw ? (JSON.parse(raw).dailyPlans ?? {}) : {};
    return Object.keys(plans)[0] ?? '';
  });
  expect(initialPlanId).not.toBe('');
  await page.reload();
  await expect(page.getByText('今日学习计划', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('algocoach:state:v4');
        const plans = raw ? (JSON.parse(raw).dailyPlans ?? {}) : {};
        return Object.keys(plans)[0] ?? '';
      })
    )
    .toBe(initialPlanId);

  await clickAndWaitForUrl(
    page,
    page.getByRole('link', { name: '开始基线自测' }),
    /\/assessment\?kind=baseline/
  );
  await expect(
    page.getByRole('heading', { name: '能力基线测评' })
  ).toBeVisible();
  await expect(page.getByText('8 分钟', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始测评' }).click();
  await expect(
    page.getByText('为保证结果可比较，测评中 AI 教练已关闭。')
  ).toBeVisible();
  await page.getByRole('button', { name: '提交测评' }).click();
  await expect(page.getByRole('heading', { name: '测评完成' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('algocoach:state:v4');
        const assessment = raw
          ? (JSON.parse(raw).assessments ?? []).at(-1)
          : undefined;
        return assessment?.kind;
      })
    )
    .toBe('baseline');

  await page.addInitScript(() => {
    if (!window.location.pathname.endsWith('/learn')) return;
    const marker = '__algocoach_checkpoint_age_applied__';
    if (window.sessionStorage.getItem(marker)) return;
    const key = 'algocoach:state:v4';
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const state = JSON.parse(raw);
    const baseline = (state.assessments ?? []).find(
      (assessment: { kind?: string }) => assessment.kind === 'baseline'
    );
    if (!baseline) return;
    baseline.completedAt = new Date(
      Date.now() - 15 * 24 * 60 * 60 * 1000
    ).toISOString();
    baseline.startedAt = baseline.completedAt;
    window.localStorage.setItem(key, JSON.stringify(state));
    window.sessionStorage.setItem(marker, 'true');
  });
  await page.goto('/learn');
  await expect(
    page.getByRole('heading', { name: '两周阶段复测已到期' })
  ).toBeVisible();
  await clickAndWaitForUrl(
    page,
    page.getByRole('link', { name: '开始阶段复测' }),
    /\/assessment\?kind=checkpoint&baseline=/
  );
  await expect(
    page.getByRole('heading', { name: '两周阶段复测' })
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
    page.getByText('纠错时间线', { exact: true }).filter({ visible: true })
  ).toBeVisible();
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

  await page
    .getByPlaceholder('追问思路、复杂度或某个错误…')
    .filter({ visible: true })
    .fill('我应该怎样判断复杂度？');
  await page
    .getByRole('button', { name: '发送' })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByText('先说明你当前维护的不变量，再检查它在哪一步被破坏。', {
        exact: true,
      })
      .filter({ visible: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.localStorage.getItem(
            'algocoach:practice-context:v1:first-unique-position'
          ) ?? ''
      )
    )
    .toContain('我应该怎样判断复杂度？');

  await page.reload();
  await expect(
    page.getByText('已查看', { exact: true }).filter({ visible: true })
  ).toHaveCount(3);
  await expect(
    page
      .getByText('先说明你当前维护的不变量，再检查它在哪一步被破坏。', {
        exact: true,
      })
      .filter({ visible: true })
  ).toBeVisible();
  await expect(
    page
      .getByText('本次运行通过 0/2 个测试；诊断只依据上方真实运行结果。', {
        exact: true,
      })
      .filter({ visible: true })
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
  await expect(
    page.getByText(/相较上次运行已修改代码/).filter({ visible: true })
  ).toBeVisible();

  await page.getByRole('button', { name: '提交本地测试' }).click();
  await expect(page.getByText('本题已完成。')).toBeVisible({
    timeout: 15_000,
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('algocoach:state:v4');
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
  await page
    .getByPlaceholder(/使用哈希表记录已访问值/)
    .fill('使用哈希表统计频次，两次遍历，时间复杂度 O(n)。');
  await page.getByRole('button', { name: '评分并查看答案' }).click();
  await expect(page.getByText('参考归纳', { exact: true })).toBeVisible();
  await expect(page.getByText('建议自评', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '掌握', exact: true }).click();

  await page.goto('/progress');
  await expect(page.getByRole('heading', { name: '学习进度' })).toBeVisible();
  await expect(page.getByText('100%', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1 共 1 已开始', { exact: true })).toBeVisible();
});

test('retries the last chat question after stop and classified failures', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.startsWith('mobile'),
    'Desktop covers the chat stop and retry controls'
  );

  await page.unroute(/\/api\/coach\/chat$/);
  const pending = { release: undefined as (() => void) | undefined };
  const requests: Array<{
    messages?: Array<{ role?: string; content?: string }>;
  }> = [];
  let attempt = 0;
  await page.route(/\/api\/coach\/chat$/, async (route) => {
    attempt += 1;
    requests.push(route.request().postDataJSON());

    if (attempt === 1) {
      await new Promise<void>((resolve) => {
        pending.release = resolve;
      });
      try {
        await route.abort('aborted');
      } catch {
        // The browser-side AbortController may close the request first.
      }
      return;
    }

    if (attempt === 2) {
      await route.fulfill({
        status: 504,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'provider_timeout' } }),
      });
      return;
    }
    if (attempt === 3) {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'rate_limited' } }),
      });
      return;
    }
    if (attempt === 4) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'provider_unavailable' } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '这次回答成功，先检查循环不变量。',
    });
  });

  await completeOnboarding(page);
  await page.goto('/practice/first-unique-position');

  const question = '如何证明这个循环不变量？';
  await page
    .getByPlaceholder('追问思路、复杂度或某个错误…')
    .filter({ visible: true })
    .fill(question);
  await page
    .getByRole('button', { name: '发送' })
    .filter({ visible: true })
    .click();
  await expect.poll(() => Boolean(pending.release)).toBe(true);

  await page
    .getByRole('button', { name: '停止生成' })
    .filter({ visible: true })
    .click();
  pending.release?.();
  await expect(
    page
      .getByText('回答已停止，可以重试上一条问题。', { exact: true })
      .filter({ visible: true })
  ).toBeVisible();

  const retry = page
    .getByRole('button', { name: '重试上一条' })
    .filter({ visible: true });
  const retryNotice = retry.locator('..');
  await retry.click();
  await expect(
    retryNotice.getByText('AI 响应超时，请重试。', { exact: true })
  ).toBeVisible();

  await retry.click();
  await expect(
    retryNotice.getByText('今日 AI 使用额度已用完，请稍后再试。', {
      exact: true,
    })
  ).toBeVisible();

  await retry.click();
  await expect(
    retryNotice.getByText('AI 服务暂时不可用，请稍后重试。', {
      exact: true,
    })
  ).toBeVisible();

  await retry.click();
  await expect(
    page
      .getByText('这次回答成功，先检查循环不变量。', { exact: true })
      .filter({ visible: true })
  ).toBeVisible();
  await expect(
    page.getByText(question, { exact: true }).filter({ visible: true })
  ).toHaveCount(1);

  expect(requests).toHaveLength(5);
  for (const request of requests) {
    expect(
      request.messages?.filter(
        (message) => message.role === 'user' && message.content === question
      )
    ).toHaveLength(1);
  }
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
        const raw = window.localStorage.getItem('algocoach:state:v4');
        if (!raw) return false;
        return (JSON.parse(raw).runs ?? []).some(
          (run: { language?: string; status?: string }) =>
            run.language === 'python' && run.status === 'passed'
        );
      })
    )
    .toBe(true);
});

test('runs and restores TypeScript in the isolated QuickJS worker', async ({
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
  await page.getByRole('option', { name: 'TypeScript' }).click({ force: true });
  await expect(languageSelect).toContainText('TypeScript');

  const solution = `function firstUniquePosition(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return values.findIndex((value) => counts.get(value) === 1);
}`;
  await setEditorCode(page, solution);
  await page.getByRole('button', { name: '运行样例' }).click();
  await expect(page.getByText('全部通过', { exact: true }).first()).toBeVisible(
    { timeout: 30_000 }
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('algocoach:state:v4');
        if (!raw) return false;
        return (JSON.parse(raw).runs ?? []).some(
          (run: {
            language?: string;
            status?: string;
            runnerMode?: string;
            runtimeVersion?: string;
            problemContentVersion?: number;
          }) =>
            run.language === 'typescript' &&
            run.status === 'passed' &&
            run.runnerMode === 'browser-worker' &&
            run.runtimeVersion?.includes('typescript@5.9') &&
            run.problemContentVersion === 1
        );
      })
    )
    .toBe(true);

  await page.reload();
  await expect(languageSelect).toContainText('TypeScript');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const monaco = (
          window as typeof window & {
            monaco?: {
              editor?: {
                getModels: () => Array<{ getValue: () => string }>;
              };
            };
          }
        ).monaco;
        return monaco?.editor?.getModels()[0]?.getValue() ?? '';
      })
    )
    .toContain('values: number[]');
});

test('mobile practice tabs and assessment remain usable', async ({
  page,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 150_000 : 90_000);
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
  await page
    .getByRole('button', { name: '运行样例' })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText('仍需调整', { exact: true }).filter({ visible: true })
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole('tab', { name: 'AI 教练' }).click();
  await expect(
    page.locator('h2:visible').filter({ hasText: '逐级提示' })
  ).toBeVisible();
  await page
    .getByRole('button', { name: '诊断错因' })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByText('本次运行通过 0/2 个测试；诊断只依据上方真实运行结果。', {
        exact: true,
      })
      .filter({ visible: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: '查看提示' })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page
      .getByText('先想清楚需要为每个值保存什么信息。', { exact: true })
      .filter({ visible: true })
  ).toBeVisible();

  await page.getByRole('tab', { name: '代码' }).click();
  await setEditorCode(
    page,
    `function firstUniquePosition(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return values.findIndex((value) => counts.get(value) === 1);
}`
  );
  await page
    .getByRole('button', { name: '提交本地测试' })
    .filter({ visible: true })
    .click();
  await expect(page.getByText('本题已完成。')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('tab', { name: 'AI 教练' }).click();
  await expect(
    page.getByText(/相较上次运行已修改代码/).filter({ visible: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('algocoach:state:v4');
        if (!raw) return false;
        return (JSON.parse(raw).artifacts ?? []).some(
          (artifact: { type?: string }) => artifact.type === 'review_card'
        );
      })
    )
    .toBe(true);

  await page.goto('/review');
  await page.getByRole('tab', { name: /归纳卡/ }).click();
  await page
    .getByPlaceholder(/使用哈希表记录已访问值/)
    .fill('先统计频次，再找第一个频次为 1 的位置，复杂度 O(n)。');
  await page.getByRole('button', { name: '评分并查看答案' }).click();
  await expect(page.getByText('参考归纳', { exact: true })).toBeVisible();

  await page.goto('/assessment');
  await expect(
    page.getByRole('heading', { name: '算法能力测评' })
  ).toBeVisible();
  await expect(
    page.getByText('本地自测', { exact: true }).filter({ visible: true })
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
        const raw = window.localStorage.getItem('algocoach:state:v4');
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
    await page.goto(route, { waitUntil: 'domcontentloaded' });
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
