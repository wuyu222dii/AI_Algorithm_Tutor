import {
  CatalogAdminActionError,
  executeCatalogCandidateAction,
} from '@/features/algorithm-coach/catalog/admin-actions.server';
import { authorizeCatalogAdmin } from '@/features/algorithm-coach/catalog/admin-auth.server';
import { getCatalogAdminCandidate } from '@/features/algorithm-coach/catalog/admin-service.server';
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
const draftUpdateSchema = z
  .object({
    draftProblem: z.record(z.string(), z.unknown()),
    expectedDraftRevision: z.number().int().min(1).max(1_000_000),
  })
  .strict();
const targetAssociationSchema = z
  .object({
    targetProblemSlug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
      .nullable(),
    expectedDraftRevision: z.number().int().min(1).max(1_000_000),
  })
  .strict();
const updateSchema = z.union([draftUpdateSchema, targetAssociationSchema]);

export async function GET(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    await authorizeCatalogAdmin(request, PERMISSIONS.CATALOG_READ);
    const { candidateId } = await context.params;
    if (!CANDIDATE_ID.test(candidateId)) {
      throw new CoachHttpError(
        400,
        'invalid_candidate_id',
        'Invalid candidate id.'
      );
    }
    const candidate = await getCatalogAdminCandidate(candidateId);
    if (!candidate) {
      throw new CoachHttpError(
        404,
        'candidate_not_found',
        'Catalog candidate not found.'
      );
    }
    return Response.json(
      { data: candidate },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof CoachHttpError) return errorResponse(error, traceId);
    console.error(`[catalog-admin:${traceId}] candidate detail failed`, error);
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    const identity = await authorizeCatalogAdmin(
      request,
      PERMISSIONS.CATALOG_REVIEW,
      { mutation: true, idempotent: true }
    );
    const { candidateId } = await context.params;
    if (!CANDIDATE_ID.test(candidateId)) {
      throw new CoachHttpError(
        400,
        'invalid_candidate_id',
        'Invalid candidate id.'
      );
    }
    const parsed = updateSchema.safeParse(await readJsonBody(request, 200_000));
    if (!parsed.success) {
      throw new CoachHttpError(
        400,
        'invalid_candidate_draft',
        'Catalog candidate draft validation failed.',
        parsed.error.flatten()
      );
    }
    const data = await executeCatalogCandidateAction({
      action:
        'targetProblemSlug' in parsed.data
          ? 'associate_target'
          : 'update_draft',
      candidateId,
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
    console.error(`[catalog-admin:${traceId}] candidate update failed`, error);
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
