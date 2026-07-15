import {
  CatalogAdminActionError,
  executeCatalogCandidateAction,
} from '@/features/algorithm-coach/catalog/admin-actions.server';
import { authorizeCatalogAdmin } from '@/features/algorithm-coach/catalog/admin-auth.server';
import { catalogReviewDraftUpdateV2Schema } from '@/features/algorithm-coach/catalog/admin-contracts';
import { recordCatalogAdminFailure } from '@/features/algorithm-coach/catalog/admin-observability.server';
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
function fieldIssueDetails(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

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
    await recordCatalogAdminFailure('candidate_detail', traceId, error);
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
    const requestBody = await readJsonBody(request, 200_000);
    const parsed =
      requestBody !== null &&
      typeof requestBody === 'object' &&
      !Array.isArray(requestBody) &&
      Object.hasOwn(requestBody, 'targetProblemSlug')
        ? targetAssociationSchema.safeParse(requestBody)
        : catalogReviewDraftUpdateV2Schema.safeParse(requestBody);
    if (!parsed.success) {
      throw new CoachHttpError(
        422,
        'invalid_candidate_draft',
        'Catalog candidate draft validation failed.',
        fieldIssueDetails(parsed.error)
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
    await recordCatalogAdminFailure('candidate_update', traceId, error);
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
