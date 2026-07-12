import 'server-only';

export class CoachHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CoachHttpError';
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes = 80_000
): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new CoachHttpError(
      413,
      'payload_too_large',
      `Request body must not exceed ${maxBytes} bytes.`
    );
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new CoachHttpError(
      413,
      'payload_too_large',
      `Request body must not exceed ${maxBytes} bytes.`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CoachHttpError(
      400,
      'invalid_json',
      'Request body is not valid JSON.'
    );
  }
}

export function errorResponse(
  error: CoachHttpError,
  traceId: string
): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        traceId,
      },
    },
    {
      status: error.status,
      headers: {
        'cache-control': 'no-store',
        'x-coach-trace-id': traceId,
      },
    }
  );
}
