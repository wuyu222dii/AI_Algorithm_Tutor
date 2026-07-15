import { authorizeCatalogAdmin } from '@/features/algorithm-coach/catalog/admin-auth.server';
import {
  catalogAdminCapabilities,
  listCatalogAdminCandidates,
} from '@/features/algorithm-coach/catalog/admin-service.server';
import { CoachHttpError, errorResponse } from '@/features/algorithm-coach/http';
import { z } from 'zod';

import { PERMISSIONS } from '@/core/rbac/permission';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  status: z
    .enum([
      'pending',
      'all',
      'discovered',
      'drafting',
      'quarantined',
      'validated',
      'approved',
      'published',
      'rejected',
      'archived',
    ])
    .default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const identity = await authorizeCatalogAdmin(
      request,
      PERMISSIONS.CATALOG_READ
    );
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_query',
        'Invalid catalog candidate query.',
        parsed.error.flatten()
      );
    }
    const [items, capabilities] = await Promise.all([
      listCatalogAdminCandidates(parsed.data),
      catalogAdminCapabilities(identity.userId),
    ]);
    return Response.json(
      { data: { items, capabilities } },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    console.error(`[catalog-admin:${traceId}] candidate list failed`, error);
    return errorResponse(
      new CoachHttpError(
        503,
        'catalog_admin_unavailable',
        'Catalog review is temporarily unavailable.'
      ),
      traceId
    );
  }
}
