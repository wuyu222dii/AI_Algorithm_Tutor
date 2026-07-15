import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  calculateP1ProblemContentHash,
  P1_CATALOG_ATTRIBUTION,
  P1_CATALOG_LICENSE,
  P1_CATALOG_PUBLISHED_AT,
  P1_CATALOG_SOURCE_KEY,
  P1_CATALOG_VERSION,
  p1ProblemSourceUrl,
} from '../src/features/algorithm-coach/data/p1-learning-catalog';
import { p1LearningProblems } from '../src/features/algorithm-coach/data/p1-learning-problems';

const migrationPath = path.resolve(
  'src/config/db/migrations/0018_p1_learning_catalog.sql'
);
const sourceId = 'catalog_source_algocoach_original';
const temporaryCatalog = 'algocoach_p1_learning_seed_catalog';

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u001f'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

const catalog = p1LearningProblems.map((problem) => {
  const problemId = problem.id;
  const revisionId = stableId('problem_revision', problemId, '1');
  const contentHash = calculateP1ProblemContentHash(problem);
  const sourceUrl = p1ProblemSourceUrl(problem.slug);
  const templates = Object.fromEntries(
    Object.entries(problem.languageConfigs ?? {}).map(([language, config]) => [
      language,
      config.template,
    ])
  );

  return {
    ...problem,
    problemId,
    revisionId,
    originId: stableId('problem_origin', sourceId, problem.slug),
    auditId: stableId('catalog_seed_audit', problemId, revisionId),
    entryPoint: problem.languageConfigs?.javascript?.entryPoint,
    templates,
    sourceStatement: problem.description.en,
    sourceUrl,
    contentHash,
    seedTests: problem.tests.map((test, ordinal) => ({
      ...test,
      ordinal,
      persistedId: stableId('revision_test', revisionId, test.id),
    })),
  };
});

const serializedCatalog = JSON.stringify(catalog).replaceAll('$catalog$', '');

const sql = `ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "learning_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "prerequisite_topics" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "solution_patterns" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
CREATE TEMP TABLE "${temporaryCatalog}" (
  "problem" jsonb NOT NULL
);
INSERT INTO "${temporaryCatalog}" ("problem")
SELECT jsonb_array_elements($catalog$${serializedCatalog}$catalog$::jsonb);
--> statement-breakpoint
INSERT INTO "algocoach"."coach_catalog_source" (
  "id", "key", "name", "adapter", "base_url", "status",
  "sync_enabled", "sync_interval_minutes", "license_policy",
  "last_successful_revision", "updated_at"
) VALUES (
  '${sourceId}',
  '${P1_CATALOG_SOURCE_KEY}',
  'AlgoCoach Original Curriculum',
  'internal-static-v1',
  'https://algocoach.example',
  'active',
  false,
  10080,
  '{"allow":["${P1_CATALOG_LICENSE}"]}'::jsonb,
  '${P1_CATALOG_VERSION}',
  now()
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "adapter" = EXCLUDED."adapter",
  "base_url" = EXCLUDED."base_url",
  "license_policy" = EXCLUDED."license_policy",
  "last_successful_revision" = EXCLUDED."last_successful_revision",
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "algocoach"."coach_problem" (
  "id", "slug", "owner_user_id", "source", "title", "description",
  "difficulty", "topics", "entry_point", "templates", "language_configs",
  "signature", "examples", "constraints", "hints", "review_points",
  "estimated_minutes", "status", "is_active", "source_statement",
  "source_url", "content_version", "current_revision_id", "updated_at"
)
SELECT
  problem->>'problemId',
  problem->>'slug',
  NULL,
  'curated',
  problem->'title',
  problem->'description',
  problem->>'difficulty',
  ARRAY(SELECT jsonb_array_elements_text(problem->'topics')),
  problem->>'entryPoint',
  problem->'templates',
  problem->'languageConfigs',
  problem->'signature',
  problem->'examples',
  problem->'constraints',
  problem->'hints',
  problem->'reviewPoints',
  (problem->>'estimatedMinutes')::smallint,
  'published',
  false,
  problem->>'sourceStatement',
  problem->>'sourceUrl',
  1,
  NULL,
  now()
FROM "${temporaryCatalog}"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "algocoach"."coach_problem_revision" (
  "id", "problem_id", "version", "title", "description", "difficulty",
  "topics", "entry_point", "templates", "language_configs", "signature",
  "examples", "constraints", "hints", "review_points",
  "learning_objectives", "prerequisite_topics", "solution_patterns",
  "estimated_minutes", "source_statement", "source_url", "source_revision",
  "catalog_version", "content_hash", "status", "created_at", "published_at"
)
SELECT
  problem->>'revisionId',
  problem->>'problemId',
  1,
  problem->'title',
  problem->'description',
  problem->>'difficulty',
  ARRAY(SELECT jsonb_array_elements_text(problem->'topics')),
  problem->>'entryPoint',
  problem->'templates',
  problem->'languageConfigs',
  problem->'signature',
  problem->'examples',
  problem->'constraints',
  problem->'hints',
  problem->'reviewPoints',
  problem->'learningObjectives',
  ARRAY(SELECT jsonb_array_elements_text(problem->'prerequisiteTopics')),
  ARRAY(SELECT jsonb_array_elements_text(problem->'solutionPatterns')),
  (problem->>'estimatedMinutes')::smallint,
  problem->>'sourceStatement',
  problem->>'sourceUrl',
  '${P1_CATALOG_VERSION}',
  '${P1_CATALOG_VERSION}',
  problem->>'contentHash',
  'published',
  '${P1_CATALOG_PUBLISHED_AT}'::timestamptz,
  '${P1_CATALOG_PUBLISHED_AT}'::timestamptz
FROM "${temporaryCatalog}"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "algocoach"."coach_problem" AS persisted
SET
  "language_configs" = catalog.problem->'languageConfigs',
  "signature" = catalog.problem->'signature',
  "current_revision_id" = catalog.problem->>'revisionId',
  "content_version" = 1,
  "updated_at" = now()
FROM "${temporaryCatalog}" AS catalog
WHERE persisted."id" = catalog.problem->>'problemId'
  AND (persisted."current_revision_id" IS NULL OR persisted."content_version" <= 1);
--> statement-breakpoint
INSERT INTO "algocoach"."coach_problem_origin" (
  "id", "problem_id", "source_id", "external_id", "upstream_url",
  "license_spdx", "attribution", "source_revision", "content_hash",
  "fetched_at", "updated_at"
)
SELECT
  problem->>'originId',
  problem->>'problemId',
  '${sourceId}',
  problem->>'slug',
  problem->>'sourceUrl',
  '${P1_CATALOG_LICENSE}',
  '${P1_CATALOG_ATTRIBUTION}',
  '${P1_CATALOG_VERSION}',
  problem->>'contentHash',
  '${P1_CATALOG_PUBLISHED_AT}'::timestamptz,
  now()
FROM "${temporaryCatalog}"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "algocoach"."coach_test_case" (
  "id", "problem_id", "revision_id", "ordinal", "args", "expected",
  "is_sample", "label", "timeout_ms", "created_at", "updated_at"
)
SELECT
  test_case->>'persistedId',
  problem->>'problemId',
  problem->>'revisionId',
  (test_case->>'ordinal')::smallint,
  test_case->'args',
  test_case->'expected',
  COALESCE((test_case->>'isSample')::boolean, false),
  test_case->'label',
  3000,
  '${P1_CATALOG_PUBLISHED_AT}'::timestamptz,
  '${P1_CATALOG_PUBLISHED_AT}'::timestamptz
FROM "${temporaryCatalog}"
CROSS JOIN LATERAL jsonb_array_elements(problem->'seedTests') AS tests(test_case)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "algocoach"."coach_catalog_review_audit" (
  "id", "problem_id", "revision_id", "action", "notes", "metadata",
  "created_at"
)
SELECT
  problem->>'auditId',
  problem->>'problemId',
  problem->>'revisionId',
  'published',
  'AlgoCoach original P1 curriculum reviewed and published by migration 0018.',
  jsonb_build_object(
    'reviewer', 'migration:0018',
    'license', '${P1_CATALOG_LICENSE}',
    'sourceRevision', '${P1_CATALOG_VERSION}',
    'contentHash', problem->>'contentHash'
  ),
  '${P1_CATALOG_PUBLISHED_AT}'::timestamptz
FROM "${temporaryCatalog}"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DROP TABLE "${temporaryCatalog}";
`;

async function main() {
  await writeFile(migrationPath, sql, 'utf8');
  console.log(
    `Generated ${migrationPath} with ${catalog.length} original P1 problems.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
