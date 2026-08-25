import { authorizeCatalogAdmin } from '@/features/algorithm-coach/catalog/admin-auth.server';
import { recordCatalogAdminFailure } from '@/features/algorithm-coach/catalog/admin-observability.server';
import { getCatalogAdminSyncHealth } from '@/features/algorithm-coach/catalog/admin-service.server';
import { CoachHttpError, errorResponse } from '@/features/algorithm-coach/http';
import { z } from 'zod';

import { PERMISSIONS } from '@/core/rbac/permission';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await authorizeCatalogAdmin(request, PERMISSIONS.CATALOG_READ);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_query',
        'Invalid catalog sync health query.',
        parsed.error.flatten()
      );
    }
    const health = await getCatalogAdminSyncHealth(parsed.data.limit);
    return Response.json(
      { data: health },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    await recordCatalogAdminFailure('sync_health', traceId, error);
    return errorResponse(
      new CoachHttpError(
        503,
        'catalog_admin_unavailable',
        'Catalog sync health is temporarily unavailable.'
      ),
      traceId
    );
  }
}
