import 'server-only';

import { getRuntimeProblem } from './catalog-runtime.server';
import { CoachHttpError } from './http';
import { getProblemContentVersion, getProblemEntryPoint } from './languages';
import type {
  CoachChatRequest,
  CoachProblemContext,
  CoachRequest,
  Problem,
} from './types';

type CatalogCoachRequest = CoachRequest | CoachChatRequest;

function localizedProblemContext(
  problem: Problem,
  request: CatalogCoachRequest
): CoachProblemContext {
  const locale = request.locale ?? 'zh';
  const language = request.language ?? 'javascript';
  return {
    slug: problem.slug,
    title: problem.title[locale],
    description: problem.description[locale],
    difficulty: problem.difficulty,
    topics: problem.topics,
    constraints: problem.constraints.map((item) => item[locale]),
    entryPoint: getProblemEntryPoint(problem, language),
  };
}

function isImportedDraft(slug: string) {
  return /^imported-draft(?:-[a-z0-9]+)*$/.test(slug);
}

export async function hydrateCoachCatalogRequest<T extends CatalogCoachRequest>(
  request: T
): Promise<{ request: T; problem?: Problem }> {
  if ('action' in request && request.action === 'parse') return { request };

  const slug = request.problemSlug ?? request.problem?.slug;
  if (!slug) return { request };
  const evidenceVersion = request.runResult?.problemContentVersion;
  const requestedVersion = request.problemContentVersion ?? evidenceVersion;

  if (request.runResult && request.runResult.problemSlug !== slug) {
    throw new CoachHttpError(
      400,
      'run_problem_mismatch',
      'The run evidence belongs to a different problem.'
    );
  }
  if (
    request.problemContentVersion !== undefined &&
    evidenceVersion !== undefined &&
    request.problemContentVersion !== evidenceVersion
  ) {
    throw new CoachHttpError(
      409,
      'problem_version_mismatch',
      'The run evidence belongs to a different problem version.'
    );
  }

  if (isImportedDraft(slug)) {
    const contentVersion = requestedVersion ?? 1;
    return {
      request: {
        ...request,
        problemSlug: slug,
        problemContentVersion: contentVersion,
        runResult: request.runResult
          ? {
              ...request.runResult,
              problemContentVersion: contentVersion,
            }
          : undefined,
      },
    };
  }

  const problem = await getRuntimeProblem(slug, requestedVersion);
  if (!problem) {
    throw new CoachHttpError(
      requestedVersion === undefined ? 404 : 409,
      requestedVersion === undefined
        ? 'problem_not_found'
        : 'problem_version_unavailable',
      requestedVersion === undefined
        ? 'The requested problem was not found.'
        : 'The requested problem version is not available.'
    );
  }

  const contentVersion = getProblemContentVersion(problem);
  return {
    problem,
    request: {
      ...request,
      problemSlug: problem.slug,
      problemContentVersion: contentVersion,
      problem: localizedProblemContext(problem, request),
      runResult: request.runResult
        ? {
            ...request.runResult,
            problemContentVersion: contentVersion,
          }
        : undefined,
    },
  };
}
