import 'server-only';

import { getAuth } from '@/core/auth';
import { PERMISSIONS } from '@/core/rbac/permission';
import { envConfigs } from '@/config';
import { hasPermission } from '@/shared/services/rbac';

import { CoachHttpError } from '../http';

export type CatalogAdminPermission =
  | typeof PERMISSIONS.CATALOG_READ
  | typeof PERMISSIONS.CATALOG_REVIEW
  | typeof PERMISSIONS.CATALOG_PUBLISH
  | typeof PERMISSIONS.CATALOG_ROLLBACK;

export interface CatalogAdminIdentity {
  userId: string;
  idempotencyKey?: string;
}

function normalizedOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function assertSameOrigin(request: Request): void {
  const origin = normalizedOrigin(request.headers.get('origin') ?? undefined);
  if (!origin) {
    throw new CoachHttpError(
      403,
      'invalid_origin',
      'A same-origin request is required.'
    );
  }
  const allowed = new Set(
    [
      normalizedOrigin(request.url),
      normalizedOrigin(envConfigs.auth_url),
      normalizedOrigin(envConfigs.app_url),
    ].filter((value): value is string => Boolean(value))
  );
  if (!allowed.has(origin)) {
    throw new CoachHttpError(
      403,
      'invalid_origin',
      'The request origin is not allowed.'
    );
  }
}

function readIdempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(value)) {
    throw new CoachHttpError(
      400,
      'invalid_idempotency_key',
      'A valid Idempotency-Key header is required.'
    );
  }
  return value;
}

export async function authorizeCatalogAdmin(
  request: Request,
  permission: CatalogAdminPermission,
  options: { mutation?: boolean; idempotent?: boolean } = {}
): Promise<CatalogAdminIdentity> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) {
    throw new CoachHttpError(
      401,
      'unauthorized',
      'Authentication is required.'
    );
  }
  if (!(await hasPermission(userId, permission))) {
    throw new CoachHttpError(
      403,
      'forbidden',
      `Permission required: ${permission}`
    );
  }
  if (options.mutation) assertSameOrigin(request);
  return {
    userId,
    idempotencyKey: options.idempotent
      ? readIdempotencyKey(request)
      : undefined,
  };
}
