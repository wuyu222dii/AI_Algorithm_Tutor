import { expect, test, type Page, type TestInfo } from '@playwright/test';

const PASSWORD = 'AlgoCoach-E2E-Password-2026!';

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.startsWith('mobile');
}

function uniqueEmail(testInfo: TestInfo, purpose: string) {
  const nonce = `${Date.now()}-${testInfo.workerIndex}-${testInfo.retry}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  return `algocoach-${purpose}-${nonce}@example.test`;
}

async function fillSignUp(page: Page, email: string) {
  await page.getByLabel('姓名').fill('认证测试用户');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.getByLabel(/确认密码|Confirm password/i).fill(PASSWORD);
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: '注册', exact: true }).click();
}

async function fillSignIn(page: Page, email: string, password: string) {
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

function accountMenu(page: Page) {
  return page
    .getByRole('button', {
      name: /^(打开)?账户菜单$|^(打开)?用户菜单$|^(Open )?Account menu$/i,
    })
    .first();
}

async function signOutFromCoach(page: Page) {
  await expect(accountMenu(page)).toBeVisible();
  await accountMenu(page).click();
  await page
    .getByRole('menuitem', { name: /^(退出登录|登出|Sign out)$/i })
    .click();
}

async function sessionEmail(
  page: Page
): Promise<string | null | 'rate-limited'> {
  const response = await page.context().request.get('/api/auth/get-session', {
    headers: { 'cache-control': 'no-store' },
  });

  if (response.status() === 429) return 'rate-limited';
  if (!response.ok()) return null;

  const body = (await response.json().catch(() => null)) as {
    user?: { email?: string };
  } | null;
  return body?.user?.email ?? null;
}

test.describe('desktop registration and login', () => {
  test('registers, persists a session, signs out, and signs back in', async ({
    page,
  }, testInfo) => {
    test.skip(isMobileProject(testInfo), 'Desktop account lifecycle coverage');

    const email = uniqueEmail(testInfo, 'lifecycle');

    await page.goto('/sign-up?callbackUrl=%2Fprogress');
    await expect(page.getByRole('heading', { name: '注册' })).toBeVisible();
    await fillSignUp(page, email);

    await expect(page).toHaveURL(/\/progress$/, { timeout: 15_000 });
    await expect(accountMenu(page)).toBeVisible();
    await expect
      .poll(() => sessionEmail(page), {
        timeout: 12_000,
        intervals: [1_000],
      })
      .toBe(email);

    const sessionCookie = (await page.context().cookies()).find((cookie) =>
      cookie.name.endsWith('session_token')
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');

    await signOutFromCoach(page);
    await expect
      .poll(() => sessionEmail(page), {
        timeout: 12_000,
        intervals: [1_000],
      })
      .toBeNull();

    await page.goto('/sign-in?callbackUrl=%2Freview');
    await fillSignIn(page, email, 'Definitely-Wrong-Password!');
    await expect(
      page
        .getByRole('alert')
        .filter({
          hasText: /邮箱或密码(?:不正确|错误|无效)|Invalid email or password/i,
        })
        .or(
          page.getByText(
            /邮箱或密码(?:不正确|错误|无效)|Invalid email or password/i
          )
        )
        .first()
    ).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Freview$/);

    await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/review$/, { timeout: 15_000 });
    await expect
      .poll(() => sessionEmail(page), {
        timeout: 12_000,
        intervals: [1_000],
      })
      .toBe(email);
  });

  test('rejects protocol-relative callback URLs for sign-up and sign-in', async ({
    page,
  }, testInfo) => {
    test.skip(isMobileProject(testInfo), 'Desktop callback security coverage');

    const email = uniqueEmail(testInfo, 'callback');
    const unsafeCallback = encodeURIComponent('//evil.invalid/collect');

    await page.goto(`/sign-up?callbackUrl=${unsafeCallback}`);
    await fillSignUp(page, email);
    await expect(page).toHaveURL(/\/learn$/, { timeout: 15_000 });
    expect(new URL(page.url()).hostname).toBe('localhost');
    expect(page.url()).not.toContain('evil.invalid');

    await signOutFromCoach(page);
    const localePrefixedEmail = uniqueEmail(testInfo, 'locale-callback');
    const localePrefixedUnsafeCallback = encodeURIComponent(
      '/zh//evil.invalid/collect'
    );
    await page.goto(`/sign-up?callbackUrl=${localePrefixedUnsafeCallback}`);
    await fillSignUp(page, localePrefixedEmail);
    await expect(page).toHaveURL(/\/learn$/, { timeout: 15_000 });
    expect(new URL(page.url()).hostname).toBe('localhost');
    expect(page.url()).not.toContain('evil.invalid');

    await signOutFromCoach(page);
    await page.goto(`/sign-in?callbackUrl=${unsafeCallback}`);
    await fillSignIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/learn$/, { timeout: 15_000 });
    expect(new URL(page.url()).hostname).toBe('localhost');
    expect(page.url()).not.toContain('evil.invalid');
  });

  test('password recovery pages fail safely without an email provider', async ({
    page,
  }, testInfo) => {
    test.skip(isMobileProject(testInfo), 'Desktop recovery-flow coverage');

    const email = uniqueEmail(testInfo, 'recovery');
    const forgotResponse = await page.goto('/forgot-password');
    expect(forgotResponse?.status()).toBeLessThan(400);
    await expect(
      page.getByRole('heading', { name: /忘记密码|Forgot password/i })
    ).toBeVisible();

    const resetEmail = page.getByLabel(/邮箱|Email/i);
    if (await resetEmail.isVisible().catch(() => false)) {
      await resetEmail.fill(email);
      await page
        .getByRole('button', {
          name: /发送重置(?:邮件|链接)|Send reset (?:email|link)/i,
        })
        .click();
    }

    const recoveryNotice = page
      .getByRole('alert')
      .or(page.getByRole('status'))
      .filter({
        hasText:
          /如果该邮箱已注册|邮件服务.*(?:未配置|不可用)|暂时无法发送.*重置|If an account exists|email service.*(?:not configured|unavailable)/i,
      })
      .first();
    await expect(recoveryNotice).toBeVisible();
    await expect(
      page.getByText(/邮箱不存在|用户不存在|email not found|user not found/i)
    ).toHaveCount(0);

    const resetResponse = await page.goto('/reset-password');
    expect(resetResponse?.status()).toBeLessThan(400);
    await expect(
      page.getByRole('heading', { name: /重置密码|Reset password/i })
    ).toBeVisible();
    await expect(
      page
        .getByRole('alert')
        .or(page.getByRole('status'))
        .filter({
          hasText:
            /重置链接.*(?:无效|缺少|过期)|缺少.*令牌|Invalid or expired reset|missing reset token/i,
        })
        .first()
    ).toBeVisible();
  });
});

test('mobile learning shell exposes an accessible login entry', async ({
  page,
}, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'Mobile-only account entry coverage');

  await page.goto('/learn');
  const loginEntry = page
    .getByRole('link', { name: /^(登录|Sign in)$/i })
    .or(page.getByRole('button', { name: /^(登录|Sign in)$/i }))
    .first();

  await expect(loginEntry).toBeVisible();
  await loginEntry.click();
  await expect(
    page.getByRole('heading', { name: /^(登录|Sign in)$/i })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    )
    .toBe(true);
});
