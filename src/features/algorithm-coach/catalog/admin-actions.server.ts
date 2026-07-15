import 'server-only';

import { catalogAdminDatabase } from './admin-db.server';
import { CatalogDatabaseStore } from './catalog-store.server';
import { sha256, stableStringify } from './content-hash';

type CandidateAction =
  | 'update_draft'
  | 'associate_target'
  | 'validate'
  | 'approve'
  | 'reject'
  | 'publish';

interface ExecuteCandidateActionOptions {
  action: CandidateAction;
  candidateId: string;
  actorUserId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

function requestHash(value: unknown): string {
  return sha256(stableStringify(value as never));
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const missingCatalogTarget =
    message.includes('catalog candidate') ||
    message.includes('catalog candidates') ||
    message.includes('rollback revision') ||
    message.includes('versioned catalog problem');
  if (
    missingCatalogTarget &&
    (message.includes('not found') ||
      message.includes('does not exist') ||
      message.includes('do not exist'))
  ) {
    return 'candidate_not_found';
  }
  if (message.includes('stale')) return 'revision_conflict';
  if (message.includes('different request')) return 'idempotency_conflict';
  if (message.includes('different users')) return 'publisher_conflict';
  if (
    message.includes('must be') ||
    message.includes('cannot') ||
    message.includes('only ') ||
    message.includes('already active')
  ) {
    return 'invalid_candidate_state';
  }
  return 'catalog_mutation_failed';
}

function errorStatus(code: string): number {
  if (code === 'candidate_not_found' || code === 'rollback_target_not_found') {
    return 404;
  }
  if (code === 'catalog_mutation_failed') return 503;
  return 409;
}

function publicErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    candidate_not_found: 'Catalog candidate not found.',
    rollback_target_not_found:
      'The catalog problem or requested revision was not found.',
    revision_conflict:
      'The candidate changed after it was loaded. Refresh and try again.',
    idempotency_conflict:
      'The idempotency key was already used for a different request.',
    publisher_conflict: 'The approver and publisher must be different users.',
    invalid_candidate_state:
      'The candidate is not in a valid state for this action.',
    mutation_in_progress: 'The catalog mutation is already in progress.',
    previous_mutation_failed: 'The previous catalog mutation failed.',
    catalog_mutation_failed:
      'The catalog mutation could not be completed. Try again later.',
  };
  return messages[code] ?? messages.catalog_mutation_failed;
}

export class CatalogAdminActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409
  ) {
    super(message);
    this.name = 'CatalogAdminActionError';
  }
}

export async function executeCatalogCandidateAction(
  options: ExecuteCandidateActionOptions
): Promise<Record<string, unknown>> {
  const store = new CatalogDatabaseStore(
    catalogAdminDatabase() as ConstructorParameters<
      typeof CatalogDatabaseStore
    >[0]
  );
  const hash = requestHash({
    action: options.action,
    candidateId: options.candidateId,
    payload: options.payload,
  });
  let claim;
  try {
    claim = await store.claimAdminMutation({
      actorUserId: options.actorUserId,
      idempotencyKey: options.idempotencyKey,
      action:
        options.action === 'associate_target' ? 'update_draft' : options.action,
      targetType: 'candidate',
      targetId: options.candidateId,
      requestHash: hash,
    });
  } catch (error) {
    const code = errorCode(error);
    throw new CatalogAdminActionError(
      code,
      publicErrorMessage(code),
      errorStatus(code)
    );
  }

  if (!claim.claimed) {
    if (claim.mutation.status === 'completed') {
      return claim.mutation.result as Record<string, unknown>;
    }
    const code =
      claim.mutation.status === 'claimed'
        ? 'mutation_in_progress'
        : claim.mutation.errorCode || 'previous_mutation_failed';
    throw new CatalogAdminActionError(
      code,
      publicErrorMessage(code),
      errorStatus(code)
    );
  }

  try {
    let result: Record<string, unknown>;
    if (options.action === 'update_draft') {
      const updated = await store.updateCandidateDraft(
        options.candidateId,
        options.payload.draftProblem,
        options.actorUserId,
        Number(options.payload.expectedDraftRevision)
      );
      result = {
        candidateId: updated.id,
        status: updated.status,
        draftRevision: updated.draftRevision,
      };
    } else if (options.action === 'associate_target') {
      const updated = await store.associateCandidateTarget(
        options.candidateId,
        options.payload.targetProblemSlug === null
          ? null
          : String(options.payload.targetProblemSlug),
        options.actorUserId,
        Number(options.payload.expectedDraftRevision)
      );
      result = {
        candidateId: updated.id,
        status: updated.status,
        draftRevision: updated.draftRevision,
        targetProblemId: updated.targetProblemId,
      };
    } else if (options.action === 'validate') {
      result = {
        ...(await store.validateCandidates([options.candidateId], 'reviewer')),
      };
    } else if (options.action === 'approve') {
      result = {
        ...(await store.approveCandidates(
          [options.candidateId],
          options.actorUserId,
          String(options.payload.notes ?? '')
        )),
      };
    } else if (options.action === 'reject') {
      const rejected = await store.rejectCandidate(
        options.candidateId,
        options.actorUserId,
        String(options.payload.notes ?? '')
      );
      result = { candidateId: rejected.id, status: rejected.status };
    } else {
      result = {
        ...(await store.publishCandidates(
          [options.candidateId],
          options.actorUserId,
          String(options.payload.notes ?? '')
        )),
      };
    }
    await store.completeAdminMutation(claim.mutation.id, options.actorUserId, {
      status: 'completed',
      result,
    });
    return result;
  } catch (error) {
    const code = errorCode(error);
    await store
      .completeAdminMutation(claim.mutation.id, options.actorUserId, {
        status: 'failed',
        errorCode: code,
      })
      .catch(() => undefined);
    throw new CatalogAdminActionError(
      code,
      publicErrorMessage(code),
      errorStatus(code)
    );
  }
}

export async function executeCatalogRollback(options: {
  problemSlug: string;
  targetVersion: number;
  notes: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const store = new CatalogDatabaseStore(
    catalogAdminDatabase() as ConstructorParameters<
      typeof CatalogDatabaseStore
    >[0]
  );
  const hash = requestHash({
    action: 'rollback',
    problemSlug: options.problemSlug,
    targetVersion: options.targetVersion,
    notes: options.notes,
  });
  let claim;
  try {
    claim = await store.claimAdminMutation({
      actorUserId: options.actorUserId,
      idempotencyKey: options.idempotencyKey,
      action: 'rollback',
      targetType: 'problem',
      targetId: options.problemSlug,
      requestHash: hash,
    });
  } catch (error) {
    const code = errorCode(error);
    throw new CatalogAdminActionError(
      code,
      publicErrorMessage(code),
      errorStatus(code)
    );
  }

  if (!claim.claimed) {
    if (claim.mutation.status === 'completed') {
      return claim.mutation.result as Record<string, unknown>;
    }
    const code =
      claim.mutation.status === 'claimed'
        ? 'mutation_in_progress'
        : claim.mutation.errorCode || 'previous_mutation_failed';
    throw new CatalogAdminActionError(
      code,
      publicErrorMessage(code),
      errorStatus(code)
    );
  }

  try {
    const result = await store.rollbackProblem(
      options.problemSlug,
      options.targetVersion,
      options.actorUserId,
      options.notes
    );
    await store.completeAdminMutation(claim.mutation.id, options.actorUserId, {
      status: 'completed',
      result,
    });
    return result;
  } catch (error) {
    const mapped = errorCode(error);
    const code =
      mapped === 'candidate_not_found' ? 'rollback_target_not_found' : mapped;
    await store
      .completeAdminMutation(claim.mutation.id, options.actorUserId, {
        status: 'failed',
        errorCode: code,
      })
      .catch(() => undefined);
    throw new CatalogAdminActionError(
      code,
      publicErrorMessage(code),
      errorStatus(code)
    );
  }
}
