ALTER TABLE "algocoach"."coach_assessment" ADD COLUMN "problem_versions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" ADD COLUMN "problem_content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" ADD COLUMN "runtime_version" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" ADD COLUMN "runner_mode" text DEFAULT 'browser-worker' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" ADD COLUMN "problem_content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_practice_session" ADD COLUMN "problem_content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "algocoach"."coach_assessment" AS assessment
SET "problem_versions" = COALESCE((
	SELECT jsonb_agg(
		jsonb_build_object('slug', problem_slug, 'contentVersion', 1)
		ORDER BY ordinal
	)
	FROM unnest(assessment."problem_slugs") WITH ORDINALITY AS problems(problem_slug, ordinal)
), '[]'::jsonb)
WHERE jsonb_array_length(assessment."problem_versions") = 0
	AND cardinality(assessment."problem_slugs") > 0;--> statement-breakpoint
UPDATE "algocoach"."coach_code_run"
SET "runtime_version" = CASE "language"
	WHEN 'javascript' THEN 'quickjs-emscripten@0.32'
	WHEN 'typescript' THEN 'typescript@5.9 / quickjs-emscripten@0.32'
	WHEN 'python' THEN 'pyodide@314.0.2'
	ELSE 'unknown'
END;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD CONSTRAINT "chk_coach_assessment_problem_versions" CHECK (jsonb_typeof("algocoach"."coach_assessment"."problem_versions") = 'array');--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" ADD CONSTRAINT "chk_coach_code_run_problem_version" CHECK ("algocoach"."coach_code_run"."problem_content_version" > 0);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" ADD CONSTRAINT "chk_coach_code_run_runner_mode" CHECK ("algocoach"."coach_code_run"."runner_mode" in ('browser-worker', 'remote-judge'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" ADD CONSTRAINT "chk_coach_learning_artifact_problem_version" CHECK ("algocoach"."coach_learning_artifact"."problem_content_version" > 0);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_practice_session" ADD CONSTRAINT "chk_coach_practice_session_problem_version" CHECK ("algocoach"."coach_practice_session"."problem_content_version" > 0);
