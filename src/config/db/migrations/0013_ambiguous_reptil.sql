CREATE TABLE "algocoach"."coach_catalog_review_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text,
	"problem_id" text,
	"revision_id" text,
	"reviewer_user_id" text,
	"action" text NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_catalog_review_action" CHECK ("algocoach"."coach_catalog_review_audit"."action" in ('submitted', 'approved', 'rejected', 'published', 'archived', 'rolled_back')),
	CONSTRAINT "chk_coach_catalog_review_subject" CHECK ("algocoach"."coach_catalog_review_audit"."candidate_id" is not null or "algocoach"."coach_catalog_review_audit"."problem_id" is not null or "algocoach"."coach_catalog_review_audit"."revision_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_catalog_source" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"adapter" text NOT NULL,
	"base_url" text NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"sync_interval_minutes" integer DEFAULT 1440 NOT NULL,
	"license_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_successful_revision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_catalog_source_status" CHECK ("algocoach"."coach_catalog_source"."status" in ('active', 'paused', 'disabled')),
	CONSTRAINT "chk_coach_catalog_source_interval" CHECK ("algocoach"."coach_catalog_source"."sync_interval_minutes" between 5 and 10080)
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_catalog_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"upstream_revision" text,
	"cursor" text,
	"statistics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_catalog_sync_trigger" CHECK ("algocoach"."coach_catalog_sync_run"."trigger" in ('scheduled', 'manual', 'webhook')),
	CONSTRAINT "chk_coach_catalog_sync_status" CHECK ("algocoach"."coach_catalog_sync_run"."status" in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_problem_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"sync_run_id" text,
	"external_id" text NOT NULL,
	"upstream_url" text NOT NULL,
	"source_revision" text NOT NULL,
	"content_hash" text NOT NULL,
	"license_spdx" text NOT NULL,
	"attribution" text NOT NULL,
	"normalized_problem" jsonb NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'quarantined' NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_problem_candidate_status" CHECK ("algocoach"."coach_problem_candidate"."status" in ('discovered', 'quarantined', 'validated', 'approved', 'rejected', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_problem_origin" (
	"id" text PRIMARY KEY NOT NULL,
	"problem_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"upstream_url" text NOT NULL,
	"license_spdx" text NOT NULL,
	"attribution" text NOT NULL,
	"source_revision" text NOT NULL,
	"content_hash" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_problem_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"problem_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"difficulty" text NOT NULL,
	"topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"entry_point" text NOT NULL,
	"templates" jsonb NOT NULL,
	"language_configs" jsonb NOT NULL,
	"signature" jsonb,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hints" jsonb NOT NULL,
	"review_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_minutes" smallint DEFAULT 20 NOT NULL,
	"source_statement" text,
	"source_url" text,
	"source_revision" text,
	"catalog_version" text,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "chk_coach_problem_revision_version" CHECK ("algocoach"."coach_problem_revision"."version" > 0),
	CONSTRAINT "chk_coach_problem_revision_difficulty" CHECK ("algocoach"."coach_problem_revision"."difficulty" in ('easy', 'medium', 'hard')),
	CONSTRAINT "chk_coach_problem_revision_status" CHECK ("algocoach"."coach_problem_revision"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "chk_coach_problem_revision_estimated_minutes" CHECK ("algocoach"."coach_problem_revision"."estimated_minutes" between 1 and 180)
);
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" DROP CONSTRAINT "chk_coach_code_run_language";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_profile" DROP CONSTRAINT "chk_coach_learning_profile_language";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" DROP CONSTRAINT "chk_coach_problem_source";--> statement-breakpoint
DROP INDEX "algocoach"."uq_coach_test_case_problem_ordinal";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" ADD COLUMN "current_revision_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD COLUMN "revision_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD CONSTRAINT "coach_catalog_review_audit_candidate_id_coach_problem_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "algocoach"."coach_problem_candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD CONSTRAINT "coach_catalog_review_audit_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD CONSTRAINT "coach_catalog_review_audit_revision_id_coach_problem_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "algocoach"."coach_problem_revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD CONSTRAINT "coach_catalog_review_audit_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "algocoach"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_sync_run" ADD CONSTRAINT "coach_catalog_sync_run_source_id_coach_catalog_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "algocoach"."coach_catalog_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "coach_problem_candidate_source_id_coach_catalog_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "algocoach"."coach_catalog_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "coach_problem_candidate_sync_run_id_coach_catalog_sync_run_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "algocoach"."coach_catalog_sync_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_origin" ADD CONSTRAINT "coach_problem_origin_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_origin" ADD CONSTRAINT "coach_problem_origin_source_id_coach_catalog_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "algocoach"."coach_catalog_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD CONSTRAINT "coach_problem_revision_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "algocoach"."coach_problem_revision" (
	"id", "problem_id", "version", "title", "description", "difficulty",
	"topics", "entry_point", "templates", "language_configs", "signature",
	"examples", "constraints", "hints", "review_points", "estimated_minutes",
	"source_statement", "source_url", "source_revision", "catalog_version",
	"content_hash", "status", "created_at", "published_at"
)
SELECT
	'coach_revision_' || md5(problem."id" || ':v' || problem."content_version"::text),
	problem."id",
	problem."content_version",
	problem."title",
	problem."description",
	problem."difficulty",
	problem."topics",
	problem."entry_point",
	problem."templates",
	jsonb_strip_nulls(jsonb_build_object(
		'javascript', CASE
			WHEN problem."templates" ? 'javascript' THEN jsonb_build_object(
				'entryPoint', problem."entry_point",
				'template', problem."templates"->>'javascript',
				'signature', inferred_signature."value",
				'monacoId', 'javascript',
				'runner', 'quickjs',
				'runtimeVersion', 'quickjs-emscripten@0.32.0'
			)
		END,
		'typescript', CASE
			WHEN problem."templates" ? 'javascript' THEN jsonb_build_object(
				'entryPoint', problem."entry_point",
				'template', problem."templates"->>'javascript',
				'signature', inferred_signature."value",
				'monacoId', 'typescript',
				'runner', 'typescript-quickjs',
				'runtimeVersion', 'typescript@5.9.2 / quickjs-emscripten@0.32.0'
			)
		END,
		'python', CASE
			WHEN problem."templates" ? 'python' THEN jsonb_build_object(
				'entryPoint', lower(regexp_replace(problem."entry_point", '([A-Z])', '_\1', 'g')),
				'template', problem."templates"->>'python',
				'signature', inferred_signature."value",
				'monacoId', 'python',
				'runner', 'pyodide',
				'runtimeVersion', 'pyodide@314.0.2'
			)
		END
	)),
	inferred_signature."value",
	problem."examples",
	problem."constraints",
	problem."hints",
	problem."review_points",
	problem."estimated_minutes",
	problem."source_statement",
	problem."source_url",
	'legacy-static-catalog',
	'legacy-2026-07-v1',
	'legacy-md5:' || md5(jsonb_build_object(
		'title', problem."title",
		'description', problem."description",
		'difficulty', problem."difficulty",
		'topics', to_jsonb(problem."topics"),
		'entryPoint', problem."entry_point",
		'templates', problem."templates",
		'examples', problem."examples",
		'constraints', problem."constraints",
		'hints', problem."hints",
		'reviewPoints', problem."review_points",
		'estimatedMinutes', problem."estimated_minutes"
	)::text),
	CASE
		WHEN problem."status" = 'archived' THEN 'archived'
		WHEN problem."status" = 'published' THEN 'published'
		ELSE 'draft'
	END,
	problem."created_at",
	CASE WHEN problem."status" = 'published' THEN problem."updated_at" ELSE NULL END
FROM "algocoach"."coach_problem" AS problem
CROSS JOIN LATERAL (
	SELECT jsonb_build_object(
		'parameters', COALESCE(
			jsonb_agg(
				jsonb_build_object(
					'name', regexp_replace(
						regexp_replace(btrim(parameter."raw"), '^\.\.\.', ''),
						'\s*=.*$',
						''
					),
					'type', '{"kind":"unknown"}'::jsonb
				)
				ORDER BY parameter."ordinal"
			) FILTER (WHERE btrim(parameter."raw") <> ''),
			'[]'::jsonb
		),
		'returns', '{"kind":"unknown"}'::jsonb
	) AS "value"
	FROM unnest(string_to_array(
		COALESCE((regexp_match(problem."templates"->>'javascript', '\(([^)]*)\)'))[1], ''),
		','
	)) WITH ORDINALITY AS parameter("raw", "ordinal")
) AS inferred_signature
WHERE problem."owner_user_id" IS NULL
	AND problem."source" = 'curated'
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "algocoach"."coach_problem" AS problem
SET "current_revision_id" = revision."id"
FROM "algocoach"."coach_problem_revision" AS revision
WHERE revision."problem_id" = problem."id"
	AND revision."version" = problem."content_version"
	AND problem."owner_user_id" IS NULL
	AND problem."source" = 'curated';--> statement-breakpoint
UPDATE "algocoach"."coach_test_case" AS test_case
SET "revision_id" = problem."current_revision_id"
FROM "algocoach"."coach_problem" AS problem
WHERE test_case."problem_id" = problem."id"
	AND problem."current_revision_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_coach_catalog_review_candidate" ON "algocoach"."coach_catalog_review_audit" USING btree ("candidate_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_catalog_review_problem" ON "algocoach"."coach_catalog_review_audit" USING btree ("problem_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_catalog_source_key" ON "algocoach"."coach_catalog_source" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_coach_catalog_source_sync" ON "algocoach"."coach_catalog_source" USING btree ("status","sync_enabled");--> statement-breakpoint
CREATE INDEX "idx_coach_catalog_sync_source_created" ON "algocoach"."coach_catalog_sync_run" USING btree ("source_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_catalog_sync_status_created" ON "algocoach"."coach_catalog_sync_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_candidate_content" ON "algocoach"."coach_problem_candidate" USING btree ("source_id","external_id","content_hash");--> statement-breakpoint
CREATE INDEX "idx_coach_problem_candidate_review" ON "algocoach"."coach_problem_candidate" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_coach_problem_candidate_sync" ON "algocoach"."coach_problem_candidate" USING btree ("sync_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_origin_problem" ON "algocoach"."coach_problem_origin" USING btree ("problem_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_origin_external" ON "algocoach"."coach_problem_origin" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "idx_coach_problem_origin_revision" ON "algocoach"."coach_problem_origin" USING btree ("source_id","source_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_revision_version" ON "algocoach"."coach_problem_revision" USING btree ("problem_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_revision_content" ON "algocoach"."coach_problem_revision" USING btree ("problem_id","content_hash");--> statement-breakpoint
CREATE INDEX "idx_coach_problem_revision_status" ON "algocoach"."coach_problem_revision" USING btree ("problem_id","status","version" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" ADD CONSTRAINT "coach_problem_current_revision_id_coach_problem_revision_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "algocoach"."coach_problem_revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD CONSTRAINT "coach_test_case_revision_id_coach_problem_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "algocoach"."coach_problem_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_test_case_revision_ordinal" ON "algocoach"."coach_test_case" USING btree ("revision_id","ordinal") WHERE "algocoach"."coach_test_case"."revision_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_test_case_unversioned_ordinal" ON "algocoach"."coach_test_case" USING btree ("problem_id","ordinal") WHERE "algocoach"."coach_test_case"."revision_id" is null;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" ADD CONSTRAINT "chk_coach_code_run_language" CHECK ("algocoach"."coach_code_run"."language" in ('javascript', 'python', 'typescript'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_profile" ADD CONSTRAINT "chk_coach_learning_profile_language" CHECK ("algocoach"."coach_learning_profile"."preferred_language" in ('javascript', 'python', 'typescript'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" ADD CONSTRAINT "chk_coach_problem_source" CHECK ("algocoach"."coach_problem"."source" in ('curated', 'imported', 'external'));
