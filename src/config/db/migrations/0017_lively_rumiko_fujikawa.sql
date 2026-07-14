CREATE TABLE "algocoach"."coach_imported_test_case" (
	"id" text PRIMARY KEY NOT NULL,
	"problem_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"args" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"label" jsonb,
	"timeout_ms" integer DEFAULT 3000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_imported_test_case_timeout" CHECK ("algocoach"."coach_imported_test_case"."timeout_ms" between 100 and 10000)
);
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_product_event" DROP CONSTRAINT "chk_coach_product_event_name";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" DROP CONSTRAINT "coach_problem_current_revision_id_coach_problem_revision_id_fk";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" DROP CONSTRAINT "coach_test_case_revision_id_coach_problem_revision_id_fk";--> statement-breakpoint
DROP INDEX "algocoach"."uq_coach_test_case_unversioned_ordinal";--> statement-breakpoint
DROP INDEX "algocoach"."uq_coach_practice_session_user_problem";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" ADD COLUMN "language_configs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" ADD COLUMN "signature" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_id_owner" ON "algocoach"."coach_problem" USING btree ("id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_revision_id_problem" ON "algocoach"."coach_problem_revision" USING btree ("id","problem_id");--> statement-breakpoint
INSERT INTO "algocoach"."coach_imported_test_case" (
	"id", "problem_id", "owner_user_id", "ordinal", "args", "expected",
	"is_sample", "label", "timeout_ms", "created_at", "updated_at"
)
SELECT
	test_case."id", test_case."problem_id", problem."owner_user_id", test_case."ordinal",
	test_case."args", test_case."expected", test_case."is_sample", test_case."label",
	test_case."timeout_ms", test_case."created_at", test_case."updated_at"
FROM "algocoach"."coach_test_case" AS test_case
JOIN "algocoach"."coach_problem" AS problem
	ON problem."id" = test_case."problem_id"
WHERE test_case."revision_id" IS NULL
	AND problem."owner_user_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "algocoach"."coach_test_case" AS test_case
USING "algocoach"."coach_problem" AS problem
WHERE problem."id" = test_case."problem_id"
	AND problem."owner_user_id" IS NOT NULL
	AND test_case."revision_id" IS NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ALTER COLUMN "revision_id" SET NOT NULL;--> statement-breakpoint
UPDATE "algocoach"."coach_problem" AS problem
SET
	"language_configs" = revision."language_configs",
	"signature" = revision."signature"
FROM "algocoach"."coach_problem_revision" AS revision
WHERE revision."id" = problem."current_revision_id"
	AND revision."problem_id" = problem."id";--> statement-breakpoint
UPDATE "algocoach"."coach_problem" AS problem
SET "language_configs" = jsonb_strip_nulls(jsonb_build_object(
	'javascript', CASE WHEN problem."templates" ? 'javascript' THEN jsonb_build_object(
		'entryPoint', problem."entry_point",
		'template', problem."templates"->>'javascript',
		'signature', problem."signature",
		'monacoId', 'javascript',
		'runner', 'quickjs',
		'runtimeVersion', 'quickjs-emscripten@0.32.0'
	) END,
	'typescript', CASE WHEN problem."templates" ? 'typescript' THEN jsonb_build_object(
		'entryPoint', problem."entry_point",
		'template', problem."templates"->>'typescript',
		'signature', problem."signature",
		'monacoId', 'typescript',
		'runner', 'typescript-quickjs',
		'runtimeVersion', 'typescript@5.9.2 / quickjs-emscripten@0.32.0'
	) END,
	'python', CASE WHEN problem."templates" ? 'python' THEN jsonb_build_object(
		'entryPoint', lower(regexp_replace(problem."entry_point", '([a-z0-9])([A-Z])', '\1_\2', 'g')),
		'template', problem."templates"->>'python',
		'signature', problem."signature",
		'monacoId', 'python',
		'runner', 'pyodide',
		'runtimeVersion', 'pyodide@314.0.2'
	) END
))
WHERE problem."owner_user_id" IS NOT NULL
	AND problem."language_configs" = '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_imported_test_case" ADD CONSTRAINT "fk_coach_imported_test_case_problem_owner" FOREIGN KEY ("problem_id","owner_user_id") REFERENCES "algocoach"."coach_problem"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_imported_test_case_problem_ordinal" ON "algocoach"."coach_imported_test_case" USING btree ("problem_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_coach_imported_test_case_owner_problem" ON "algocoach"."coach_imported_test_case" USING btree ("owner_user_id","problem_id");--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" ADD CONSTRAINT "fk_coach_problem_current_revision_ownership" FOREIGN KEY ("current_revision_id","id") REFERENCES "algocoach"."coach_problem_revision"("id","problem_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD CONSTRAINT "fk_coach_test_case_revision_ownership" FOREIGN KEY ("revision_id","problem_id") REFERENCES "algocoach"."coach_problem_revision"("id","problem_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_practice_session_user_problem" ON "algocoach"."coach_practice_session" USING btree ("user_id","problem_slug_snapshot","problem_content_version");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."guard_coach_problem_revision_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Published problem revisions cannot be deleted'
			USING ERRCODE = '23514';
	END IF;
	IF (to_jsonb(NEW) - ARRAY['status', 'published_at']::text[])
		IS DISTINCT FROM
		(to_jsonb(OLD) - ARRAY['status', 'published_at']::text[]) THEN
		RAISE EXCEPTION 'Problem revision content is immutable; create a new revision'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "trg_coach_problem_revision_immutable"
BEFORE UPDATE OR DELETE ON "algocoach"."coach_problem_revision"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_problem_revision_immutable"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."guard_coach_test_case_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'Revision-bound test cases are immutable; create a new revision'
		USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "trg_coach_test_case_immutable"
BEFORE UPDATE OR DELETE ON "algocoach"."coach_test_case"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_test_case_immutable"();--> statement-breakpoint
ALTER TABLE "algocoach"."coach_product_event" ADD CONSTRAINT "chk_coach_product_event_name" CHECK ("algocoach"."coach_product_event"."name" in ('activated', 'visitor_started', 'onboarding_started', 'practice_started', 'first_code_run', 'first_problem_passed', 'code_run', 'code_submitted', 'hint_revealed', 'diagnosis_requested', 'corrected_after_diagnosis', 'assessment_started', 'assessment_completed', 'counterexample_requested', 'review_card_created', 'review_completed', 'coach_chat_message', 'csat_submitted', 'guest_data_claimed', 'sync_succeeded', 'sync_failed', 'language_selected', 'typescript_transpile_failed', 'experiment_exposed', 'imported_problem_saved', 'catalog_sync_completed', 'catalog_candidate_rejected', 'catalog_revision_published', 'catalog_revision_rolled_back'));
