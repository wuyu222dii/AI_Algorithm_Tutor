import path from 'node:path';
import { createClient } from '@libsql/client';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const PASSWORD = 'AlgoCoach-Catalog-E2E-2026!';
const databaseUrl = `file:${path.resolve(
  process.cwd(),
  '.test/algocoach-e2e.db'
)}`;

function uniqueEmail(testInfo: TestInfo) {
  return `catalog-admin-${Date.now()}-${testInfo.workerIndex}-${Math.random()
    .toString(36)
    .slice(2, 9)}@example.test`;
}

async function createSession(page: Page, testInfo: TestInfo) {
  const response = await page
    .context()
    .request.post('/api/auth/sign-up/email', {
      data: {
        name: 'Catalog reviewer',
        email: uniqueEmail(testInfo),
        password: PASSWORD,
        callbackURL: '/admin/catalog/candidates',
      },
    });
  expect(response.ok()).toBe(true);
  let userId: string | undefined;
  await expect
    .poll(
      async () => {
        const session = (await page
          .context()
          .request.get('/api/auth/get-session', {
            headers: { 'cache-control': 'no-store' },
          })
          .then((result) => result.json().catch(() => null))) as {
          user?: { id?: string };
        } | null;
        userId = session?.user?.id;
        return userId;
      },
      { timeout: 10_000, intervals: [100, 250, 500] }
    )
    .toBeTruthy();
  return userId!;
}

async function grantCatalogAdmin(userId: string) {
  const client = createClient({ url: databaseUrl });
  const roleId = 'e2e-catalog-admin';
  try {
    await client.execute('pragma busy_timeout = 10000');
    const statements = [
      {
        sql: `insert or ignore into role (id, name, title, description, status, sort)
                values (?, ?, ?, ?, ?, ?)`,
        args: [
          roleId,
          roleId,
          'E2E catalog admin',
          'Isolated browser-test role',
          'active',
          1,
        ],
      },
      ...['read', 'review', 'publish', 'rollback'].flatMap((action) => {
        const permissionId = `e2e-catalog-${action}`;
        return [
          {
            sql: `insert or ignore into permission
                    (id, code, resource, action, title, description)
                    values (?, ?, ?, ?, ?, ?)`,
            args: [
              permissionId,
              `admin.catalog.${action}`,
              'catalog',
              action,
              `Catalog ${action}`,
              'E2E permission',
            ],
          },
          {
            sql: `insert or ignore into role_permission
                    (id, role_id, permission_id)
                    values (?, ?, ?)`,
            args: [`e2e-role-permission-${action}`, roleId, permissionId],
          },
        ];
      }),
      {
        sql: `insert into user_role (id, user_id, role_id)
                values (?, ?, ?)`,
        args: [`e2e-user-role-${userId}`, userId, roleId],
      },
    ];
    for (let attempt = 0; ; attempt += 1) {
      try {
        await client.batch(statements, 'write');
        break;
      } catch (error) {
        if (
          attempt >= 7 ||
          !(error instanceof Error) ||
          !error.message.includes('SQLITE_BUSY')
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  } finally {
    client.close();
  }
}

type ReviewStatus = 'quarantined' | 'validated' | 'approved';

function summary(status: ReviewStatus = 'quarantined') {
  return {
    id: 'candidate-e2e',
    externalId: 'resistor-color',
    status,
    changeKind: 'new',
    draftRevision: 1,
    sourceRevision: '4d18823c6abd89a60f2df65345d970a31fa12e49',
    updatedAt: '2026-07-15T00:00:00.000Z',
    title: { zh: '电阻色码', en: 'Resistor Color' },
  };
}

function detail(status: ReviewStatus = 'quarantined') {
  return {
    ...summary(status),
    upstreamUrl:
      'https://github.com/exercism/problem-specifications/tree/4d18823c/exercises/resistor-color',
    contentHash: 'sha256:1234567890abcdef',
    licenseSpdx: 'MIT',
    attribution: 'Exercism contributors',
    upstreamPayload: {
      statementMarkdown: '# Resistor Color',
      canonicalData: { cases: [{ uuid: 'canonical-1' }] },
    },
    draftProblem: {
      slug: 'exercism-resistor-color',
      title: { zh: '电阻色码', en: 'Resistor Color' },
      tests: [{ sourceKind: 'canonical', sourceTestUuid: 'canonical-1' }],
    },
    validation: { valid: true, issues: [] },
    evidence: {
      rawContentHash: 'sha256:1234567890abcdef',
      policyVersion: 'catalog-policy-v1',
    },
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1
      )
    )
    .toBe(true);
}

test.describe('catalog administration', () => {
  test('redirects an anonymous visitor to sign in', async ({ page }) => {
    await page.goto('/admin/catalog/candidates');
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=/);
    expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(
      '/admin/catalog/candidates'
    );
  });

  test('reviews a candidate and keeps publication as a separate action', async ({
    page,
  }, testInfo) => {
    const userId = await createSession(page, testInfo);
    await grantCatalogAdmin(userId);

    let candidateStatus: ReviewStatus = 'quarantined';
    let actorMode: 'reviewer' | 'publisher' = 'reviewer';
    const mutations: Array<{
      path: string;
      body: unknown;
      key: string | null;
    }> = [];
    await page.route(
      '**/api/admin/catalog/candidates/candidate-e2e/**',
      async (route) => {
        const request = route.request();
        const pathName = new URL(request.url()).pathname;
        mutations.push({
          path: pathName,
          body: request.postDataJSON(),
          key: request.headers()['idempotency-key'] ?? null,
        });
        if (pathName.endsWith('/validate')) candidateStatus = 'validated';
        if (pathName.endsWith('/approve')) candidateStatus = 'approved';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { candidateId: 'candidate-e2e' } }),
        });
      }
    );
    await page.route(
      '**/api/admin/catalog/candidates/candidate-e2e',
      async (route) => {
        const request = route.request();
        if (request.method() === 'PATCH') {
          mutations.push({
            path: new URL(request.url()).pathname,
            body: request.postDataJSON(),
            key: request.headers()['idempotency-key'] ?? null,
          });
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: { candidateId: 'candidate-e2e', draftRevision: 2 },
            }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: detail(candidateStatus) }),
        });
      }
    );
    await page.route('**/api/admin/catalog/candidates?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            items: [summary(candidateStatus)],
            capabilities:
              actorMode === 'reviewer'
                ? { review: true, publish: false, rollback: false }
                : { review: false, publish: true, rollback: true },
          },
        }),
      });
    });

    await page.goto('/admin/catalog/candidates');
    await expect(page.getByRole('heading', { name: '电阻色码' })).toBeVisible();
    await expect(page.getByText('canonical-1')).toBeVisible();
    await expect(page.getByLabel('结构化题目草稿')).toBeEnabled();
    await expect(page.getByRole('button', { name: '发布' })).toBeDisabled();
    await expectNoHorizontalOverflow(page);

    const draft = page.getByLabel('结构化题目草稿');
    const editedDraft = JSON.parse(await draft.inputValue()) as {
      title: { zh: string };
    };
    editedDraft.title.zh = '电阻色码（审核稿）';
    await draft.fill(JSON.stringify(editedDraft, null, 2));
    await page.getByRole('button', { name: '保存草稿' }).click();
    await page.getByRole('button', { name: '重新校验' }).click();
    await page
      .getByLabel('审核说明')
      .fill('题面、授权和 canonical UUID 已核对');
    await page.getByRole('button', { name: '批准' }).click();

    await expect.poll(() => mutations.length).toBe(3);
    expect(mutations.map((item) => item.path)).toEqual([
      '/api/admin/catalog/candidates/candidate-e2e',
      '/api/admin/catalog/candidates/candidate-e2e/validate',
      '/api/admin/catalog/candidates/candidate-e2e/approve',
    ]);
    expect(
      mutations.every((item) => /^\w+:[0-9a-f-]+$/i.test(item.key ?? ''))
    ).toBe(true);
    expect(mutations[0].body).toMatchObject({
      expectedDraftRevision: 1,
      draftProblem: { title: { zh: '电阻色码（审核稿）' } },
    });
    expect(mutations[2].body).toEqual({
      notes: '题面、授权和 canonical UUID 已核对',
    });

    expect((await page.context().request.post('/api/auth/sign-out')).ok()).toBe(
      true
    );
    const publisherId = await createSession(page, testInfo);
    expect(publisherId).not.toBe(userId);
    await grantCatalogAdmin(publisherId);
    actorMode = 'publisher';

    await page.goto('/admin/catalog/candidates');
    await expect(page.getByRole('button', { name: '批准' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '发布' })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await page
      .getByLabel('审核说明')
      .fill('独立发布人已复核校验结果与来源证据');
    await page.getByRole('button', { name: '发布' }).click();

    await expect.poll(() => mutations.length).toBe(4);
    expect(mutations[3]).toMatchObject({
      path: '/api/admin/catalog/candidates/candidate-e2e/publish',
      body: { notes: '独立发布人已复核校验结果与来源证据' },
    });
    expect(mutations[3].key).toMatch(/^publish:[0-9a-f-]+$/i);
  });
});
