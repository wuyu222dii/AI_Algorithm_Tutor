/* eslint-disable @typescript-eslint/no-explicit-any -- This boundary reads legacy versions of browser-persisted state. */
import { isPracticeSessionCompleted } from '../learning-progress';
import type {
  CodeRunResult,
  Language,
  LearningArtifact,
  Problem,
  TestCaseResult,
} from '../types';

export type CoachStateLike = Record<string, any>;

export function localeKey(locale: string): 'zh' | 'en' {
  return locale === 'zh' ? 'zh' : 'en';
}

export function localized(
  value: unknown,
  locale: 'zh' | 'en',
  fallback = ''
): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const current = record[locale] ?? record.en ?? record.zh;
    if (typeof current === 'string') return current;
  }
  return fallback;
}

export function localizedProblem(problem: Problem, locale: 'zh' | 'en') {
  return {
    ...problem,
    titleText: localized(problem.title, locale, problem.slug),
    descriptionText: localized(problem.description, locale),
    constraintsText: Array.isArray(problem.constraints)
      ? problem.constraints.map((item) => localized(item, locale))
      : [localized(problem.constraints, locale)].filter(Boolean),
  };
}

export function getProfile(state: CoachStateLike | undefined) {
  return state?.profile ?? state?.learningProfile ?? null;
}

export function isOnboarded(state: CoachStateLike | undefined) {
  const profile = getProfile(state);
  return Boolean(
    state?.onboardingCompleted ??
      profile?.onboardingCompleted ??
      profile?.completedOnboarding ??
      profile?.goal
  );
}

export function getPreferredLanguage(
  state: CoachStateLike | undefined
): Language {
  const value =
    getProfile(state)?.preferredLanguage ?? state?.preferredLanguage;
  return value === 'python' ? 'python' : 'javascript';
}

export function getSavedCode(
  state: CoachStateLike | undefined,
  problemId: string,
  language: Language
) {
  return (
    state?.sessions?.[problemId]?.code?.[language] ??
    state?.code?.[problemId]?.[language] ??
    state?.codeByProblem?.[problemId]?.[language] ??
    state?.drafts?.[problemId]?.[language] ??
    ''
  );
}

export function getRuns(state: CoachStateLike | undefined): CodeRunResult[] {
  const runs = state?.runs ?? state?.runHistory ?? state?.practiceRuns ?? [];
  if (Array.isArray(runs) && runs.length) return runs;
  const sessions = Object.values(state?.sessions ?? {}) as Array<
    Record<string, any>
  >;
  return sessions.flatMap((session) =>
    Array.isArray(session.runs) ? session.runs : []
  );
}

export function getArtifacts(
  state: CoachStateLike | undefined
): LearningArtifact[] {
  const artifacts = state?.artifacts ?? state?.learningArtifacts ?? [];
  return Array.isArray(artifacts) ? artifacts : [];
}

export function getCompletedProblemIds(state: CoachStateLike | undefined) {
  const direct = state?.completedProblemIds ?? state?.completedProblems;
  if (Array.isArray(direct)) {
    return new Set(
      direct.map(String).filter((problemId) => {
        const session = state?.sessions?.[problemId];
        return session ? isPracticeSessionCompleted(session) : true;
      })
    );
  }

  const completedSessions = Object.values(state?.sessions ?? {})
    .filter((session: any) => {
      return isPracticeSessionCompleted(session);
    })
    .map((session: any) => String(session.problemSlug ?? ''))
    .filter(Boolean);

  return new Set([
    ...completedSessions,
    ...getRuns(state)
      .filter((run) => runPassed(run) && run.testScope !== 'sample')
      .map((run: any) =>
        String(run.problemId ?? run.problemSlug ?? run.problem?.id ?? '')
      )
      .filter(Boolean),
  ]);
}

export function runPassed(result: CodeRunResult | null | undefined) {
  if (!result) return false;
  const value = result as any;
  if (typeof value.status === 'string') return value.status === 'passed';
  if (typeof value.passed === 'boolean') return value.passed;
  if (typeof value.success === 'boolean') return value.success;
  const tests = getTestResults(result);
  return tests.length > 0 && tests.every((test: any) => test.passed);
}

export function getTestResults(
  result: CodeRunResult | null | undefined
): TestCaseResult[] {
  if (!result) return [];
  const value = result as any;
  const tests = value.tests ?? value.testResults ?? value.results ?? [];
  return Array.isArray(tests) ? (tests as TestCaseResult[]) : [];
}

export function runDuration(result: CodeRunResult | null | undefined) {
  if (!result) return 0;
  const value = result as any;
  return Number(value.durationMs ?? value.executionTime ?? value.duration ?? 0);
}

export function runError(result: CodeRunResult | null | undefined) {
  if (!result) return '';
  const value = result as any;
  return String(value.error?.message ?? value.error ?? value.stderr ?? '');
}

export function artifactText(
  artifact: LearningArtifact | unknown,
  locale: 'zh' | 'en'
) {
  if (!artifact || typeof artifact !== 'object') return '';
  const value = artifact as Record<string, any>;
  return localized(
    value.content ?? value.summary ?? value.text ?? value.message,
    locale
  );
}

export function problemHint(
  problem: Problem,
  locale: 'zh' | 'en',
  index: number
) {
  const hints = (problem as any).hints;
  const value = Array.isArray(hints) ? hints[index] : hints?.[locale]?.[index];
  return localized(value, locale);
}

export function difficultyLabel(difficulty: string, locale: 'zh' | 'en') {
  const map = {
    easy: locale === 'zh' ? '简单' : 'Easy',
    medium: locale === 'zh' ? '中等' : 'Medium',
    hard: locale === 'zh' ? '困难' : 'Hard',
  } as Record<string, string>;
  return map[difficulty.toLowerCase()] ?? difficulty;
}
