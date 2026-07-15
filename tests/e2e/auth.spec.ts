import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { createGoogleOAuthMockToken } from '../../src/core/auth/google-oauth-mock';

const PASSWORD = 'AlgoCoach-E2E-Password-2026!';
const GOOGLE_MOCK_SECRET = 'algocoach-e2e-google-oauth-mock-secret-2026';

function googleToken(email: string, sub: string, name: string) {
  return createGoogleOAuthMockToken(
    {
      sub,
      email,
      emailVerified: true,
      name,
      image: 'https://lh3.googleusercontent.com/e2e-avatar.png',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
    GOOGLE_MOCK_SECRET
  );
}

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
  const signUpResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/api/auth/sign-up/email')
  );
  await page.getByRole('button', { name: '注册', exact: true }).click();
  const response = await signUpResponse;
  expect(
    response.status(),
    `email sign-up returned HTTP ${response.status()}`
  ).toBeLessThan(400);
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
  test('starts secure Google OAuth and localizes a cancelled authorization', async ({
    page,
  }, testInfo) => {
    test.skip(isMobileProject(testInfo), 'Desktop Google OAuth coverage');

    await page.goto('/sign-in?callbackUrl=%2Freview');
    await expect(
      page.getByRole('button', { name: '使用 Google 登录' })
    ).toBeVisible();
    await expect(
      page.locator('iframe[src*="accounts.google.com/gsi"]')
    ).toHaveCount(0);

    let browserStartBody: Record<string, unknown> | null = null;
    const socialStartPattern = '**/api/auth/sign-in/social';
    await page.route(socialStartPattern, async (route) => {
      browserStartBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '', redirect: false }),
      });
    });
    await page.getByRole('button', { name: '使用 Google 登录' }).click();
    await expect.poll(() => browserStartBody).not.toBeNull();
    expect(browserStartBody).toMatchObject({
      provider: 'google',
      callbackURL: '/review',
      errorCallbackURL: '/auth-error?callbackUrl=%2Freview',
    });
    await page.unroute(socialStartPattern);

    const startResponse = await page
      .context()
      .request.post('/api/auth/sign-in/social', {
        data: {
          provider: 'google',
          callbackURL: '/review',
          errorCallbackURL: '/auth-error?callbackUrl=%2Freview',
          disableRedirect: true,
        },
      });
    expect(startResponse.ok()).toBe(true);
    const startBody = (await startResponse.json()) as { url?: string };
    const providerUrl = new URL(startBody.url || '');
    expect(providerUrl.origin).toBe('https://accounts.google.com');
    expect(providerUrl.searchParams.get('state')).toBeTruthy();
    expect(providerUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(providerUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const callbackResponse = await page
      .context()
      .request.get(
        `/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(
          providerUrl.searchParams.get('state') || ''
        )}`,
        { maxRedirects: 0 }
      );
    expect(callbackResponse.status()).toBe(302);
    const location = callbackResponse.headers().location;
    expect(location).toBeTruthy();
    const errorUrl = new URL(location || '/', page.url());
    expect(errorUrl.pathname).toBe('/auth-error');
    expect(errorUrl.searchParams.get('callbackUrl')).toBe('/review');
    expect(errorUrl.searchParams.get('error')).toBe('access_denied');

    await page.goto(`${errorUrl.pathname}${errorUrl.search}`);
    await expect(
      page.getByRole('heading', { name: 'Google 登录未完成' })
    ).toBeVisible();
    await expect(page.getByText(/已取消 Google 授权/)).toBeVisible();
    await expect(page.getByRole('link', { name: '重新登录' })).toHaveAttribute(
      'href',
      '/sign-in?callbackUrl=%2Freview'
    );
  });

  test('does not expose the removed anonymous email endpoint', async ({
    request,
  }, testInfo) => {
    test.skip(isMobileProject(testInfo), 'Desktop API surface coverage');

    const response = await request.post('/api/email/send-email', {
      data: { emails: ['attacker@example.com'], subject: 'probe' },
    });
    expect(response.status()).toBe(404);
  });

  test('registers through mocked Google and preserves visitor learning data', async ({
    page,
  }, testInfo) => {
    test.skip(isMobileProject(testInfo), 'Desktop Google account coverage');
    const email = uniqueEmail(testInfo, 'google-first');
    const now = new Date().toISOString();

    await page.addInitScript((onboardedAt) => {
      if (sessionStorage.getItem('algocoach-google-guest-seeded')) return;
      sessionStorage.setItem('algocoach-google-guest-seeded', 'true');
      localStorage.setItem(
        'algocoach:state:v2',
        JSON.stringify({
          version: 2,
          profile: {
            goal: 'interview',
            preferredLanguage: 'python',
            weeklyTarget: 5,
            onboardingCompleted: true,
            onboardedAt,
          },
          sessions: {},
          artifacts: [],
          events: [],
          activeAssessment: null,
          assessments: [],
          code: {},
          runs: [],
          completedProblemIds: [],
        })
      );
    }, now);
    await page.goto('/learn');
    await expect(
      page.getByRole('heading', { name: '今天，从一道好题开始' })
    ).toBeVisible();

    const response = await page
      .context()
      .request.post('/api/auth/sign-in/social', {
        data: {
          provider: 'google',
          callbackURL: '/progress',
          idToken: {
            token: googleToken(email, `google-${Date.now()}`, 'Google Learner'),
          },
        },
      });
    expect(response.ok()).toBe(true);
    await expect.poll(() => sessionEmail(page)).toBe(email);

    await page.goto('/progress');
    await expect(page.getByRole('heading', { name: '学习进度' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem('algocoach:guest-claimed-by:v1')
        )
      )
      .toMatch(/^user:/);
    const claimed = await page.evaluate(() => {
      const scope = localStorage.getItem('algocoach:guest-claimed-by:v1');
      const state = scope
        ? localStorage.getItem(`algocoach:state:v4:${scope}`)
        : null;
      return { scope, state: state ? JSON.parse(state) : null };
    });
    expect(claimed.scope).toMatch(/^user:/);
    expect(claimed.state?.profile).toMatchObject({
      goal: 'interview',
      preferredLanguage: 'python',
    });
  });

  test('links verified Google email without replacing the existing profile', async ({
    page,
  }, testInfo) => {
    test.skip(isMobileProject(testInfo), 'Desktop Google linking coverage');
    const email = uniqueEmail(testInfo, 'google-link');
    const request = page.context().request;

    const signUp = await request.post('/api/auth/sign-up/email', {
      data: {
        name: 'Existing Learner',
        email,
        password: PASSWORD,
        callbackURL: '/learn',
      },
    });
    expect(signUp.ok()).toBe(true);
    const originalSession = (await request
      .get('/api/auth/get-session')
      .then((response) => response.json())) as {
      user: { id: string; name: string; image?: string | null };
    };
    expect(originalSession.user.name).toBe('Existing Learner');
    expect((await request.post('/api/auth/sign-out')).ok()).toBe(true);

    const googleSignIn = await request.post('/api/auth/sign-in/social', {
      data: {
        provider: 'google',
        callbackURL: '/review',
        idToken: {
          token: googleToken(
            email,
            `linked-google-${Date.now()}`,
            'Replacement Google Name'
          ),
        },
      },
    });
    expect(googleSignIn.ok()).toBe(true);
    const linkedSession = (await request
      .get('/api/auth/get-session')
      .then((response) => response.json())) as {
      user: { id: string; name: string; image?: string | null };
    };
    expect(linkedSession.user.id).toBe(originalSession.user.id);
    expect(linkedSession.user.name).toBe('Existing Learner');
    expect(linkedSession.user.image ?? null).toBe(
      originalSession.user.image ?? null
    );
  });

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
