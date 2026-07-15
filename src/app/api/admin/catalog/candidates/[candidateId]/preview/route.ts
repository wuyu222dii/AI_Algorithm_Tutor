import { authorizeCatalogAdmin } from '@/features/algorithm-coach/catalog/admin-auth.server';
import { getCatalogAdminCandidatePreview } from '@/features/algorithm-coach/catalog/admin-service.server';
import { CoachHttpError, errorResponse } from '@/features/algorithm-coach/http';
import { z } from 'zod';

import { PERMISSIONS } from '@/core/rbac/permission';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CANDIDATE_ID = /^[A-Za-z0-9_-]{1,180}$/;
const querySchema = z.object({
  kind: z.enum(['upstream', 'compiled']).default('compiled'),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    await authorizeCatalogAdmin(request, PERMISSIONS.CATALOG_READ);
    const { candidateId } = await context.params;
    const parsed = querySchema.safeParse({
      kind: new URL(request.url).searchParams.get('kind') ?? undefined,
    });
    if (!CANDIDATE_ID.test(candidateId) || !parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_catalog_preview',
        'Invalid catalog preview request.'
      );
    }
    const preview = await getCatalogAdminCandidatePreview(
      candidateId,
      parsed.data.kind
    );
    if (preview === undefined) {
      throw new CoachHttpError(
        404,
        'candidate_not_found',
        'Catalog candidate not found.'
      );
    }
    return Response.json(
      { data: { kind: parsed.data.kind, payload: preview } },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    console.error(`[catalog-admin:${traceId}] candidate preview failed`, error);
    return errorResponse(
      new CoachHttpError(
        503,
        'catalog_admin_unavailable',
        'Catalog preview is temporarily unavailable.'
      ),
      traceId
    );
  }
}
