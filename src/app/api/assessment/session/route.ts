import {
  completeSignedAssessment,
  createSignedAssessmentSession,
  readSignedAssessmentSession,
} from '@/features/algorithm-coach/assessment.server';
import {
  getRuntimeProblem,
  listRuntimeProblems,
} from '@/features/algorithm-coach/catalog-runtime.server';
import { z } from 'zod';

import { enforceDistributedWindowRateLimit } from '@/shared/lib/rate-limit';

export const dynamic = 'force-dynamic';

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({
    action: z.literal('complete'),
    token: z.string().min(32).max(4096),
    runs: z
      .array(
        z.object({
          problemSlug: z.string().min(1).max(120),
          passed: z.boolean(),
          durationMs: z.number().finite().min(0).max(180_000),
        })
      )
      .length(2),
  }),
]);

export async function POST(request: Request) {
  const limited = await enforceDistributedWindowRateLimit(request, {
    windowMs: 60_000,
    max: 12,
    keyPrefix: 'assessment-session',
    identity: 'source-and-extra',
    extraKey: request.headers.get('cookie') ?? 'guest',
    failClosed: process.env.NODE_ENV === 'production',
  });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  try {
    let data;
    if (parsed.data.action === 'start') {
      const problems = await listRuntimeProblems();
      data = createSignedAssessmentSession({
        id: `assessment_${crypto.randomUUID()}`,
        problems,
      });
    } else {
      const session = readSignedAssessmentSession(parsed.data.token);
      const historicalProblems = await Promise.all(
        session.problemVersions.map((reference) =>
          getRuntimeProblem(reference.slug, reference.contentVersion)
        )
      );
      if (historicalProblems.some((problem) => !problem)) {
        throw new Error('Assessment problem version is unavailable');
      }
      data = completeSignedAssessment({
        token: parsed.data.token,
        runs: parsed.data.runs,
        problems: historicalProblems.filter(
          (problem): problem is NonNullable<typeof problem> => Boolean(problem)
        ),
      });
    }
    return Response.json(
      { data },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } }
    );
  } catch (error) {
    return Response.json(
      {
        error: 'assessment_rejected',
        message: error instanceof Error ? error.message : 'Assessment failed',
      },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
}
