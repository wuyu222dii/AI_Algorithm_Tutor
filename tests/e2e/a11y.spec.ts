import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = [
  '/about',
  '/learn',
  '/problems',
  '/assessment',
  '/review',
  '/practice/first-unique-position',
] as const;

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript((skipVisitorDialog) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // axe-core 4.12 can terminate WebKit while the delayed Radix dialog portal
    // mounts. Chromium still audits the dialog; WebKit audits the landing page.
    if (skipVisitorDialog) {
      window.sessionStorage.setItem('algocoach:visitor-welcome:v1', 'seen');
    }
  }, testInfo.project.name === 'mobile-webkit-a11y');
});

for (const route of routes) {
  test(`${route} has no serious or critical accessibility violations`, async ({
    page,
  }, testInfo) => {
    test.skip(
      route === '/about' && testInfo.project.name === 'mobile-webkit-a11y',
      'axe-core 4.12 terminates WebKit while scanning the landing header; the same header is audited in Chromium and covered by a WebKit layout smoke test.'
    );
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    if (route.startsWith('/practice/')) {
      if (testInfo.project.name.startsWith('mobile')) {
        await page.getByRole('tab', { name: '代码' }).click();
      }
      await expect(page.locator('.monaco-editor:visible')).toBeVisible({
        timeout: 20_000,
      });
    }
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = result.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical'
    );

    expect(blocking).toEqual([]);
  });
}

test('mobile WebKit about remains usable without horizontal overflow', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-webkit-a11y',
    'WebKit-specific landing layout smoke test'
  );
  await page.goto('/about', { waitUntil: 'domcontentloaded' });

  await expect(
    page.getByRole('heading', { level: 1, name: /AlgoCoach/ })
  ).toBeVisible();
  await expect(
    page
      .getByRole('link', { name: '开始学习' })
      .filter({ visible: true })
      .first()
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    )
    .toBeLessThanOrEqual(1);
});
