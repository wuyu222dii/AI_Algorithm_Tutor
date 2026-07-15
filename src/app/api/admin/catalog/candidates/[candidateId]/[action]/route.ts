import {
  CatalogAdminActionError,
  executeCatalogCandidateAction,
} from '@/features/algorithm-coach/catalog/admin-actions.server';
import { authorizeCatalogAdmin } from '@/features/algorithm-coach/catalog/admin-auth.server';
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
const actionSchema = z.enum(['validate', 'approve', 'reject', 'publish']);
const bodySchema = z
  .object({ notes: z.string().trim().max(2000).default('') })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ candidateId: string; action: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    const params = await context.params;
    const action = actionSchema.safeParse(params.action);
    const identity = await authorizeCatalogAdmin(
      request,
      action.success && action.data === 'publish'
        ? PERMISSIONS.CATALOG_PUBLISH
        : PERMISSIONS.CATALOG_REVIEW,
      { mutation: true, idempotent: true }
    );
    if (!CANDIDATE_ID.test(params.candidateId) || !action.success) {
      throw new CoachHttpError(
        400,
        'invalid_catalog_action',
        'Invalid catalog action.'
      );
    }
    const parsed = bodySchema.safeParse(await readJsonBody(request, 10_000));
    if (!parsed.success || (action.data === 'reject' && !parsed.data.notes)) {
      throw new CoachHttpError(
        400,
        'invalid_catalog_action_body',
        action.data === 'reject'
          ? 'A rejection reason is required.'
          : 'Catalog action validation failed.',
        parsed.success ? undefined : parsed.error.flatten()
      );
    }
    const data = await executeCatalogCandidateAction({
      action: action.data,
      candidateId: params.candidateId,
      actorUserId: identity.userId,
      idempotencyKey: identity.idempotencyKey!,
      payload: parsed.data,
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
    console.error(`[catalog-admin:${traceId}] catalog action failed`, error);
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
