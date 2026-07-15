import { authorizeCatalogAdmin } from '@/features/algorithm-coach/catalog/admin-auth.server';
import {
  catalogFunctionSignatureSchema,
  catalogReviewFunctionProtocolV2Schema,
} from '@/features/algorithm-coach/catalog/admin-contracts';
import { listCatalogAdminCanonicalCases } from '@/features/algorithm-coach/catalog/admin-service.server';
import {
  CoachHttpError,
  errorResponse,
  readJsonBody,
} from '@/features/algorithm-coach/http';
import { z } from 'zod';

import { PERMISSIONS } from '@/core/rbac/permission';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CANDIDATE_ID = /^[A-Za-z0-9_-]{1,180}$/;
const pageSchema = z.object({
  cursor: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const previewSchema = z
  .object({
    signature: catalogFunctionSignatureSchema.nullable(),
    entryPoints: catalogReviewFunctionProtocolV2Schema.shape.entryPoints,
    cursor: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

async function responseFor(
  candidateId: string,
  options: Parameters<typeof listCatalogAdminCanonicalCases>[1]
) {
  const data = await listCatalogAdminCanonicalCases(candidateId, options);
  if (!data) {
    throw new CoachHttpError(
      404,
      'candidate_not_found',
      'Catalog candidate not found.'
    );
  }
  return Response.json({ data }, { headers: { 'cache-control': 'no-store' } });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    await authorizeCatalogAdmin(request, PERMISSIONS.CATALOG_READ);
    const { candidateId } = await context.params;
    const url = new URL(request.url);
    const parsed = pageSchema.safeParse({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!CANDIDATE_ID.test(candidateId) || !parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_canonical_query',
        'Invalid canonical case query.'
      );
    }
    return await responseFor(candidateId, parsed.data);
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    console.error(`[catalog-admin:${traceId}] canonical cases failed`, error);
    return errorResponse(
      new CoachHttpError(
        503,
        'catalog_admin_unavailable',
        'Canonical cases are temporarily unavailable.'
      ),
      traceId
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    await authorizeCatalogAdmin(request, PERMISSIONS.CATALOG_REVIEW, {
      mutation: true,
    });
    const { candidateId } = await context.params;
    const parsed = previewSchema.safeParse(await readJsonBody(request, 30_000));
    if (!CANDIDATE_ID.test(candidateId) || !parsed.success) {
      throw new CoachHttpError(
        422,
        'invalid_canonical_preview',
        'Invalid canonical mapping preview.',
        parsed.success ? undefined : parsed.error.flatten()
      );
    }
    return await responseFor(candidateId, parsed.data);
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    console.error(`[catalog-admin:${traceId}] canonical preview failed`, error);
    return errorResponse(
      new CoachHttpError(
        503,
        'catalog_admin_unavailable',
        'Canonical mapping preview is temporarily unavailable.'
      ),
      traceId
    );
  }
}
