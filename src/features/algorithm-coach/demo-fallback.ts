import { getProblemBySlug } from './data/problems';
import { CoachRequest } from './types';

export function canUseCoachDemoFallback(request: CoachRequest): boolean {
  if (process.env.COACH_DEMO_FALLBACK_ENABLED !== 'true') return false;
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production'
  ) {
    return false;
  }
  const problemSlug = request.problemSlug ?? request.problem?.slug;
  return (
    request.action !== 'parse' &&
    Boolean(problemSlug && getProblemBySlug(problemSlug))
  );
}
