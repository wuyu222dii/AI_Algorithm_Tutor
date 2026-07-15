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

function summary(status: ReviewStatus = 'quarantined', draftRevision = 1) {
  return {
    id: 'candidate-e2e',
    externalId: 'resistor-color',
    status,
    changeKind: 'new',
    draftRevision,
    sourceRevision: '4d18823c6abd89a60f2df65345d970a31fa12e49',
    updatedAt: '2026-07-15T00:00:00.000Z',
    title: { zh: '电阻色码', en: 'Resistor Color' },
  };
}

function reviewDraft() {
  return {
    schemaVersion: 2,
    id: 'ex-101',
    slug: 'exercism-resistor-color',
    title: { zh: '电阻色码', en: 'Resistor Color' },
    description: {
      zh: '根据颜色名称返回对应数字。',
      en: 'Return the numeric value for a resistor color.',
    },
    difficulty: 'easy',
    topics: ['array-hash'],
    learningObjectives: [
      { zh: '练习确定性映射', en: 'Practice deterministic mapping' },
    ],
    prerequisiteTopics: [],
    solutionPatterns: ['lookup-table'],
    constraints: [{ zh: '颜色名称有效', en: 'Color names are valid' }],
    hints: [
      { zh: '建立颜色顺序。', en: 'Build the color order.' },
      { zh: '查找输入颜色。', en: 'Look up the input color.' },
      { zh: '返回对应索引。', en: 'Return the matching index.' },
    ],
    reviewPoints: [{ zh: '检查边界颜色。', en: 'Check boundary colors.' }],
    estimatedMinutes: 10,
    functionProtocol: {
      signature: {
        parameters: [{ name: 'color', type: { kind: 'string' } }],
        returns: { kind: 'integer' },
      },
      entryPoints: {
        javascript: 'colorCode',
        python: 'color_code',
        typescript: 'colorCode',
      },
      templates: {
        javascript: 'function colorCode(color) { throw new Error("TODO"); }',
        python: 'def color_code(color):\n    raise NotImplementedError()',
        typescript:
          'function colorCode(color: string): number { throw new Error("TODO"); }',
      },
    },
    canonicalSelections: [
      { sourceTestUuid: 'canonical-1', id: 'color-1', isSample: true },
      { sourceTestUuid: 'canonical-2', id: 'color-2', isSample: false },
      { sourceTestUuid: 'canonical-3', id: 'color-3', isSample: false },
    ],
    manualTests: [],
  };
}

function detail(status: ReviewStatus = 'quarantined', draftRevision = 1) {
  const revision = '4d18823c6abd89a60f2df65345d970a31fa12e49';
  const hash = `sha256:${'a'.repeat(64)}`;
  return {
    ...summary(status, draftRevision),
    upstreamUrl:
      'https://github.com/exercism/problem-specifications/tree/4d18823c/exercises/resistor-color',
    contentHash: 'sha256:1234567890abcdef',
    licenseSpdx: 'MIT',
    attribution: 'Exercism contributors',
    draftKind: 'review_v2',
    reviewDraft: reviewDraft(),
    problemSlug: 'exercism-resistor-color',
    editable: true,
    lockedSourceEvidence: {
      provider: 'exercism',
      repository: 'exercism/problem-specifications',
      externalId: 'resistor-color',
      upstreamUrl: `https://github.com/exercism/problem-specifications/tree/${revision}/exercises/resistor-color`,
      statementPath: 'exercises/resistor-color/instructions.md',
      canonicalPath: 'exercises/resistor-color/canonical-data.json',
      sourceRevision: revision,
      licenseSpdx: 'MIT',
      attribution: 'Exercism contributors',
      statementHash: hash,
      canonicalDataHash: hash,
      licenseContentHash: hash,
      statementBlobSha: 'b'.repeat(40),
      canonicalBlobSha: 'c'.repeat(40),
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
    let candidateDraftRevision = 1;
    let normalized = false;
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
        if (pathName.endsWith('/canonical-cases')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: {
                items: [
                  {
                    sourceTestUuid: 'canonical-1',
                    description: 'black maps to zero',
                    sourceOrder: 0,
                    status: 'mapped',
                    args: ['black'],
                    expected: 0,
                  },
                  {
                    sourceTestUuid: 'canonical-2',
                    description: 'brown maps to one',
                    sourceOrder: 1,
                    status: 'mapped',
                    args: ['brown'],
                    expected: 1,
                  },
                  {
                    sourceTestUuid: 'canonical-3',
                    description: 'white maps to nine',
                    sourceOrder: 2,
                    status: 'mapped',
                    args: ['white'],
                    expected: 9,
                  },
                ],
                total: 3,
                mapped: 3,
                selected: reviewDraft().canonicalSelections,
              },
            }),
          });
          return;
        }
        if (pathName.endsWith('/preview')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: { kind: 'compiled', payload: { schemaVersion: 2 } },
            }),
          });
          return;
        }
        mutations.push({
          path: pathName,
          body: request.postDataJSON(),
          key: request.headers()['idempotency-key'] ?? null,
        });
        if (pathName.endsWith('/normalize')) {
          normalized = true;
          candidateDraftRevision += 1;
        }
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
          candidateDraftRevision += 1;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: {
                candidateId: 'candidate-e2e',
                draftRevision: candidateDraftRevision,
              },
            }),
          });
          return;
        }
        const currentDetail = detail(candidateStatus, candidateDraftRevision);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: normalized
              ? currentDetail
              : {
                  ...currentDetail,
                  draftKind: 'discovery',
                  reviewDraft: undefined,
                },
          }),
        });
      }
    );
    await page.route(
      /\/api\/admin\/catalog\/candidates(?:\?.*)?$/,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              items: [summary(candidateStatus, candidateDraftRevision)],
              capabilities:
                actorMode === 'reviewer'
                  ? {
                      review: true,
                      publish: false,
                      rollback: false,
                      structuredReviewMode: 'write',
                    }
                  : {
                      review: false,
                      publish: true,
                      rollback: true,
                      structuredReviewMode: 'write',
                    },
            },
          }),
        });
      }
    );

    await page.goto('/admin/catalog/candidates');
    await expect(page.getByRole('heading', { name: '电阻色码' })).toBeVisible();
    await page.getByRole('button', { name: '转换为结构化草稿' }).click();
    await expect(page.locator('#catalog-problem-id')).toBeDisabled();
    await expect(page.getByRole('button', { name: '发布' })).toBeDisabled();
    await expectNoHorizontalOverflow(page);

    await page.locator('#catalog-title-zh').fill('电阻色码（审核稿）');
    await page.getByRole('button', { name: '保存草稿' }).click();
    await page.getByRole('tab', { name: '测试用例' }).click();
    await expect(page.getByText('canonical-1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重新校验' }).click();
    await page
      .getByLabel('审核说明')
      .fill('题面、授权和 canonical UUID 已核对');
    await page.getByRole('button', { name: '批准' }).click();

    await expect.poll(() => mutations.length).toBe(4);
    expect(mutations.map((item) => item.path)).toEqual([
      '/api/admin/catalog/candidates/candidate-e2e/normalize',
      '/api/admin/catalog/candidates/candidate-e2e',
      '/api/admin/catalog/candidates/candidate-e2e/validate',
      '/api/admin/catalog/candidates/candidate-e2e/approve',
    ]);
    expect(
      mutations.every((item) => /^\w+:[0-9a-f-]+$/i.test(item.key ?? ''))
    ).toBe(true);
    expect(mutations[0].body).toEqual({ expectedDraftRevision: 1 });
    expect(mutations[1].body).toMatchObject({
      schemaVersion: 2,
      expectedDraftRevision: 2,
      draft: { title: { zh: '电阻色码（审核稿）' } },
    });
    expect(mutations[3].body).toEqual({
      notes: '题面、授权和 canonical UUID 已核对',
      expectedDraftRevision: 3,
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

    await expect.poll(() => mutations.length).toBe(5);
    expect(mutations[4]).toMatchObject({
      path: '/api/admin/catalog/candidates/candidate-e2e/publish',
      body: {
        notes: '独立发布人已复核校验结果与来源证据',
        expectedDraftRevision: 3,
      },
    });
    expect(mutations[4].key).toMatch(/^publish:[0-9a-f-]+$/i);
  });

  test('keeps all 131 candidates reachable through server pagination', async ({
    page,
  }, testInfo) => {
    const userId = await createSession(page, testInfo);
    await grantCatalogAdmin(userId);
    const candidates = Array.from({ length: 131 }, (_, index) => ({
      ...summary('quarantined', 1),
      id: `candidate-${index + 1}`,
      externalId: `exercise-${index + 1}`,
      title: {
        zh: `候选题 ${index + 1}`,
        en: `Candidate ${index + 1}`,
      },
    }));

    await page.route(
      /\/api\/admin\/catalog\/candidates\/candidate-\d+$/,
      async (route) => {
        const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
        const item = candidates.find((candidate) => candidate.id === id)!;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              ...detail('quarantined', 1),
              ...item,
              draftKind: 'discovery',
              reviewDraft: undefined,
              editable: true,
            },
          }),
        });
      }
    );
    await page.route(
      /\/api\/admin\/catalog\/candidates(?:\?.*)?$/,
      async (route) => {
        const url = new URL(route.request().url());
        const start = Number(url.searchParams.get('cursor') ?? 0);
        const items = candidates.slice(start, start + 25);
        const nextCursor =
          start + items.length < candidates.length
            ? String(start + items.length)
            : undefined;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              items,
              nextCursor,
              capabilities: {
                review: true,
                publish: false,
                rollback: false,
                structuredReviewMode: 'write',
              },
            },
          }),
        });
      }
    );

    await page.goto('/admin/catalog/candidates');
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      await page.getByRole('button', { name: '加载更多候选' }).click();
    }
    if (testInfo.project.name.startsWith('mobile')) {
      await page.getByLabel('选择审核候选').click();
      await page.getByRole('option', { name: /候选题 131/ }).click();
    } else {
      const finalCandidate = page.getByRole('button', {
        name: /候选题 131/,
      });
      await finalCandidate.scrollIntoViewIfNeeded();
      await finalCandidate.click();
    }
    await expect(
      page.getByRole('heading', { name: '候选题 131' })
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
