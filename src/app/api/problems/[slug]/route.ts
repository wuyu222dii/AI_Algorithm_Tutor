import { createHash } from 'node:crypto';
import {
  getRuntimeProblem,
  runtimeEnabledLanguages,
} from '@/features/algorithm-coach/catalog-runtime.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function etag(value: unknown): string {
  return `"${createHash('sha256')
    .update(JSON.stringify(value))
    .digest('base64url')}"`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const versionValue = new URL(request.url).searchParams.get('version');
  const version = versionValue === null ? undefined : Number(versionValue);
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    (version !== undefined && (!Number.isInteger(version) || version < 1))
  ) {
    return Response.json(
      { error: { code: 'invalid_query', message: 'Invalid problem query.' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  try {
    const problem = await getRuntimeProblem(slug, version);
    if (!problem) {
      return Response.json(
        { error: { code: 'not_found', message: 'Problem not found.' } },
        { status: 404, headers: { 'cache-control': 'no-store' } }
      );
    }
    const enabledLanguages = new Set(runtimeEnabledLanguages());
    const data = {
      ...problem,
      languageConfigs: Object.fromEntries(
        Object.entries(problem.languageConfigs ?? {}).filter(([language]) =>
          enabledLanguages.has(
            language as ReturnType<typeof runtimeEnabledLanguages>[number]
          )
        )
      ),
      ...(problem.templates
        ? {
            templates: Object.fromEntries(
              Object.entries(problem.templates).filter(([language]) =>
                enabledLanguages.has(
                  language as ReturnType<typeof runtimeEnabledLanguages>[number]
                )
              )
            ),
          }
        : {}),
      tests: problem.tests.filter((test) => test.isSample),
    };
    const responseEtag = etag(data);
    if (request.headers.get('if-none-match') === responseEtag) {
      return new Response(null, {
        status: 304,
        headers: {
          etag: responseEtag,
          'cache-control':
            'public, max-age=0, s-maxage=300, stale-while-revalidate=900',
        },
      });
    }
    return Response.json(
      { data },
      {
        headers: {
          etag: responseEtag,
          'cache-control':
            'public, max-age=0, s-maxage=300, stale-while-revalidate=900',
        },
      }
    );
  } catch (error) {
    const traceId = crypto.randomUUID();
    console.error(`[problem-catalog:${traceId}] detail failed`, error);
    return Response.json(
      {
        error: {
          code: 'catalog_unavailable',
          message: 'The problem catalog is temporarily unavailable.',
          traceId,
        },
      },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
}
