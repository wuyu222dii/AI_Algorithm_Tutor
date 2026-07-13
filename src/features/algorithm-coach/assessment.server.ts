import { createHmac, timingSafeEqual } from 'node:crypto';

import { getProblemBySlug, problems } from './data/problems';
import type { ProblemTopic } from './types';

export const ASSESSMENT_VERSION = '2026-07-v1';
export const ASSESSMENT_DURATION_MINUTES = 20;
const ASSESSMENT_GRACE_MINUTES = 5;

export interface SignedAssessmentSession {
  id: string;
  version: string;
  problemSlugs: string[];
  durationMinutes: number;
  startedAt: string;
  expiresAt: string;
  token: string;
}

export interface AssessmentRunClaim {
  problemSlug: string;
  passed: boolean;
  durationMs: number;
}

export interface VerifiedAssessmentResult {
  id: string;
  version: string;
  problemSlugs: string[];
  startedAt: string;
  completedAt: string;
  score: number;
  correctCount: number;
  totalCount: number;
  weakTopics: ProblemTopic[];
  recommendation: string;
  verificationToken: string;
}

type AssessmentTokenPayload = Omit<SignedAssessmentSession, 'token'>;

function signingSecret(): string {
  const configured =
    process.env.ASSESSMENT_SIGNING_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required to sign assessment sessions');
  }
  return 'algocoach-local-assessment-secret-change-in-production';
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signature(encodedPayload: string): string {
  return createHmac('sha256', signingSecret())
    .update(encodedPayload)
    .digest('base64url');
}

function sign(value: unknown): string {
  const payload = encode(value);
  return `${payload}.${signature(payload)}`;
}

function verify<T>(token: string): T {
  const [payload, suppliedSignature, ...rest] = token.split('.');
  if (!payload || !suppliedSignature || rest.length) {
    throw new Error('Assessment token is malformed');
  }
  const expected = Buffer.from(signature(payload), 'utf8');
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new Error('Assessment token signature is invalid');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
}

function stableNumber(seed: string): number {
  const digest = createHmac('sha256', signingSecret()).update(seed).digest();
  return digest.readUInt32BE(0);
}

export function selectAssessmentProblems(seed: string): string[] {
  const candidates = problems.map((problem) => problem.slug);
  if (candidates.length < 2) {
    throw new Error('At least two assessment problems are required');
  }
  const firstIndex = stableNumber(`${seed}:first`) % candidates.length;
  const first = candidates[firstIndex];
  const firstTopic = getProblemBySlug(first)?.topics[0];
  const alternatives = candidates.filter(
    (slug) => slug !== first && getProblemBySlug(slug)?.topics[0] !== firstTopic
  );
  const pool = alternatives.length
    ? alternatives
    : candidates.filter((item) => item !== first);
  const second = pool[stableNumber(`${seed}:second`) % pool.length];
  return [first, second];
}

export function createSignedAssessmentSession(options: {
  id: string;
  now?: Date;
}): SignedAssessmentSession {
  const now = options.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() +
      (ASSESSMENT_DURATION_MINUTES + ASSESSMENT_GRACE_MINUTES) * 60_000
  );
  const payload: AssessmentTokenPayload = {
    id: options.id,
    version: ASSESSMENT_VERSION,
    problemSlugs: selectAssessmentProblems(options.id),
    durationMinutes: ASSESSMENT_DURATION_MINUTES,
    startedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  return { ...payload, token: sign(payload) };
}

export function verifyAssessmentSession(
  token: string,
  now = new Date()
): AssessmentTokenPayload {
  const payload = verify<AssessmentTokenPayload>(token);
  if (payload.version !== ASSESSMENT_VERSION) {
    throw new Error('Assessment version is no longer supported');
  }
  if (
    !Array.isArray(payload.problemSlugs) ||
    payload.problemSlugs.length !== 2 ||
    payload.problemSlugs.some((slug) => !getProblemBySlug(slug))
  ) {
    throw new Error('Assessment problem set is invalid');
  }
  const startedAt = Date.parse(payload.startedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
    throw new Error('Assessment timestamps are invalid');
  }
  if (startedAt > now.getTime() + 60_000) {
    throw new Error('Assessment start time is invalid');
  }
  if (now.getTime() > expiresAt) throw new Error('Assessment has expired');
  return payload;
}

export function completeSignedAssessment(options: {
  token: string;
  runs: AssessmentRunClaim[];
  now?: Date;
}): VerifiedAssessmentResult {
  const now = options.now ?? new Date();
  const session = verifyAssessmentSession(options.token, now);
  const runBySlug = new Map(options.runs.map((run) => [run.problemSlug, run]));
  if (
    runBySlug.size !== session.problemSlugs.length ||
    session.problemSlugs.some((slug) => !runBySlug.has(slug))
  ) {
    throw new Error('Assessment result does not match the signed problem set');
  }
  const correctCount = session.problemSlugs.filter(
    (slug) => runBySlug.get(slug)?.passed
  ).length;
  const weakTopics = Array.from(
    new Set(
      session.problemSlugs
        .filter((slug) => !runBySlug.get(slug)?.passed)
        .flatMap((slug) => getProblemBySlug(slug)?.topics ?? [])
        .filter((topic): topic is ProblemTopic =>
          [
            'array-hash',
            'two-pointers',
            'stack',
            'binary-search',
            'linked-list',
            'dynamic-programming',
            'bfs',
            'dfs',
          ].includes(topic)
        )
    )
  );
  const unsigned = {
    id: session.id,
    version: session.version,
    problemSlugs: session.problemSlugs,
    startedAt: session.startedAt,
    completedAt: now.toISOString(),
    score: Math.round((correctCount / session.problemSlugs.length) * 100),
    correctCount,
    totalCount: session.problemSlugs.length,
    weakTopics,
    recommendation:
      correctCount === session.problemSlugs.length
        ? 'Raise the difficulty and keep a tighter per-problem time limit.'
        : 'Review the failed patterns, then solve two related problems.',
  };
  return { ...unsigned, verificationToken: sign(unsigned) };
}
