function notFound() {
  return Response.json(
    { error: { code: 'not_found', message: 'Endpoint not found.' } },
    { status: 404, headers: { 'cache-control': 'no-store' } }
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
