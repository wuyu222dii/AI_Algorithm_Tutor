import { getAuth } from '@/core/auth';

export const dynamic = 'force-dynamic';

function verificationResponse(emailVerified = false) {
  return Response.json(
    {
      code: 0,
      message: 'ok',
      data: { emailVerified },
    },
    {
      headers: {
        'cache-control': 'private, no-store, max-age=0',
        pragma: 'no-cache',
      },
    }
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedEmail = String(body?.email || '')
      .trim()
      .toLowerCase();
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: req.headers });
    const sessionEmail = String(session?.user?.email || '')
      .trim()
      .toLowerCase();

    // Never reveal whether an arbitrary email exists. The status is only
    // returned for the currently authenticated account.
    return verificationResponse(
      Boolean(
        sessionEmail &&
          requestedEmail === sessionEmail &&
          session?.user?.emailVerified
      )
    );
  } catch {
    // Keep the response indistinguishable from an unauthenticated/pending user.
    return verificationResponse(false);
  }
}
