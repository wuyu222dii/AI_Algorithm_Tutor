import { createHash } from 'node:crypto';
import {
  getRuntimeProblem,
  runtimeEnabledLanguages,
} from '@/features/algorithm-coach/catalog-runtime.server';
import { toPublicProblemDetail } from '@/features/algorithm-coach/problem-contracts';

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
    const data = toPublicProblemDetail(problem, runtimeEnabledLanguages());
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
    console.error(
      JSON.stringify({
        event: 'problem_catalog_detail_failed',
        traceId,
        errorName: error instanceof Error ? error.name : 'Error',
      })
    );
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
