CREATE TABLE "algocoach"."coach_correction_episode" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_episode_id" text NOT NULL,
	"problem_id" text,
	"problem_slug_snapshot" text NOT NULL,
	"problem_content_version" integer DEFAULT 1 NOT NULL,
	"diagnosis_category" text NOT NULL,
	"payload" jsonb NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"passed_within_three_runs" boolean DEFAULT false NOT NULL,
	"repair_duration_ms" integer,
	"started_at" timestamp with time zone NOT NULL,
	"diagnosed_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_correction_episode_version" CHECK ("algocoach"."coach_correction_episode"."problem_content_version" > 0),
	CONSTRAINT "chk_coach_correction_episode_category" CHECK ("algocoach"."coach_correction_episode"."diagnosis_category" in ('syntax', 'runtime', 'timeout', 'wrong-answer', 'edge-case', 'unknown')),
	CONSTRAINT "chk_coach_correction_episode_duration" CHECK ("algocoach"."coach_correction_episode"."repair_duration_ms" is null or "algocoach"."coach_correction_episode"."repair_duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_daily_learning_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_plan_id" text NOT NULL,
	"local_date" text NOT NULL,
	"time_zone" text NOT NULL,
	"budget_minutes" smallint NOT NULL,
	"estimated_minutes" smallint NOT NULL,
	"preferred_language" text,
	"goal" text NOT NULL,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_daily_plan_date" CHECK ("algocoach"."coach_daily_learning_plan"."local_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "chk_coach_daily_plan_budget" CHECK ("algocoach"."coach_daily_learning_plan"."budget_minutes" between 1 and 180),
	CONSTRAINT "chk_coach_daily_plan_estimate" CHECK ("algocoach"."coach_daily_learning_plan"."estimated_minutes" between 0 and 540),
	CONSTRAINT "chk_coach_daily_plan_language" CHECK ("algocoach"."coach_daily_learning_plan"."preferred_language" is null or "algocoach"."coach_daily_learning_plan"."preferred_language" in ('javascript', 'python', 'typescript')),
	CONSTRAINT "chk_coach_daily_plan_goal" CHECK ("algocoach"."coach_daily_learning_plan"."goal" in ('foundation', 'interview', 'contest')),
	CONSTRAINT "chk_coach_daily_plan_tasks" CHECK (jsonb_typeof("algocoach"."coach_daily_learning_plan"."tasks") = 'array'),
	CONSTRAINT "chk_coach_daily_plan_changes" CHECK (jsonb_typeof("algocoach"."coach_daily_learning_plan"."changes") = 'array')
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_review_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_attempt_id" text NOT NULL,
	"problem_id" text,
	"problem_slug_snapshot" text NOT NULL,
	"problem_content_version" integer DEFAULT 1 NOT NULL,
	"answer" text NOT NULL,
	"grade" jsonb,
	"selected_rating" text,
	"rating_override" text,
	"graded_artifact_id" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_review_attempt_version" CHECK ("algocoach"."coach_review_attempt"."problem_content_version" > 0),
	CONSTRAINT "chk_coach_review_attempt_selected" CHECK ("algocoach"."coach_review_attempt"."selected_rating" is null or "algocoach"."coach_review_attempt"."selected_rating" in ('again', 'hard', 'good', 'easy')),
	CONSTRAINT "chk_coach_review_attempt_override" CHECK ("algocoach"."coach_review_attempt"."rating_override" is null or "algocoach"."coach_review_attempt"."rating_override" in ('again', 'hard', 'good', 'easy'))
);
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" DROP CONSTRAINT "chk_coach_learning_artifact_type";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_product_event" DROP CONSTRAINT "chk_coach_product_event_name";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD COLUMN "kind" text DEFAULT 'practice' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD COLUMN "baseline_assessment_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD COLUMN "average_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD COLUMN "hint_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD COLUMN "error_categories" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD COLUMN "comparison" jsonb;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" ADD COLUMN "review_grade" jsonb;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_correction_episode" ADD CONSTRAINT "coach_correction_episode_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_correction_episode" ADD CONSTRAINT "coach_correction_episode_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_daily_learning_plan" ADD CONSTRAINT "coach_daily_learning_plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_attempt" ADD CONSTRAINT "coach_review_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_attempt" ADD CONSTRAINT "coach_review_attempt_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_correction_episode_user_client" ON "algocoach"."coach_correction_episode" USING btree ("user_id","client_episode_id");--> statement-breakpoint
CREATE INDEX "idx_coach_correction_episode_user_started" ON "algocoach"."coach_correction_episode" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_correction_episode_effect" ON "algocoach"."coach_correction_episode" USING btree ("user_id","resolved","passed_within_three_runs");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_daily_plan_user_client" ON "algocoach"."coach_daily_learning_plan" USING btree ("user_id","client_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_daily_plan_user_date_zone" ON "algocoach"."coach_daily_learning_plan" USING btree ("user_id","local_date","time_zone");--> statement-breakpoint
CREATE INDEX "idx_coach_daily_plan_user_date" ON "algocoach"."coach_daily_learning_plan" USING btree ("user_id","local_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_review_attempt_user_client" ON "algocoach"."coach_review_attempt" USING btree ("user_id","client_attempt_id");--> statement-breakpoint
CREATE INDEX "idx_coach_review_attempt_user_submitted" ON "algocoach"."coach_review_attempt" USING btree ("user_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_review_attempt_problem" ON "algocoach"."coach_review_attempt" USING btree ("user_id","problem_slug_snapshot","problem_content_version");--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD CONSTRAINT "chk_coach_assessment_kind" CHECK ("algocoach"."coach_assessment"."kind" in ('baseline', 'checkpoint', 'practice'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD CONSTRAINT "chk_coach_assessment_average_duration" CHECK ("algocoach"."coach_assessment"."average_duration_ms" is null or "algocoach"."coach_assessment"."average_duration_ms" >= 0);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD CONSTRAINT "chk_coach_assessment_hint_count" CHECK ("algocoach"."coach_assessment"."hint_count" >= 0);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" ADD CONSTRAINT "chk_coach_learning_artifact_type" CHECK ("algocoach"."coach_learning_artifact"."type" in ('parse', 'diagnose', 'hint', 'counterexample', 'review_card', 'review_grade'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_product_event" ADD CONSTRAINT "chk_coach_product_event_name" CHECK ("algocoach"."coach_product_event"."name" in ('activated', 'visitor_started', 'onboarding_started', 'practice_started', 'first_code_run', 'first_problem_passed', 'code_run', 'code_submitted', 'hint_revealed', 'diagnosis_requested', 'corrected_after_diagnosis', 'assessment_started', 'assessment_completed', 'baseline_started', 'baseline_completed', 'checkpoint_completed', 'daily_plan_viewed', 'daily_plan_task_started', 'daily_plan_task_swapped', 'daily_plan_task_skipped', 'daily_plan_task_completed', 'review_answered', 'review_rating_overridden', 'correction_episode_completed', 'counterexample_requested', 'review_card_created', 'review_completed', 'coach_chat_message', 'csat_submitted', 'guest_data_claimed', 'sync_succeeded', 'sync_failed', 'language_selected', 'typescript_transpile_failed', 'experiment_exposed', 'imported_problem_saved', 'catalog_sync_completed', 'catalog_candidate_rejected', 'catalog_revision_published', 'catalog_revision_rolled_back'));
--> statement-breakpoint
CREATE OR REPLACE VIEW "algocoach"."coach_effective_practice_v" AS
SELECT
	run_user."user_id",
	(run_user."executed_at" AT TIME ZONE 'UTC')::date AS "practice_date",
	run_user."problem_slug_snapshot" AS "problem_slug",
	COUNT(*)::integer AS "real_run_count",
	BOOL_OR(run_user."status" = 'passed') AS "passed",
	BOOL_OR(episode."resolved") AS "corrected_after_diagnosis",
	BOOL_OR(review_event."id" IS NOT NULL) AS "due_review_completed"
FROM (
	SELECT run.*, session."user_id"
	FROM "algocoach"."coach_code_run" AS run
	JOIN "algocoach"."coach_practice_session" AS session
		ON session."id" = run."session_id"
	WHERE run."total_tests" > 0
) AS run_user
LEFT JOIN "algocoach"."coach_correction_episode" AS episode
	ON episode."user_id" = run_user."user_id"
	AND episode."problem_slug_snapshot" = run_user."problem_slug_snapshot"
	AND episode."problem_content_version" = run_user."problem_content_version"
	AND episode."resolved" = true
	AND (episode."resolved_at" AT TIME ZONE 'UTC')::date =
		(run_user."executed_at" AT TIME ZONE 'UTC')::date
LEFT JOIN "algocoach"."coach_product_event" AS review_event
	ON review_event."user_id" = run_user."user_id"
	AND review_event."problem_slug_snapshot" = run_user."problem_slug_snapshot"
	AND review_event."name" = 'daily_plan_task_completed'
	AND review_event."properties"->>'completion' = 'due_review'
	AND (review_event."occurred_at" AT TIME ZONE 'UTC')::date =
		(run_user."executed_at" AT TIME ZONE 'UTC')::date
GROUP BY
	run_user."user_id",
	(run_user."executed_at" AT TIME ZONE 'UTC')::date,
	run_user."problem_slug_snapshot"
HAVING
	BOOL_OR(run_user."status" = 'passed')
	OR BOOL_OR(episode."resolved")
	OR BOOL_OR(review_event."id" IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE VIEW "algocoach"."coach_cohort_metric_v" AS
WITH event_metrics AS (
	SELECT
		app_user."id" AS "user_id",
		app_user."created_at" AS "cohort_started_at",
		BOOL_OR(event."name" = 'activated') AS "activated",
		BOOL_OR(event."name" IN ('first_problem_passed', 'corrected_after_diagnosis', 'review_completed')) AS "first_value_reached",
		BOOL_OR((event."occurred_at" AT TIME ZONE 'UTC')::date = (app_user."created_at" AT TIME ZONE 'UTC')::date + 1) AS "retained_d1",
		BOOL_OR((event."occurred_at" AT TIME ZONE 'UTC')::date = (app_user."created_at" AT TIME ZONE 'UTC')::date + 7) AS "retained_d7",
		COUNT(*) FILTER (WHERE event."name" = 'daily_plan_task_completed')::integer AS "daily_plan_tasks_completed"
	FROM "algocoach"."user" AS app_user
	LEFT JOIN "algocoach"."coach_product_event" AS event
		ON event."user_id" = app_user."id"
	GROUP BY app_user."id", app_user."created_at"
), plan_metrics AS (
	SELECT
		plan."user_id",
		COALESCE(SUM(jsonb_array_length(plan."tasks")), 0)::integer AS "daily_plan_tasks_generated"
	FROM "algocoach"."coach_daily_learning_plan" AS plan
	GROUP BY plan."user_id"
), practice_metrics AS (
	SELECT
		effective."user_id",
		COUNT(*)::integer AS "effective_practices",
		COUNT(DISTINCT effective."practice_date")::integer AS "active_practice_days"
	FROM "algocoach"."coach_effective_practice_v" AS effective
	GROUP BY effective."user_id"
), review_metrics AS (
	SELECT
		attempt."user_id",
		COUNT(*)::integer AS "review_attempts",
		AVG(COALESCE((attempt."grade"->>'coverage')::double precision, 0)) AS "review_recall_rate"
	FROM "algocoach"."coach_review_attempt" AS attempt
	WHERE attempt."grade" IS NOT NULL
	GROUP BY attempt."user_id"
), correction_metrics AS (
	SELECT
		episode."user_id",
		COUNT(*)::integer AS "correction_episodes",
		AVG(CASE WHEN episode."passed_within_three_runs" THEN 1.0 ELSE 0.0 END) AS "diagnosis_three_run_pass_rate",
		AVG(episode."repair_duration_ms") FILTER (WHERE episode."resolved") AS "average_repair_duration_ms"
	FROM "algocoach"."coach_correction_episode" AS episode
	GROUP BY episode."user_id"
), checkpoint_metrics AS (
	SELECT
		assessment."user_id",
		AVG((assessment."comparison"->>'scoreDelta')::double precision) AS "checkpoint_score_delta"
	FROM "algocoach"."coach_assessment" AS assessment
	WHERE assessment."kind" = 'checkpoint' AND assessment."comparison" IS NOT NULL
	GROUP BY assessment."user_id"
)
SELECT
	event_metrics."user_id",
	event_metrics."cohort_started_at",
	event_metrics."activated",
	event_metrics."first_value_reached",
	event_metrics."retained_d1",
	event_metrics."retained_d7",
	COALESCE(practice_metrics."effective_practices", 0) AS "effective_practices",
	COALESCE(practice_metrics."active_practice_days", 0) AS "active_practice_days",
	COALESCE(plan_metrics."daily_plan_tasks_generated", 0) AS "daily_plan_tasks_generated",
	event_metrics."daily_plan_tasks_completed",
	CASE
		WHEN COALESCE(plan_metrics."daily_plan_tasks_generated", 0) = 0 THEN 0
		ELSE event_metrics."daily_plan_tasks_completed"::double precision /
			plan_metrics."daily_plan_tasks_generated"
	END AS "daily_plan_completion_rate",
	COALESCE(review_metrics."review_attempts", 0) AS "review_attempts",
	COALESCE(review_metrics."review_recall_rate", 0) AS "review_recall_rate",
	COALESCE(correction_metrics."correction_episodes", 0) AS "correction_episodes",
	COALESCE(correction_metrics."diagnosis_three_run_pass_rate", 0) AS "diagnosis_three_run_pass_rate",
	correction_metrics."average_repair_duration_ms",
	checkpoint_metrics."checkpoint_score_delta"
FROM event_metrics
LEFT JOIN plan_metrics ON plan_metrics."user_id" = event_metrics."user_id"
LEFT JOIN practice_metrics ON practice_metrics."user_id" = event_metrics."user_id"
LEFT JOIN review_metrics ON review_metrics."user_id" = event_metrics."user_id"
LEFT JOIN correction_metrics ON correction_metrics."user_id" = event_metrics."user_id"
LEFT JOIN checkpoint_metrics ON checkpoint_metrics."user_id" = event_metrics."user_id";
