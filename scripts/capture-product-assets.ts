import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

import { createDemoArtifact } from '../src/features/algorithm-coach/fixtures';
import type { CoachRequest } from '../src/features/algorithm-coach/types';

const baseUrl = process.env.ALGOCOACH_CAPTURE_URL ?? 'http://localhost:3000';
const outputRoot = path.resolve('public/imgs/algocoach');

const copy = {
  zh: {
    learningHub: '今天，从一道好题开始',
    start: '开始学习',
    run: '运行样例',
    failed: '仍需调整',
    diagnose: '诊断错因',
    diagnosisEvidence: '本次运行通过 0/2 个测试；诊断只依据上方真实运行结果。',
    revealHint: '查看提示',
    revealed: '已查看',
    submit: '提交测试',
    completed: '本题已完成。',
    review: '复习中心',
    cardsTab: /归纳卡/,
    showAnswer: '显示答案',
    progress: '学习进度',
  },
  en: {
    learningHub: 'Start today with one good problem',
    start: 'Start learning',
    run: 'Run examples',
    failed: 'Needs another pass',
    diagnose: 'Diagnose issue',
    diagnosisEvidence:
      'This run passed 0/2 tests; the diagnosis uses only the run evidence above.',
    revealHint: 'Reveal hint',
    revealed: 'Revealed',
    submit: 'Submit tests',
    completed: 'Problem completed.',
    review: 'Review Center',
    cardsTab: /Summary cards/,
    showAnswer: 'Show answer',
    progress: 'Learning Progress',
  },
} as const;

type Locale = keyof typeof copy;

function localePath(locale: Locale, pathname: string) {
  return `${baseUrl}${locale === 'zh' ? '' : '/en'}${pathname}`;
}

async function waitForText(page: Page, text: string) {
  await page.getByText(text, { exact: true }).first().waitFor({
    state: 'visible',
    timeout: 20_000,
  });
}

async function capture(
  page: Page,
  locale: Locale,
  name: string,
  options: { height?: number } = {}
) {
  const directory = path.join(outputRoot, locale);
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `${name}.jpg`),
    type: 'jpeg',
    quality: 90,
    animations: 'disabled',
    clip: {
      x: 168,
      y: 90,
      width: 1272,
      height: options.height ?? 800,
    },
  });
}

async function captureSocialPreview(page: Page, locale: Locale) {
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(localePath(locale, '/about'), { waitUntil: 'networkidle' });
  const tour = page.getByRole('button', {
    name: locale === 'zh' ? '访客导览' : 'Guest tour',
    exact: true,
  });
  if (await tour.isVisible()) {
    await tour.evaluate((element) => {
      element.style.display = 'none';
    });
  }
  await page.evaluate(() => {
    document
      .querySelectorAll('nextjs-portal')
      .forEach((element) => element.remove());
  });
  await page.screenshot({
    path: path.resolve('public/preview.png'),
    type: 'png',
    fullPage: false,
    animations: 'disabled',
  });
}

async function setEditorCode(page: Page, solution: string) {
  await page.locator('.monaco-editor:visible').waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  const updated = await page.evaluate((value) => {
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
  if (!updated) throw new Error('Monaco model was not ready for capture');
}

async function captureLocale(locale: Locale) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    colorScheme: 'light',
    locale: locale === 'zh' ? 'zh-CN' : 'en-US',
  });
  const page = await context.newPage();
  const t = copy[locale];

  await page.route('**/api/coach/events', (route) =>
    route.fulfill({ status: 204 })
  );
  await page.route('**/api/coach', async (route) => {
    const request = route.request().postDataJSON() as CoachRequest;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        artifact: createDemoArtifact(request),
        mode: 'live',
        model: 'capture/grounded-fixture',
        promptVersion: 'product-assets-v1',
        latencyMs: 1,
        traceId: `capture-${request.action}`,
      }),
    });
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('algocoach:visitor-welcome:v1', 'seen');
  });

  await page.goto(localePath(locale, '/learn'), {
    waitUntil: 'networkidle',
  });
  const start = page.getByRole('button', { name: t.start, exact: true });
  if (await start.isVisible()) await start.click();
  await page
    .getByRole('heading', { name: t.learningHub, exact: true })
    .waitFor({ state: 'visible' });

  await page.goto(localePath(locale, '/practice/first-unique-position'), {
    waitUntil: 'networkidle',
  });
  await page.locator('.monaco-editor:visible').waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  await page.getByRole('button', { name: t.run, exact: true }).click();
  await waitForText(page, t.failed);
  await page.getByRole('button', { name: t.diagnose, exact: true }).click();
  await waitForText(page, t.diagnosisEvidence);
  await capture(page, locale, 'workspace-light');
  await capture(page, locale, 'diagnosis');

  await page.evaluate(() => window.localStorage.setItem('theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('html.dark').waitFor({ state: 'attached' });
  await waitForText(page, t.diagnosisEvidence);
  await capture(page, locale, 'workspace-dark');

  await page.evaluate(() => window.localStorage.setItem('theme', 'light'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.monaco-editor:visible').waitFor({ state: 'visible' });
  for (let level = 1; level <= 3; level += 1) {
    await page
      .getByRole('button', { name: t.revealHint, exact: true })
      .first()
      .click();
    await page
      .getByText(t.revealed, { exact: true })
      .nth(level - 1)
      .waitFor({ state: 'visible' });
  }
  await capture(page, locale, 'hint-ladder');

  await setEditorCode(
    page,
    `function firstUniquePosition(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return values.findIndex((value) => counts.get(value) === 1);
}`
  );
  await page.getByRole('button', { name: t.submit, exact: true }).click();
  await waitForText(page, t.completed);

  await page.goto(localePath(locale, '/review'), {
    waitUntil: 'networkidle',
  });
  await page
    .getByRole('heading', { name: t.review, exact: true })
    .waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: t.cardsTab }).click();
  const showAnswer = page.getByRole('button', {
    name: t.showAnswer,
    exact: true,
  });
  if (await showAnswer.isVisible()) await showAnswer.click();
  await capture(page, locale, 'learner-control');

  await page.goto(localePath(locale, '/progress'), {
    waitUntil: 'networkidle',
  });
  await page
    .getByRole('heading', { name: t.progress, exact: true })
    .waitFor({ state: 'visible' });
  await capture(page, locale, 'progress');

  await page.goto(localePath(locale, '/learn'), {
    waitUntil: 'networkidle',
  });
  await page
    .getByRole('heading', { name: t.learningHub, exact: true })
    .waitFor({ state: 'visible' });
  await capture(page, locale, 'learning-loop');
  if (locale === 'zh') {
    await captureSocialPreview(page, locale);
  }

  await browser.close();
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  for (const locale of ['zh', 'en'] as const) {
    await captureLocale(locale);
  }

  console.log(`Captured AlgoCoach product assets in ${outputRoot}`);
}

void main();
