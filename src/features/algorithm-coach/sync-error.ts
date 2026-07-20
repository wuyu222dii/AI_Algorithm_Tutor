export type CoachSyncErrorKind = 'conflict' | 'network' | 'auth' | 'server';

export class CoachSyncFailure extends Error {
  constructor(
    public readonly kind: CoachSyncErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'CoachSyncFailure';
  }
}

export function coachSyncFailureForResponse(
  response: Response
): CoachSyncFailure {
  const kind: CoachSyncErrorKind =
    response.status === 401 || response.status === 403
      ? 'auth'
      : response.status === 409
        ? 'conflict'
        : 'server';
  return new CoachSyncFailure(kind, `Sync failed with ${response.status}`);
}

export function classifyCoachSyncFailure(
  error: unknown,
  online = typeof navigator === 'undefined' ? true : navigator.onLine
): CoachSyncErrorKind {
  if (error instanceof CoachSyncFailure) return error.kind;
  if (!online || error instanceof TypeError) return 'network';
  if (
    error instanceof DOMException &&
    ['NetworkError', 'TimeoutError'].includes(error.name)
  ) {
    return 'network';
  }
  return 'server';
}
