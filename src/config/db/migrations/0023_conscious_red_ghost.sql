CREATE TABLE "algocoach"."coach_anonymous_product_event" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_subject" text NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"problem_slug_snapshot" text,
	"client_sequence" integer DEFAULT 0 NOT NULL,
	"client_generated_total" integer DEFAULT 0 NOT NULL,
	"client_delivered_total" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_guest_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"guest_subject" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"status" text DEFAULT 'acknowledged' NOT NULL,
	"merged_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_guest_claim_status" CHECK ("algocoach"."coach_guest_claim"."status" = 'acknowledged'),
	CONSTRAINT "chk_coach_guest_claim_revision" CHECK ("algocoach"."coach_guest_claim"."merged_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD COLUMN "evidence_mode" text DEFAULT 'browser_local' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_profile" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_attempt" ADD COLUMN "grade_mode" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_attempt" ADD COLUMN "grade_error_code" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_guest_claim" ADD CONSTRAINT "coach_guest_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_anonymous_event_subject_event" ON "algocoach"."coach_anonymous_product_event" USING btree ("guest_subject","event_id");--> statement-breakpoint
CREATE INDEX "idx_coach_anonymous_event_subject_occurred" ON "algocoach"."coach_anonymous_product_event" USING btree ("guest_subject","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_anonymous_event_name_occurred" ON "algocoach"."coach_anonymous_product_event" USING btree ("name","occurred_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_anonymous_product_event" ADD CONSTRAINT "chk_coach_anonymous_event_name" CHECK ("algocoach"."coach_anonymous_product_event"."name" in ('visitor_started', 'onboarding_started', 'activated', 'practice_started', 'first_code_run', 'first_problem_passed', 'code_run', 'code_submitted', 'corrected_after_diagnosis', 'assessment_completed', 'baseline_completed', 'checkpoint_completed', 'daily_plan_task_completed', 'review_completed', 'language_selected', 'typescript_transpile_failed', 'experiment_exposed'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_anonymous_product_event" ADD CONSTRAINT "chk_coach_anonymous_event_checkpoint" CHECK ("algocoach"."coach_anonymous_product_event"."client_sequence" >= 0 and "algocoach"."coach_anonymous_product_event"."client_generated_total" >= 0 and "algocoach"."coach_anonymous_product_event"."client_delivered_total" >= 0 and "algocoach"."coach_anonymous_product_event"."client_delivered_total" <= "algocoach"."coach_anonymous_product_event"."client_generated_total");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_guest_claim_user_claim" ON "algocoach"."coach_guest_claim" USING btree ("user_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_guest_claim_subject" ON "algocoach"."coach_guest_claim" USING btree ("guest_subject");--> statement-breakpoint
CREATE INDEX "idx_coach_guest_claim_subject_created" ON "algocoach"."coach_guest_claim" USING btree ("guest_subject","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD CONSTRAINT "chk_coach_assessment_evidence_mode" CHECK ("algocoach"."coach_assessment"."evidence_mode" in ('browser_local', 'remote_verified'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_profile" ADD CONSTRAINT "chk_coach_learning_profile_time_zone" CHECK (length("algocoach"."coach_learning_profile"."time_zone") between 1 and 100);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_attempt" ADD CONSTRAINT "chk_coach_review_attempt_grade_mode" CHECK ("algocoach"."coach_review_attempt"."grade_mode" in ('ai', 'manual_fallback'));
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_attempt" ADD CONSTRAINT "chk_coach_review_attempt_grade_error" CHECK ("algocoach"."coach_review_attempt"."grade_error_code" is null or "algocoach"."coach_review_attempt"."grade_error_code" in ('configuration', 'access_denied', 'quota', 'rate_limited', 'timeout', 'unavailable', 'invalid_output', 'unknown'));
--> statement-breakpoint
CREATE OR REPLACE VIEW "algocoach"."coach_effective_practice_v" AS
WITH user_zone AS (
	SELECT
		app_user."id" AS "user_id",
		COALESCE(zone."name", 'UTC') AS "time_zone"
	FROM "algocoach"."user" AS app_user
	LEFT JOIN "algocoach"."coach_learning_profile" AS profile
		ON profile."user_id" = app_user."id"
	LEFT JOIN pg_timezone_names AS zone
		ON zone."name" = profile."time_zone"
), run_user AS (
	SELECT run.*, session."user_id", user_zone."time_zone"
	FROM "algocoach"."coach_code_run" AS run
	JOIN "algocoach"."coach_practice_session" AS session
		ON session."id" = run."session_id"
	JOIN user_zone ON user_zone."user_id" = session."user_id"
	WHERE run."total_tests" > 0
)
SELECT
	run_user."user_id",
	(run_user."executed_at" AT TIME ZONE run_user."time_zone")::date AS "practice_date",
	run_user."problem_slug_snapshot" AS "problem_slug",
	COUNT(*)::integer AS "real_run_count",
	BOOL_OR(run_user."status" = 'passed') AS "passed",
	BOOL_OR(episode."resolved") AS "corrected_after_diagnosis",
	BOOL_OR(review_event."id" IS NOT NULL) AS "due_review_completed"
FROM run_user
LEFT JOIN "algocoach"."coach_correction_episode" AS episode
	ON episode."user_id" = run_user."user_id"
	AND episode."problem_slug_snapshot" = run_user."problem_slug_snapshot"
	AND episode."problem_content_version" = run_user."problem_content_version"
	AND episode."resolved" = true
	AND (episode."resolved_at" AT TIME ZONE run_user."time_zone")::date =
		(run_user."executed_at" AT TIME ZONE run_user."time_zone")::date
LEFT JOIN "algocoach"."coach_product_event" AS review_event
	ON review_event."user_id" = run_user."user_id"
	AND review_event."problem_slug_snapshot" = run_user."problem_slug_snapshot"
	AND review_event."name" = 'daily_plan_task_completed'
	AND review_event."properties"->>'completion' = 'due_review'
	AND (review_event."occurred_at" AT TIME ZONE run_user."time_zone")::date =
		(run_user."executed_at" AT TIME ZONE run_user."time_zone")::date
GROUP BY
	run_user."user_id",
	(run_user."executed_at" AT TIME ZONE run_user."time_zone")::date,
	run_user."problem_slug_snapshot"
HAVING
	BOOL_OR(run_user."status" = 'passed')
	OR BOOL_OR(episode."resolved")
	OR BOOL_OR(review_event."id" IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE VIEW "algocoach"."coach_cohort_metric_v" AS
WITH user_zone AS (
	SELECT
		app_user."id" AS "user_id",
		app_user."created_at" AS "cohort_started_at",
		COALESCE(zone."name", 'UTC') AS "time_zone",
		COALESCE(profile."onboarding_completed", false) AS "activated"
	FROM "algocoach"."user" AS app_user
	LEFT JOIN "algocoach"."coach_learning_profile" AS profile
		ON profile."user_id" = app_user."id"
	LEFT JOIN pg_timezone_names AS zone
		ON zone."name" = profile."time_zone"
), learning_activity AS (
	SELECT
		session."user_id",
		run."executed_at" AS "occurred_at",
		(run."status" = 'passed' AND run."test_scope" <> 'sample') AS "first_value"
	FROM "algocoach"."coach_code_run" AS run
	JOIN "algocoach"."coach_practice_session" AS session
		ON session."id" = run."session_id"
	WHERE run."total_tests" > 0
	UNION ALL
	SELECT
		attempt."user_id",
		attempt."submitted_at" AS "occurred_at",
		true AS "first_value"
	FROM "algocoach"."coach_review_attempt" AS attempt
	UNION ALL
	SELECT
		assessment."user_id",
		assessment."completed_at" AS "occurred_at",
		false AS "first_value"
	FROM "algocoach"."coach_assessment" AS assessment
	WHERE assessment."status" = 'completed'
		AND assessment."completed_at" IS NOT NULL
	UNION ALL
	SELECT
		plan."user_id",
		plan."updated_at" AS "occurred_at",
		false AS "first_value"
	FROM "algocoach"."coach_daily_learning_plan" AS plan
	WHERE EXISTS (
		SELECT 1
		FROM jsonb_array_elements(plan."tasks") AS task
		WHERE task->>'status' = 'completed'
	)
), evidence_metrics AS (
	SELECT
		user_zone."user_id",
		user_zone."cohort_started_at",
		user_zone."time_zone",
		user_zone."activated",
		COALESCE(BOOL_OR(activity."first_value"), false) AS "first_value_reached",
		COALESCE(BOOL_OR(
			(activity."occurred_at" AT TIME ZONE user_zone."time_zone")::date =
					(user_zone."cohort_started_at" AT TIME ZONE user_zone."time_zone")::date + 1
		), false) AS "retained_d1",
		COALESCE(BOOL_OR(
			(activity."occurred_at" AT TIME ZONE user_zone."time_zone")::date =
					(user_zone."cohort_started_at" AT TIME ZONE user_zone."time_zone")::date + 7
		), false) AS "retained_d7"
	FROM user_zone
	LEFT JOIN learning_activity AS activity
		ON activity."user_id" = user_zone."user_id"
	GROUP BY
		user_zone."user_id",
		user_zone."cohort_started_at",
		user_zone."time_zone",
		user_zone."activated"
), plan_metrics AS (
	SELECT
		plan."user_id",
		COALESCE(SUM(jsonb_array_length(plan."tasks")), 0)::integer AS "daily_plan_tasks_generated",
		COALESCE(SUM((
			SELECT count(*)
			FROM jsonb_array_elements(plan."tasks") AS task
			WHERE task->>'status' = 'completed'
		)), 0)::integer AS "daily_plan_tasks_completed"
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
	evidence_metrics."user_id",
	evidence_metrics."cohort_started_at",
	evidence_metrics."activated",
	evidence_metrics."first_value_reached",
	evidence_metrics."retained_d1",
	evidence_metrics."retained_d7",
	COALESCE(practice_metrics."effective_practices", 0) AS "effective_practices",
	COALESCE(practice_metrics."active_practice_days", 0) AS "active_practice_days",
	COALESCE(plan_metrics."daily_plan_tasks_generated", 0) AS "daily_plan_tasks_generated",
	COALESCE(plan_metrics."daily_plan_tasks_completed", 0) AS "daily_plan_tasks_completed",
	CASE
		WHEN COALESCE(plan_metrics."daily_plan_tasks_generated", 0) = 0 THEN 0
		ELSE COALESCE(plan_metrics."daily_plan_tasks_completed", 0)::double precision /
			plan_metrics."daily_plan_tasks_generated"
	END AS "daily_plan_completion_rate",
	COALESCE(review_metrics."review_attempts", 0) AS "review_attempts",
	COALESCE(review_metrics."review_recall_rate", 0) AS "review_recall_rate",
	COALESCE(correction_metrics."correction_episodes", 0) AS "correction_episodes",
	COALESCE(correction_metrics."diagnosis_three_run_pass_rate", 0) AS "diagnosis_three_run_pass_rate",
	correction_metrics."average_repair_duration_ms",
	checkpoint_metrics."checkpoint_score_delta",
	evidence_metrics."time_zone",
	((now() AT TIME ZONE evidence_metrics."time_zone")::date >=
		(evidence_metrics."cohort_started_at" AT TIME ZONE evidence_metrics."time_zone")::date + 1) AS "eligible_d1",
	((now() AT TIME ZONE evidence_metrics."time_zone")::date >=
		(evidence_metrics."cohort_started_at" AT TIME ZONE evidence_metrics."time_zone")::date + 7) AS "eligible_d7"
FROM evidence_metrics
LEFT JOIN plan_metrics ON plan_metrics."user_id" = evidence_metrics."user_id"
LEFT JOIN practice_metrics ON practice_metrics."user_id" = evidence_metrics."user_id"
LEFT JOIN review_metrics ON review_metrics."user_id" = evidence_metrics."user_id"
LEFT JOIN correction_metrics ON correction_metrics."user_id" = evidence_metrics."user_id"
LEFT JOIN checkpoint_metrics ON checkpoint_metrics."user_id" = evidence_metrics."user_id";
