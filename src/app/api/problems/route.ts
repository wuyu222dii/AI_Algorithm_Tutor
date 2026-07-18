import { createHash } from 'node:crypto';
import {
  listRuntimeProblemSummaries,
  runtimeEnabledLanguages,
} from '@/features/algorithm-coach/catalog-runtime.server';
import { isLanguage } from '@/features/algorithm-coach/languages';
import type { Difficulty, Language } from '@/features/algorithm-coach/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DIFFICULTIES = new Set<Difficulty>(['easy', 'medium', 'hard']);

function decodeCursor(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const slug = Buffer.from(value, 'base64url').toString('utf8');
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(slug: string): string {
  return Buffer.from(slug, 'utf8').toString('base64url');
}

function etag(value: unknown): string {
  return `"${createHash('sha256')
    .update(JSON.stringify(value))
    .digest('base64url')}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const difficultyValue = url.searchParams.get('difficulty');
  const languageValue = url.searchParams.get('language');
  const topic = url.searchParams.get('topic')?.trim() || undefined;
  const cursorValue = url.searchParams.get('cursor');
  const afterSlug = decodeCursor(cursorValue);
  const requestedLimit = Number(url.searchParams.get('limit') ?? 20);
  const enabledLanguages = runtimeEnabledLanguages();

  if (
    (difficultyValue && !DIFFICULTIES.has(difficultyValue as Difficulty)) ||
    (languageValue &&
      (!isLanguage(languageValue) ||
        !enabledLanguages.includes(
          languageValue as (typeof enabledLanguages)[number]
        ))) ||
    (cursorValue && !afterSlug) ||
    (topic && (topic.length > 80 || !/^[a-z0-9-]+$/.test(topic))) ||
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 50
  ) {
    return Response.json(
      { error: { code: 'invalid_query', message: 'Invalid catalog query.' } },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  try {
    const rows = await listRuntimeProblemSummaries({
      difficulty: difficultyValue as Difficulty | undefined,
      language: (languageValue || undefined) as Language | undefined,
      topic,
      afterSlug,
      limit: requestedLimit + 1,
    });
    const hasMore = rows.length > requestedLimit;
    const visible = rows.slice(0, requestedLimit);
    const data = {
      items: visible,
      nextCursor:
        hasMore && visible.length
          ? encodeCursor(visible[visible.length - 1].slug)
          : null,
    };
    const responseEtag = etag(data);
    if (request.headers.get('if-none-match') === responseEtag) {
      return new Response(null, {
        status: 304,
        headers: {
          etag: responseEtag,
          'cache-control':
            'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }
    return Response.json(
      { data },
      {
        headers: {
          etag: responseEtag,
          'cache-control':
            'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    const traceId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        event: 'problem_catalog_list_failed',
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
