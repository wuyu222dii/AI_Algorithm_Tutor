import {
  CatalogAdminActionError,
  executeCatalogRollback,
} from '@/features/algorithm-coach/catalog/admin-actions.server';
import { authorizeCatalogAdmin } from '@/features/algorithm-coach/catalog/admin-auth.server';
import { recordCatalogAdminFailure } from '@/features/algorithm-coach/catalog/admin-observability.server';
import {
  CoachHttpError,
  errorResponse,
  readJsonBody,
} from '@/features/algorithm-coach/http';
import { z } from 'zod';

import { PERMISSIONS } from '@/core/rbac/permission';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const rollbackSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    targetVersion: z.number().int().min(1).max(1_000_000),
    notes: z.string().trim().min(1).max(2000),
  })
  .strict();

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const identity = await authorizeCatalogAdmin(
      request,
      PERMISSIONS.CATALOG_ROLLBACK,
      { mutation: true, idempotent: true }
    );
    const parsed = rollbackSchema.safeParse(
      await readJsonBody(request, 10_000)
    );
    if (!parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_catalog_rollback',
        'Catalog rollback validation failed.',
        parsed.error.flatten()
      );
    }
    const data = await executeCatalogRollback({
      problemSlug: parsed.data.slug,
      targetVersion: parsed.data.targetVersion,
      notes: parsed.data.notes,
      actorUserId: identity.userId,
      idempotencyKey: identity.idempotencyKey!,
    });
    return Response.json(
      { data },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    if (error instanceof CatalogAdminActionError) {
      return errorResponse(
        new CoachHttpError(error.status, error.code, error.message),
        traceId
      );
    }
    await recordCatalogAdminFailure('rollback', traceId, error);
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
