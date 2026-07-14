import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { curatedExercismProblems } from '../src/features/algorithm-coach/catalog/curated-exercism-problems';
import { exercismSnapshotFixture } from '../src/features/algorithm-coach/catalog/fixtures/exercism-snapshot.fixture';

const migrationPath = path.resolve(
  'src/config/db/migrations/0015_seed_exercism_catalog.sql'
);
const sourceId = 'catalog_source_exercism';
const temporaryCatalog = 'algocoach_exercism_seed_catalog';

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u001f'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

const upstreamByExternalId = new Map(
  exercismSnapshotFixture.problems.map((problem) => [
    problem.externalId,
    problem,
  ])
);

const catalog = curatedExercismProblems.map((problem) => {
  const upstream = upstreamByExternalId.get(problem.origin.externalId);
  if (!upstream) {
    throw new Error(
      `Missing upstream fixture for ${problem.origin.externalId}`
    );
  }
  const problemId = stableId(
    'external_problem',
    sourceId,
    problem.origin.externalId
  );
  const revisionId = stableId('problem_revision', problemId, '1');
  const templates = Object.fromEntries(
    Object.entries(problem.languageConfigs).map(([language, config]) => [
      language,
      config.template,
    ])
  );
  return {
    ...problem,
    problemId,
    revisionId,
    originId: stableId('problem_origin', sourceId, problem.origin.externalId),
    auditId: stableId('catalog_seed_audit', problemId, revisionId),
    entryPoint: problem.languageConfigs.javascript.entryPoint,
    templates,
    sourceStatement: upstream.statementMarkdown,
    seedTests: problem.tests.map((test, ordinal) => ({
      ...test,
      ordinal,
      persistedId: stableId('revision_test', revisionId, test.id),
    })),
  };
});

const serializedCatalog = JSON.stringify(catalog).replaceAll('$catalog$', '');

const sql = `CREATE TEMP TABLE "${temporaryCatalog}" (
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
  'exercism-problem-specifications',
  'Exercism Problem Specifications',
  'exercism-github-v1',
  'https://github.com/exercism/problem-specifications',
  'active',
  true,
  1440,
  '{"allow":["MIT"]}'::jsonb,
  '${exercismSnapshotFixture.revision}',
  now()
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "adapter" = EXCLUDED."adapter",
  "base_url" = EXCLUDED."base_url",
  "license_policy" = EXCLUDED."license_policy",
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "algocoach"."coach_problem" (
  "id", "slug", "owner_user_id", "source", "title", "description",
  "difficulty", "topics", "entry_point", "templates", "examples",
  "constraints", "hints", "review_points", "estimated_minutes",
  "status", "is_active", "source_statement", "source_url",
  "content_version", "current_revision_id", "updated_at"
)
SELECT
  problem->>'problemId',
  problem->>'slug',
  NULL,
  'external',
  problem->'title',
  problem->'description',
  problem->>'difficulty',
  ARRAY(SELECT jsonb_array_elements_text(problem->'topics')),
  problem->>'entryPoint',
  problem->'templates',
  '[]'::jsonb,
  problem->'constraints',
  problem->'hints',
  problem->'reviewPoints',
  (problem->>'estimatedMinutes')::smallint,
  'published',
  false,
  problem->>'sourceStatement',
  problem#>>'{origin,upstreamUrl}',
  1,
  NULL,
  now()
FROM "${temporaryCatalog}"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "algocoach"."coach_problem_revision" (
  "id", "problem_id", "version", "title", "description", "difficulty",
  "topics", "entry_point", "templates", "language_configs", "signature",
  "examples", "constraints", "hints", "review_points", "estimated_minutes",
  "source_statement", "source_url", "source_revision", "catalog_version",
  "content_hash", "status", "published_at"
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
  problem#>'{languageConfigs,javascript,signature}',
  '[]'::jsonb,
  problem->'constraints',
  problem->'hints',
  problem->'reviewPoints',
  (problem->>'estimatedMinutes')::smallint,
  problem->>'sourceStatement',
  problem#>>'{origin,upstreamUrl}',
  problem#>>'{origin,sourceRevision}',
  'exercism@' || left(problem#>>'{origin,sourceRevision}', 12),
  problem#>>'{origin,contentHash}',
  'published',
  now()
FROM "${temporaryCatalog}"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "algocoach"."coach_problem" AS persisted
SET
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
  catalog.problem->>'originId',
  catalog.problem->>'problemId',
  source."id",
  catalog.problem#>>'{origin,externalId}',
  catalog.problem#>>'{origin,upstreamUrl}',
  catalog.problem#>>'{origin,licenseSpdx}',
  catalog.problem#>>'{origin,attribution}',
  catalog.problem#>>'{origin,sourceRevision}',
  catalog.problem#>>'{origin,contentHash}',
  now(),
  now()
FROM "${temporaryCatalog}" AS catalog
CROSS JOIN "algocoach"."coach_catalog_source" AS source
WHERE source."key" = 'exercism-problem-specifications'
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "algocoach"."coach_test_case" (
  "id", "problem_id", "revision_id", "ordinal", "args", "expected",
  "is_sample", "timeout_ms", "updated_at"
)
SELECT
  test_case->>'persistedId',
  catalog.problem->>'problemId',
  catalog.problem->>'revisionId',
  (test_case->>'ordinal')::smallint,
  test_case->'args',
  test_case->'expected',
  COALESCE((test_case->>'isSample')::boolean, false),
  3000,
  now()
FROM "${temporaryCatalog}" AS catalog
CROSS JOIN LATERAL jsonb_array_elements(catalog.problem->'seedTests') AS tests(test_case)
ON CONFLICT ("id") DO UPDATE SET
  "args" = EXCLUDED."args",
  "expected" = EXCLUDED."expected",
  "is_sample" = EXCLUDED."is_sample",
  "timeout_ms" = EXCLUDED."timeout_ms",
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "algocoach"."coach_catalog_review_audit" (
  "id", "problem_id", "revision_id", "action", "notes", "metadata"
)
SELECT
  problem->>'auditId',
  problem->>'problemId',
  problem->>'revisionId',
  'published',
  'Reviewed Exercism seed published by migration 0015.',
  jsonb_build_object(
    'reviewer', 'migration:0015',
    'license', problem#>>'{origin,licenseSpdx}',
    'sourceRevision', problem#>>'{origin,sourceRevision}'
  )
FROM "${temporaryCatalog}"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DROP TABLE "${temporaryCatalog}";
`;

async function main() {
  await writeFile(migrationPath, sql, 'utf8');
  console.log(
    `Generated ${migrationPath} with ${catalog.length} Exercism problems.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
