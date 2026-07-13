/**
 * This legacy endpoint intentionally stays as a 404 tombstone so probes do not
 * fall through to the dynamic page router. Authentication emails are sent only
 * from Better Auth server callbacks.
 */
export function POST() {
  return Response.json({ error: 'not_found' }, { status: 404 });
}
