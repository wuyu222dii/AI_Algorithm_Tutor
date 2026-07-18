import {
  normalizeProblemLanguageConfigs,
  type EnabledLanguage,
} from './languages';
import type {
  Language,
  Problem,
  ProblemDetail,
  ProblemLanguageConfig,
  ProblemSummary,
  ProblemTemplates,
} from './types';

function enabledProblemLanguages(
  configs: Partial<Record<Language, ProblemLanguageConfig>>,
  enabledLanguages: readonly EnabledLanguage[]
): Language[] {
  return enabledLanguages.filter((language) => Boolean(configs[language]));
}

export function toProblemSummary(
  problem: Problem,
  enabledLanguages: readonly EnabledLanguage[]
): ProblemSummary {
  const languageConfigs = normalizeProblemLanguageConfigs(problem);
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    description: problem.description,
    difficulty: problem.difficulty,
    topics: problem.topics,
    estimatedMinutes: problem.estimatedMinutes,
    contentVersion: problem.version?.contentVersion ?? 1,
    catalogVersion: problem.version?.catalogVersion,
    version: {
      contentVersion: problem.version?.contentVersion ?? 1,
      catalogVersion: problem.version?.catalogVersion,
    },
    supportedLanguages: enabledProblemLanguages(
      languageConfigs,
      enabledLanguages
    ),
  };
}

/**
 * Produces the browser-safe problem detail contract. Non-sample tests remain
 * server-side even though local assessment and practice routes can load them
 * through trusted server components.
 */
function toProblemDetail(
  problem: Problem,
  enabledLanguages: readonly EnabledLanguage[],
  includeFullTests: boolean
): ProblemDetail {
  const normalizedConfigs = normalizeProblemLanguageConfigs(problem);
  const supportedLanguages = enabledProblemLanguages(
    normalizedConfigs,
    enabledLanguages
  );
  const allowed = new Set<Language>(supportedLanguages);
  const languageConfigs = Object.fromEntries(
    Object.entries(normalizedConfigs).filter(([language]) =>
      allowed.has(language as Language)
    )
  ) as Partial<Record<Language, ProblemLanguageConfig>>;
  const templates = problem.templates
    ? (Object.fromEntries(
        Object.entries(problem.templates).filter(([language]) =>
          allowed.has(language as Language)
        )
      ) as ProblemTemplates)
    : undefined;

  return {
    ...problem,
    languageConfigs,
    version: problem.version ?? { contentVersion: 1 },
    supportedLanguages,
    ...(templates ? { templates } : {}),
    tests: includeFullTests
      ? problem.tests
      : problem.tests.filter((test) => test.isSample),
  };
}

export function toPublicProblemDetail(
  problem: Problem,
  enabledLanguages: readonly EnabledLanguage[]
): ProblemDetail {
  return toProblemDetail(problem, enabledLanguages, false);
}

export function toAssessmentProblemDetail(
  problem: Problem,
  enabledLanguages: readonly EnabledLanguage[]
): ProblemDetail {
  return toProblemDetail(problem, enabledLanguages, true);
}
