const MAX_SERVER_OFFSET_MS = 24 * 60 * 60 * 1000;

export function calculateServerOffsetMs(
  serverNow: string,
  requestStartedAtMs: number,
  responseReceivedAtMs: number
): number {
  const serverNowMs = Date.parse(serverNow);
  if (
    !Number.isFinite(serverNowMs) ||
    !Number.isFinite(requestStartedAtMs) ||
    !Number.isFinite(responseReceivedAtMs) ||
    responseReceivedAtMs < requestStartedAtMs
  ) {
    throw new Error('Assessment server clock is invalid');
  }
  // serverNow is captured immediately before the response is serialized, so
  // the receive timestamp avoids treating server processing time as clock skew.
  const offsetMs = Math.round(serverNowMs - responseReceivedAtMs);
  if (Math.abs(offsetMs) > MAX_SERVER_OFFSET_MS) {
    throw new Error('Assessment server clock offset is out of range');
  }
  return offsetMs;
}

export function assessmentNowMs(
  serverOffsetMs: number,
  localNowMs = Date.now()
) {
  return localNowMs + serverOffsetMs;
}

export function assessmentSecondsUntil(
  expiresAt: string | number,
  serverOffsetMs: number,
  localNowMs = Date.now()
): number {
  const expiresAtMs =
    typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return 0;
  return Math.max(
    0,
    Math.ceil(
      (expiresAtMs - assessmentNowMs(serverOffsetMs, localNowMs)) / 1000
    )
  );
}
