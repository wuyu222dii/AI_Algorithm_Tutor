import { gzipSync } from 'node:zlib';

import { curatedExercismProblems } from '../src/features/algorithm-coach/catalog/curated-exercism-problems';
import { p1LearningProblems } from '../src/features/algorithm-coach/data/p1-learning-problems';
import { problems } from '../src/features/algorithm-coach/data/problems';
import { toProblemSummary } from '../src/features/algorithm-coach/problem-contracts';
import type { Problem } from '../src/features/algorithm-coach/types';

const KIBIBYTE = 1024;
const SUMMARY_PAYLOAD_GZIP_LIMIT = 150 * KIBIBYTE;
const MINIMUM_PUBLISHED_PROBLEMS = 73;
const enabledLanguages = ['javascript', 'python', 'typescript'] as const;
const forbiddenDetailKeys = new Set([
  'tests',
  'examples',
  'constraints',
  'hints',
  'reviewPoints',
  'languageConfigs',
  'templates',
  'signature',
  'sourceStatement',
  'sourceUrl',
  'origin',
]);

function curatedProblem(
  problem: (typeof curatedExercismProblems)[number]
): Problem {
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    description: problem.description,
    difficulty: problem.difficulty,
    topics: problem.topics,
    languageConfigs: problem.languageConfigs,
    version: {
      contentVersion: 1,
      catalogVersion: 'exercism-p0-v1',
      sourceRevision: problem.origin.sourceRevision,
    },
    tests: problem.tests,
    examples: [],
    constraints: problem.constraints,
    hints: problem.hints,
    reviewPoints: problem.reviewPoints,
    estimatedMinutes: problem.estimatedMinutes,
  };
}

const summaries = [
  ...problems.map((problem) => toProblemSummary(problem, enabledLanguages)),
  ...curatedExercismProblems.map((problem) =>
    toProblemSummary(curatedProblem(problem), enabledLanguages)
  ),
  ...p1LearningProblems.map((problem) =>
    toProblemSummary(problem, enabledLanguages)
  ),
];

if (summaries.length < MINIMUM_PUBLISHED_PROBLEMS) {
  throw new Error(
    `Summary fixture contains ${summaries.length} problems; expected at least ${MINIMUM_PUBLISHED_PROBLEMS}.`
  );
}

const duplicateSlugs = summaries
  .map(({ slug }) => slug)
  .filter((slug, index, all) => all.indexOf(slug) !== index);
if (duplicateSlugs.length) {
  throw new Error(
    `Summary fixture contains duplicate slugs: ${[...new Set(duplicateSlugs)].join(', ')}.`
  );
}

for (const summary of summaries) {
  for (const key of Object.keys(summary)) {
    if (forbiddenDetailKeys.has(key)) {
      throw new Error(
        `ProblemSummary ${summary.slug} leaked detail field ${key}.`
      );
    }
  }
}

// This is the exact catalog prop shape serialized by the coach RSC layout.
// React Flight adds framing bytes, so keep explicit headroom under the 150 KiB gate.
const payload = Buffer.from(
  JSON.stringify({ problems: summaries, enabledLanguages }),
  'utf8'
);
const gzipBytes = gzipSync(payload).byteLength;

if (gzipBytes > SUMMARY_PAYLOAD_GZIP_LIMIT) {
  throw new Error(
    `Coach ProblemSummary payload is ${(gzipBytes / KIBIBYTE).toFixed(1)} KiB gzip; limit is ${SUMMARY_PAYLOAD_GZIP_LIMIT / KIBIBYTE} KiB.`
  );
}

console.log(
  `Coach ProblemSummary payload: ${summaries.length} problems, ${(payload.byteLength / KIBIBYTE).toFixed(1)} KiB raw, ${(gzipBytes / KIBIBYTE).toFixed(1)} KiB gzip / ${SUMMARY_PAYLOAD_GZIP_LIMIT / KIBIBYTE} KiB`
);
