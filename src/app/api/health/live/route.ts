import { liveHealthStatus } from '@/core/db/readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json(liveHealthStatus(), {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
