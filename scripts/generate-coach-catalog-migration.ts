import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { extendedProblems } from '../src/features/algorithm-coach/data/extended-problems';

const hardOnly = process.argv.includes('--hard');
const migrationPath = path.resolve(
  process.cwd(),
  hardOnly
    ? 'src/config/db/migrations/0008_seed_hard_coach_catalog.sql'
    : 'src/config/db/migrations/0005_seed_extended_coach_catalog.sql'
);
const selectedProblems = extendedProblems.filter((problem) =>
  hardOnly ? problem.difficulty === 'hard' : problem.difficulty !== 'hard'
);
const catalog = JSON.stringify(selectedProblems).replaceAll('$catalog$', '');

const sql = `WITH catalog AS (
  SELECT jsonb_array_elements($catalog$${catalog}$catalog$::jsonb) AS problem
),
upserted_problems AS (
  INSERT INTO "algocoach"."coach_problem" (
    "id", "slug", "owner_user_id", "source", "title", "description",
    "difficulty", "topics", "entry_point", "templates", "examples",
    "constraints", "hints", "review_points", "estimated_minutes",
    "status", "content_version", "updated_at"
  )
  SELECT
    problem->>'id',
    problem->>'slug',
    NULL,
    'curated',
    problem->'title',
    problem->'description',
    problem->>'difficulty',
    ARRAY(SELECT jsonb_array_elements_text(problem->'topics')),
    problem->>'entryPoint',
    problem->'templates',
    problem->'examples',
    problem->'constraints',
    problem->'hints',
    problem->'reviewPoints',
    (problem->>'estimatedMinutes')::smallint,
    'published',
    1,
    now()
  FROM catalog
  ON CONFLICT ("id") DO UPDATE SET
    "slug" = EXCLUDED."slug",
    "source" = EXCLUDED."source",
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "difficulty" = EXCLUDED."difficulty",
    "topics" = EXCLUDED."topics",
    "entry_point" = EXCLUDED."entry_point",
    "templates" = EXCLUDED."templates",
    "examples" = EXCLUDED."examples",
    "constraints" = EXCLUDED."constraints",
    "hints" = EXCLUDED."hints",
    "review_points" = EXCLUDED."review_points",
    "estimated_minutes" = EXCLUDED."estimated_minutes",
    "status" = EXCLUDED."status",
    "content_version" = EXCLUDED."content_version",
    "updated_at" = now()
  RETURNING "id"
),
catalog_tests AS (
  SELECT
    problem->>'id' AS problem_id,
    test_case,
    (ordinality - 1)::smallint AS ordinal
  FROM catalog
  CROSS JOIN LATERAL jsonb_array_elements(problem->'tests')
    WITH ORDINALITY AS test_rows(test_case, ordinality)
)
INSERT INTO "algocoach"."coach_test_case" (
  "id", "problem_id", "ordinal", "args", "expected", "is_sample",
  "label", "timeout_ms", "updated_at"
)
SELECT
  test_case->>'id',
  problem_id,
  ordinal,
  test_case->'args',
  test_case->'expected',
  COALESCE((test_case->>'isSample')::boolean, false),
  test_case->'label',
  3000,
  now()
FROM catalog_tests
CROSS JOIN (SELECT count(*) FROM upserted_problems) AS seeded
ON CONFLICT ("id") DO UPDATE SET
  "problem_id" = EXCLUDED."problem_id",
  "ordinal" = EXCLUDED."ordinal",
  "args" = EXCLUDED."args",
  "expected" = EXCLUDED."expected",
  "is_sample" = EXCLUDED."is_sample",
  "label" = EXCLUDED."label",
  "timeout_ms" = EXCLUDED."timeout_ms",
  "updated_at" = now();
`;

async function main() {
  await writeFile(migrationPath, sql, 'utf8');
  console.log(
    `Generated ${migrationPath} with ${selectedProblems.length} problems.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
