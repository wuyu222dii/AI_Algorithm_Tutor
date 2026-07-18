import {
  completeSignedAssessment,
  createSignedAssessmentSession,
  inspectSignedAssessmentSession,
  readSignedAssessmentSession,
} from '@/features/algorithm-coach/assessment.server';
import {
  getRuntimeProblem,
  listRuntimeProblems,
  runtimeEnabledLanguages,
} from '@/features/algorithm-coach/catalog-runtime.server';
import { toAssessmentProblemDetail } from '@/features/algorithm-coach/problem-contracts';
import { z } from 'zod';

import { enforceDistributedWindowRateLimit } from '@/shared/lib/rate-limit';

export const dynamic = 'force-dynamic';

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    kind: z.enum(['baseline', 'checkpoint', 'practice']).default('practice'),
    preferredLanguage: z
      .enum(['javascript', 'typescript', 'python'])
      .optional(),
    goal: z.enum(['foundation', 'interview', 'contest']).optional(),
    baselineAssessmentId: z.string().max(160).optional(),
    baselineProblemVersions: z
      .array(
        z.object({
          slug: z.string().min(1).max(120),
          contentVersion: z.number().int().min(1).max(1_000_000),
        })
      )
      .length(2)
      .optional(),
  }),
  z.object({
    action: z.literal('resume'),
    token: z.string().min(32).max(4096),
  }),
  z.object({
    action: z.literal('abandon'),
    token: z.string().min(32).max(4096),
  }),
  z.object({
    action: z.literal('complete'),
    token: z.string().min(32).max(4096),
    runs: z
      .array(
        z.object({
          problemSlug: z.string().min(1).max(120),
          passed: z.boolean(),
          durationMs: z.number().finite().min(0).max(180_000),
          status: z
            .enum([
              'passed',
              'failed',
              'syntax_error',
              'runtime_error',
              'timeout',
            ])
            .optional(),
          errorCategory: z
            .enum([
              'syntax',
              'runtime',
              'timeout',
              'wrong-answer',
              'edge-case',
              'unknown',
            ])
            .optional(),
        })
      )
      .length(2),
  }),
]);

function assessmentErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Assessment failed';
  if (message === 'Assessment has expired') {
    return Response.json(
      { error: 'assessment_expired', message },
      { status: 410, headers: { 'cache-control': 'no-store' } }
    );
  }
  if (message === 'Assessment problem version is unavailable') {
    return Response.json(
      {
        error: 'assessment_catalog_unavailable',
        message: 'The pinned assessment revision is temporarily unavailable.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
  if (
    /Assessment (token|version|problem set|timestamps|start time|result)/.test(
      message
    )
  ) {
    return Response.json(
      { error: 'assessment_rejected', message },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
  return Response.json(
    {
      error: 'assessment_unavailable',
      message: 'The assessment service is temporarily unavailable.',
    },
    { status: 503, headers: { 'cache-control': 'no-store' } }
  );
}

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
      const session = createSignedAssessmentSession({
        id: `${parsed.data.kind}_${crypto.randomUUID()}`,
        problems,
        kind: parsed.data.kind,
        preferredLanguage: parsed.data.preferredLanguage,
        goal: parsed.data.goal,
        baselineAssessmentId: parsed.data.baselineAssessmentId,
        baselineProblemVersions: parsed.data.baselineProblemVersions,
      });
      const selectedProblems = session.problemVersions.map((reference) =>
        problems.find(
          (problem) =>
            problem.slug === reference.slug &&
            (problem.version?.contentVersion ?? 1) === reference.contentVersion
        )
      );
      if (selectedProblems.some((problem) => !problem)) {
        throw new Error('Assessment problem version is unavailable');
      }
      data = {
        ...session,
        problems: selectedProblems
          .filter((problem): problem is NonNullable<typeof problem> =>
            Boolean(problem)
          )
          .map((problem) =>
            toAssessmentProblemDetail(problem, runtimeEnabledLanguages())
          ),
        serverNow: new Date().toISOString(),
      };
    } else if (parsed.data.action === 'complete') {
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
    } else if (parsed.data.action === 'resume') {
      const session = readSignedAssessmentSession(parsed.data.token);
      const historicalProblems = await Promise.all(
        session.problemVersions.map((reference) =>
          getRuntimeProblem(reference.slug, reference.contentVersion)
        )
      );
      if (historicalProblems.some((problem) => !problem)) {
        throw new Error('Assessment problem version is unavailable');
      }
      data = {
        ...session,
        problems: historicalProblems
          .filter((problem): problem is NonNullable<typeof problem> =>
            Boolean(problem)
          )
          .map((problem) =>
            toAssessmentProblemDetail(problem, runtimeEnabledLanguages())
          ),
        status:
          Date.now() >= Date.parse(session.expiresAt) ? 'grace' : 'active',
        serverNow: new Date().toISOString(),
      };
    } else {
      const session = inspectSignedAssessmentSession(parsed.data.token);
      data = {
        id: session.id,
        status: 'abandoned',
        abandonedAt: new Date().toISOString(),
      };
    }
    return Response.json(
      { data },
      { headers: { 'cache-control': 'private, no-store, max-age=0' } }
    );
  } catch (error) {
    return assessmentErrorResponse(error);
  }
}
