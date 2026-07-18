import { createHmac, timingSafeEqual } from 'node:crypto';

import { problemSupportsLanguage } from './languages';
import type {
  AssessmentKind,
  CodeRunStatus,
  DiagnosisCategory,
  Language,
  LearningGoal,
  Problem,
  ProblemTopic,
  ProblemVersionRef,
} from './types';

export const ASSESSMENT_VERSION = '2026-07-v4';
export const ASSESSMENT_DURATION_MINUTES = 20;
export const BASELINE_DURATION_MINUTES = 8;
export const ASSESSMENT_GRACE_MINUTES = 5;

const GOAL_TOPICS: Record<LearningGoal, ProblemTopic[]> = {
  foundation: ['array-hash', 'two-pointers', 'stack', 'linked-list'],
  interview: [
    'array-hash',
    'two-pointers',
    'binary-search',
    'linked-list',
    'dynamic-programming',
  ],
  contest: ['dynamic-programming', 'bfs', 'dfs', 'binary-search'],
};

export interface SignedAssessmentSession {
  id: string;
  kind: AssessmentKind;
  baselineAssessmentId?: string;
  version: string;
  problemSlugs: string[];
  problemVersions: ProblemVersionRef[];
  durationMinutes: number;
  startedAt: string;
  expiresAt: string;
  graceExpiresAt: string;
  token: string;
}

export interface AssessmentRunClaim {
  problemSlug: string;
  passed: boolean;
  durationMs: number;
  status?: CodeRunStatus;
  errorCategory?: DiagnosisCategory;
}

export interface VerifiedAssessmentResult {
  id: string;
  kind: AssessmentKind;
  baselineAssessmentId?: string;
  version: string;
  problemSlugs: string[];
  problemVersions: ProblemVersionRef[];
  startedAt: string;
  completedAt: string;
  score: number;
  correctCount: number;
  totalCount: number;
  weakTopics: ProblemTopic[];
  recommendation: string;
  averageDurationMs: number;
  hintCount: number;
  errorCategories: DiagnosisCategory[];
  evidenceMode: 'browser_local';
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

export function selectAssessmentProblems(
  seed: string,
  problems: readonly Problem[],
  options: {
    kind?: AssessmentKind;
    preferredLanguage?: Language;
    goal?: LearningGoal;
    baselineProblemVersions?: ProblemVersionRef[];
  } = {}
): ProblemVersionRef[] {
  const kind = options.kind ?? 'practice';
  const preferredTopics = GOAL_TOPICS[options.goal ?? 'foundation'];
  const baselineProblems = (options.baselineProblemVersions ?? [])
    .map((reference) =>
      problems.find((problem) => problem.slug === reference.slug)
    )
    .filter((problem): problem is Problem => Boolean(problem));
  const baselineTopics = new Set(
    baselineProblems.flatMap((problem) => problem.topics)
  );
  const baselineDifficulties = new Set(
    baselineProblems.map((problem) => problem.difficulty)
  );
  let eligible = problems.filter(
    (problem) =>
      (!options.preferredLanguage ||
        problemSupportsLanguage(problem, options.preferredLanguage)) &&
      (kind === 'practice' || problem.difficulty !== 'hard')
  );
  if (kind === 'checkpoint' && baselineProblems.length) {
    const comparable = eligible.filter(
      (problem) =>
        !(options.baselineProblemVersions ?? []).some(
          (reference) => reference.slug === problem.slug
        ) &&
        baselineDifficulties.has(problem.difficulty) &&
        problem.topics.some((topic) => baselineTopics.has(topic))
    );
    if (comparable.length >= 2) eligible = comparable;
  } else if (kind === 'baseline') {
    const goalMatched = eligible.filter((problem) =>
      problem.topics.some((topic) =>
        preferredTopics.includes(topic as ProblemTopic)
      )
    );
    if (goalMatched.length >= 2) eligible = goalMatched;
  }
  const candidates = eligible.map((problem) => problem.slug);
  if (candidates.length < 2) {
    throw new Error('At least two assessment problems are required');
  }
  const firstIndex = stableNumber(`${seed}:first`) % candidates.length;
  const first = candidates[firstIndex];
  const firstTopic = problems.find((problem) => problem.slug === first)
    ?.topics[0];
  const alternatives = candidates.filter(
    (slug) =>
      slug !== first &&
      problems.find((problem) => problem.slug === slug)?.topics[0] !==
        firstTopic
  );
  const pool = alternatives.length
    ? alternatives
    : candidates.filter((item) => item !== first);
  const second = pool[stableNumber(`${seed}:second`) % pool.length];
  return [first, second].map((slug) => ({
    slug,
    contentVersion:
      problems.find((problem) => problem.slug === slug)?.version
        ?.contentVersion ?? 1,
  }));
}

export function createSignedAssessmentSession(options: {
  id: string;
  problems: readonly Problem[];
  kind?: AssessmentKind;
  preferredLanguage?: Language;
  goal?: LearningGoal;
  baselineAssessmentId?: string;
  baselineProblemVersions?: ProblemVersionRef[];
  now?: Date;
}): SignedAssessmentSession {
  const now = options.now ?? new Date();
  const kind = options.kind ?? 'practice';
  const durationMinutes =
    kind === 'practice'
      ? ASSESSMENT_DURATION_MINUTES
      : BASELINE_DURATION_MINUTES;
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  const graceExpiresAt = new Date(
    expiresAt.getTime() + ASSESSMENT_GRACE_MINUTES * 60_000
  );
  const problemVersions = selectAssessmentProblems(
    options.id,
    options.problems,
    {
      kind,
      preferredLanguage: options.preferredLanguage,
      goal: options.goal,
      baselineProblemVersions: options.baselineProblemVersions,
    }
  );
  const payload: AssessmentTokenPayload = {
    id: options.id,
    kind,
    baselineAssessmentId: options.baselineAssessmentId,
    version: ASSESSMENT_VERSION,
    problemSlugs: problemVersions.map((problem) => problem.slug),
    problemVersions,
    durationMinutes,
    startedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceExpiresAt: graceExpiresAt.toISOString(),
  };
  return { ...payload, token: sign(payload) };
}

export function verifyAssessmentSession(
  token: string,
  problems: readonly Problem[],
  now = new Date()
): AssessmentTokenPayload {
  const payload = readSignedAssessmentSession(token, now);
  if (
    !['baseline', 'checkpoint', 'practice'].includes(payload.kind) ||
    payload.problemVersions.some((reference) => {
      const problem = problems.find((item) => item.slug === reference.slug);
      return (
        !problem ||
        (problem.version?.contentVersion ?? 1) !== reference.contentVersion
      );
    })
  ) {
    throw new Error('Assessment problem set is invalid');
  }
  return payload;
}

function parseSignedAssessmentSession(
  token: string,
  now: Date,
  enforceExpiry: boolean
): AssessmentTokenPayload {
  const payload = verify<AssessmentTokenPayload>(token);
  if (payload.version !== ASSESSMENT_VERSION) {
    throw new Error('Assessment version is no longer supported');
  }
  if (
    !Array.isArray(payload.problemSlugs) ||
    payload.problemSlugs.length !== 2 ||
    !Array.isArray(payload.problemVersions) ||
    payload.problemVersions.length !== 2 ||
    payload.problemVersions.some(
      (reference) =>
        !reference ||
        typeof reference.slug !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reference.slug) ||
        !Number.isInteger(reference.contentVersion) ||
        reference.contentVersion < 1
    ) ||
    payload.problemVersions.some(
      (reference, index) => payload.problemSlugs[index] !== reference.slug
    ) ||
    new Set(payload.problemSlugs).size !== payload.problemSlugs.length
  ) {
    throw new Error('Assessment problem set is invalid');
  }
  const startedAt = Date.parse(payload.startedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  const graceExpiresAt = Date.parse(payload.graceExpiresAt);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(graceExpiresAt) ||
    expiresAt <= startedAt ||
    graceExpiresAt <= expiresAt
  ) {
    throw new Error('Assessment timestamps are invalid');
  }
  if (startedAt > now.getTime() + 60_000) {
    throw new Error('Assessment start time is invalid');
  }
  if (enforceExpiry && now.getTime() > graceExpiresAt) {
    throw new Error('Assessment has expired');
  }
  return payload;
}

export function readSignedAssessmentSession(
  token: string,
  now = new Date()
): AssessmentTokenPayload {
  return parseSignedAssessmentSession(token, now, true);
}

export function inspectSignedAssessmentSession(
  token: string,
  now = new Date()
): AssessmentTokenPayload {
  return parseSignedAssessmentSession(token, now, false);
}

export function completeSignedAssessment(options: {
  token: string;
  runs: AssessmentRunClaim[];
  problems: readonly Problem[];
  now?: Date;
}): VerifiedAssessmentResult {
  const now = options.now ?? new Date();
  const session = verifyAssessmentSession(options.token, options.problems, now);
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
  const errorCategories = Array.from(
    new Set(
      session.problemSlugs
        .map((slug): DiagnosisCategory | undefined => {
          const run = runBySlug.get(slug);
          if (!run || run.passed) return undefined;
          if (run.errorCategory) return run.errorCategory;
          if (run.status === 'syntax_error') return 'syntax';
          if (run.status === 'runtime_error') return 'runtime';
          if (run.status === 'timeout') return 'timeout';
          return 'wrong-answer';
        })
        .filter((category): category is DiagnosisCategory => Boolean(category))
    )
  );
  const weakTopics = Array.from(
    new Set(
      session.problemSlugs
        .filter((slug) => !runBySlug.get(slug)?.passed)
        .flatMap(
          (slug) =>
            options.problems.find((problem) => problem.slug === slug)?.topics ??
            []
        )
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
    kind: session.kind,
    baselineAssessmentId: session.baselineAssessmentId,
    version: session.version,
    problemSlugs: session.problemSlugs,
    problemVersions: session.problemVersions,
    startedAt: session.startedAt,
    completedAt: now.toISOString(),
    score: Math.round((correctCount / session.problemSlugs.length) * 100),
    correctCount,
    totalCount: session.problemSlugs.length,
    weakTopics,
    averageDurationMs: Math.round(
      session.problemSlugs.reduce(
        (total, slug) => total + (runBySlug.get(slug)?.durationMs ?? 0),
        0
      ) / session.problemSlugs.length
    ),
    hintCount: 0,
    errorCategories,
    evidenceMode: 'browser_local' as const,
    recommendation:
      correctCount === session.problemSlugs.length
        ? 'Raise the difficulty and keep a tighter per-problem time limit.'
        : 'Review the failed patterns, then solve two related problems.',
  };
  return { ...unsigned, verificationToken: sign(unsigned) };
}
