CREATE SCHEMA IF NOT EXISTS "algocoach";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "algocoach" FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE "algocoach"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "algocoach"."ai_task" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"media_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"options" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"task_id" text,
	"task_info" text,
	"task_result" text,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"scene" text DEFAULT '' NOT NULL,
	"credit_id" text
);
--> statement-breakpoint
CREATE TABLE "algocoach"."apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "algocoach"."chat" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"parts" text NOT NULL,
	"metadata" text,
	"content" text
);
--> statement-breakpoint
CREATE TABLE "algocoach"."chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"role" text NOT NULL,
	"parts" text NOT NULL,
	"metadata" text,
	"model" text NOT NULL,
	"provider" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_assessment" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"problem_slugs" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"duration_minutes" smallint DEFAULT 20 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"score" smallint,
	"correct_count" smallint,
	"total_count" smallint,
	"weak_topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"recommendation" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_assessment_status" CHECK ("algocoach"."coach_assessment"."status" in ('active', 'completed', 'abandoned')),
	CONSTRAINT "chk_coach_assessment_duration" CHECK ("algocoach"."coach_assessment"."duration_minutes" between 1 and 180),
	CONSTRAINT "chk_coach_assessment_score" CHECK ("algocoach"."coach_assessment"."score" is null or "algocoach"."coach_assessment"."score" between 0 and 100),
	CONSTRAINT "chk_coach_assessment_counts" CHECK (("algocoach"."coach_assessment"."correct_count" is null and "algocoach"."coach_assessment"."total_count" is null) or ("algocoach"."coach_assessment"."correct_count" >= 0 and "algocoach"."coach_assessment"."total_count" >= 0 and "algocoach"."coach_assessment"."correct_count" <= "algocoach"."coach_assessment"."total_count"))
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_code_run" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"problem_id" text,
	"problem_slug_snapshot" text NOT NULL,
	"language" text NOT NULL,
	"code_snapshot" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"passed_tests" smallint NOT NULL,
	"total_tests" smallint NOT NULL,
	"test_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"console" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"duration_ms" integer NOT NULL,
	"test_scope" text DEFAULT 'unknown' NOT NULL,
	"submitted" boolean DEFAULT false NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chk_coach_code_run_language" CHECK ("algocoach"."coach_code_run"."language" in ('javascript', 'python')),
	CONSTRAINT "chk_coach_code_run_status" CHECK ("algocoach"."coach_code_run"."status" in ('passed', 'failed', 'syntax_error', 'runtime_error', 'timeout')),
	CONSTRAINT "chk_coach_code_run_counts" CHECK ("algocoach"."coach_code_run"."passed_tests" >= 0 and "algocoach"."coach_code_run"."total_tests" >= 0 and "algocoach"."coach_code_run"."passed_tests" <= "algocoach"."coach_code_run"."total_tests"),
	CONSTRAINT "chk_coach_code_run_duration" CHECK ("algocoach"."coach_code_run"."duration_ms" >= 0),
	CONSTRAINT "chk_coach_code_run_test_scope" CHECK ("algocoach"."coach_code_run"."test_scope" in ('sample', 'full', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_learning_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"problem_id" text,
	"run_id" text,
	"problem_slug_snapshot" text,
	"type" text NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_action" text,
	"diagnosis_category" text,
	"hint" jsonb,
	"counterexample" jsonb,
	"review_card" jsonb,
	"draft" jsonb,
	"generation_mode" text DEFAULT 'live' NOT NULL,
	"model" text,
	"prompt_version" text,
	"trace_id" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_learning_artifact_type" CHECK ("algocoach"."coach_learning_artifact"."type" in ('parse', 'diagnose', 'hint', 'counterexample', 'review_card')),
	CONSTRAINT "chk_coach_learning_artifact_locale" CHECK ("algocoach"."coach_learning_artifact"."locale" in ('zh', 'en')),
	CONSTRAINT "chk_coach_learning_artifact_diagnosis" CHECK ("algocoach"."coach_learning_artifact"."diagnosis_category" is null or "algocoach"."coach_learning_artifact"."diagnosis_category" in ('syntax', 'runtime', 'timeout', 'wrong-answer', 'edge-case', 'unknown')),
	CONSTRAINT "chk_coach_learning_artifact_generation_mode" CHECK ("algocoach"."coach_learning_artifact"."generation_mode" in ('live', 'local')),
	CONSTRAINT "chk_coach_learning_artifact_latency" CHECK ("algocoach"."coach_learning_artifact"."latency_ms" is null or "algocoach"."coach_learning_artifact"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_learning_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"goal" text NOT NULL,
	"preferred_language" text NOT NULL,
	"weekly_target" smallint DEFAULT 5 NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"hint_experiment_variant" text,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_learning_profile_goal" CHECK ("algocoach"."coach_learning_profile"."goal" in ('foundation', 'interview', 'contest')),
	CONSTRAINT "chk_coach_learning_profile_language" CHECK ("algocoach"."coach_learning_profile"."preferred_language" in ('javascript', 'python')),
	CONSTRAINT "chk_coach_learning_profile_weekly_target" CHECK ("algocoach"."coach_learning_profile"."weekly_target" between 1 and 14),
	CONSTRAINT "chk_coach_learning_profile_experiment" CHECK ("algocoach"."coach_learning_profile"."hint_experiment_variant" is null or "algocoach"."coach_learning_profile"."hint_experiment_variant" in ('A', 'B'))
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_practice_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"problem_id" text,
	"problem_slug_snapshot" text NOT NULL,
	"code" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hint_level" smallint DEFAULT 0 NOT NULL,
	"diagnosis_count" integer DEFAULT 0 NOT NULL,
	"corrected_after_diagnosis" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "chk_coach_practice_session_hint_level" CHECK ("algocoach"."coach_practice_session"."hint_level" between 0 and 3),
	CONSTRAINT "chk_coach_practice_session_diagnosis_count" CHECK ("algocoach"."coach_practice_session"."diagnosis_count" >= 0),
	CONSTRAINT "chk_coach_practice_session_status" CHECK ("algocoach"."coach_practice_session"."status" in ('active', 'completed', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_problem" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"owner_user_id" text,
	"source" text NOT NULL,
	"title" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"difficulty" text NOT NULL,
	"topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"entry_point" text NOT NULL,
	"templates" jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hints" jsonb NOT NULL,
	"review_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_minutes" smallint DEFAULT 20 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"source_statement" text,
	"content_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_problem_source" CHECK ("algocoach"."coach_problem"."source" in ('curated', 'imported')),
	CONSTRAINT "chk_coach_problem_difficulty" CHECK ("algocoach"."coach_problem"."difficulty" in ('easy', 'medium', 'hard')),
	CONSTRAINT "chk_coach_problem_status" CHECK ("algocoach"."coach_problem"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "chk_coach_problem_estimated_minutes" CHECK ("algocoach"."coach_problem"."estimated_minutes" between 1 and 180)
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_product_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"problem_id" text,
	"problem_slug_snapshot" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"experiment_variant" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_product_event_name" CHECK ("algocoach"."coach_product_event"."name" in ('activated', 'practice_started', 'code_run', 'code_submitted', 'hint_revealed', 'diagnosis_requested', 'corrected_after_diagnosis', 'assessment_started', 'assessment_completed', 'counterexample_requested', 'review_card_created', 'coach_chat_message', 'csat_submitted')),
	CONSTRAINT "chk_coach_product_event_experiment" CHECK ("algocoach"."coach_product_event"."experiment_variant" is null or "algocoach"."coach_product_event"."experiment_variant" in ('A', 'B'))
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_test_case" (
	"id" text PRIMARY KEY NOT NULL,
	"problem_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"args" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"label" jsonb,
	"timeout_ms" integer DEFAULT 3000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_test_case_ordinal" CHECK ("algocoach"."coach_test_case"."ordinal" >= 0),
	CONSTRAINT "chk_coach_test_case_args_array" CHECK (jsonb_typeof("algocoach"."coach_test_case"."args") = 'array'),
	CONSTRAINT "chk_coach_test_case_timeout" CHECK ("algocoach"."coach_test_case"."timeout_ms" between 100 and 10000)
);
--> statement-breakpoint
CREATE TABLE "algocoach"."config" (
	"name" text NOT NULL,
	"value" text,
	CONSTRAINT "config_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."credit" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"order_no" text,
	"subscription_no" text,
	"transaction_no" text NOT NULL,
	"transaction_type" text NOT NULL,
	"transaction_scene" text,
	"credits" integer NOT NULL,
	"remaining_credits" integer DEFAULT 0 NOT NULL,
	"description" text,
	"expires_at" timestamp,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"consumed_detail" text,
	"metadata" text,
	CONSTRAINT "credit_transaction_no_unique" UNIQUE("transaction_no")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."order" (
	"id" text PRIMARY KEY NOT NULL,
	"order_no" text NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"status" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"product_id" text,
	"payment_type" text,
	"payment_interval" text,
	"payment_provider" text NOT NULL,
	"payment_session_id" text,
	"checkout_info" text NOT NULL,
	"checkout_result" text,
	"payment_result" text,
	"discount_code" text,
	"discount_amount" integer,
	"discount_currency" text,
	"payment_email" text,
	"payment_amount" integer,
	"payment_currency" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"description" text,
	"product_name" text,
	"subscription_id" text,
	"subscription_result" text,
	"checkout_url" text,
	"callback_url" text,
	"credits_amount" integer,
	"credits_valid_days" integer,
	"plan_name" text,
	"payment_product_id" text,
	"invoice_id" text,
	"invoice_url" text,
	"subscription_no" text,
	"transaction_id" text,
	"payment_user_name" text,
	"payment_user_id" text,
	CONSTRAINT "order_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."permission" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "permission_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."post" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"description" text,
	"image" text,
	"content" text,
	"categories" text,
	"tags" text,
	"author_name" text,
	"author_image" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "post_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."role" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "role_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."role_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "algocoach"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_no" text NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"status" text NOT NULL,
	"payment_provider" text NOT NULL,
	"subscription_id" text NOT NULL,
	"subscription_result" text,
	"product_id" text,
	"description" text,
	"amount" integer,
	"currency" text,
	"interval" text,
	"interval_count" integer,
	"trial_period_days" integer,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"plan_name" text,
	"billing_url" text,
	"product_name" text,
	"credits_amount" integer,
	"credits_valid_days" integer,
	"payment_product_id" text,
	"payment_user_id" text,
	"canceled_at" timestamp,
	"canceled_end_at" timestamp,
	"canceled_reason" text,
	"canceled_reason_type" text,
	CONSTRAINT "subscription_subscription_no_unique" UNIQUE("subscription_no")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."taxonomy" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"image" text,
	"icon" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "taxonomy_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"utm_source" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT '' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "algocoach"."user_role" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "algocoach"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "algocoach"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."ai_task" ADD CONSTRAINT "ai_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."chat_message" ADD CONSTRAINT "chat_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."chat_message" ADD CONSTRAINT "chat_message_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "algocoach"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_assessment" ADD CONSTRAINT "coach_assessment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" ADD CONSTRAINT "coach_code_run_session_id_coach_practice_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "algocoach"."coach_practice_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_code_run" ADD CONSTRAINT "coach_code_run_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" ADD CONSTRAINT "coach_learning_artifact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" ADD CONSTRAINT "coach_learning_artifact_session_id_coach_practice_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "algocoach"."coach_practice_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" ADD CONSTRAINT "coach_learning_artifact_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_artifact" ADD CONSTRAINT "coach_learning_artifact_run_id_coach_code_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "algocoach"."coach_code_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_learning_profile" ADD CONSTRAINT "coach_learning_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_practice_session" ADD CONSTRAINT "coach_practice_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_practice_session" ADD CONSTRAINT "coach_practice_session_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem" ADD CONSTRAINT "coach_problem_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_product_event" ADD CONSTRAINT "coach_product_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_product_event" ADD CONSTRAINT "coach_product_event_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD CONSTRAINT "coach_test_case_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."credit" ADD CONSTRAINT "credit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."order" ADD CONSTRAINT "order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."post" ADD CONSTRAINT "post_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "algocoach"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."role_permission" ADD CONSTRAINT "role_permission_permission_id_permission_id_fk" FOREIGN KEY ("permission_id") REFERENCES "algocoach"."permission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."subscription" ADD CONSTRAINT "subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."taxonomy" ADD CONSTRAINT "taxonomy_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."user_role" ADD CONSTRAINT "user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "algocoach"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_user_id" ON "algocoach"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_account_provider_account" ON "algocoach"."account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "idx_ai_task_user_media_type" ON "algocoach"."ai_task" USING btree ("user_id","media_type");--> statement-breakpoint
CREATE INDEX "idx_ai_task_media_type_status" ON "algocoach"."ai_task" USING btree ("media_type","status");--> statement-breakpoint
CREATE INDEX "idx_apikey_user_status" ON "algocoach"."apikey" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_apikey_key_status" ON "algocoach"."apikey" USING btree ("key","status");--> statement-breakpoint
CREATE INDEX "idx_chat_user_status" ON "algocoach"."chat" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_chat_message_chat_id" ON "algocoach"."chat_message" USING btree ("chat_id","status");--> statement-breakpoint
CREATE INDEX "idx_chat_message_user_id" ON "algocoach"."chat_message" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_coach_assessment_user_started" ON "algocoach"."coach_assessment" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_assessment_user_completed" ON "algocoach"."coach_assessment" USING btree ("user_id","completed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_code_run_session_executed" ON "algocoach"."coach_code_run" USING btree ("session_id","executed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_code_run_session_submitted" ON "algocoach"."coach_code_run" USING btree ("session_id","submitted","executed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_learning_artifact_trace" ON "algocoach"."coach_learning_artifact" USING btree ("trace_id") WHERE "algocoach"."coach_learning_artifact"."trace_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_coach_learning_artifact_user_created" ON "algocoach"."coach_learning_artifact" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_learning_artifact_user_type" ON "algocoach"."coach_learning_artifact" USING btree ("user_id","type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_learning_artifact_problem_type" ON "algocoach"."coach_learning_artifact" USING btree ("problem_id","type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_practice_session_user_problem" ON "algocoach"."coach_practice_session" USING btree ("user_id","problem_slug_snapshot");--> statement-breakpoint
CREATE INDEX "idx_coach_practice_session_user_updated" ON "algocoach"."coach_practice_session" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_practice_session_user_completed" ON "algocoach"."coach_practice_session" USING btree ("user_id","completed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_curated_slug" ON "algocoach"."coach_problem" USING btree ("slug") WHERE "algocoach"."coach_problem"."owner_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_owner_slug" ON "algocoach"."coach_problem" USING btree ("owner_user_id","slug") WHERE "algocoach"."coach_problem"."owner_user_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_coach_problem_status_difficulty" ON "algocoach"."coach_problem" USING btree ("status","difficulty");--> statement-breakpoint
CREATE INDEX "idx_coach_problem_topics" ON "algocoach"."coach_problem" USING gin ("topics");--> statement-breakpoint
CREATE INDEX "idx_coach_problem_owner_updated" ON "algocoach"."coach_problem" USING btree ("owner_user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_product_event_user_occurred" ON "algocoach"."coach_product_event" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_product_event_name_occurred" ON "algocoach"."coach_product_event" USING btree ("name","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_product_event_problem_name" ON "algocoach"."coach_product_event" USING btree ("problem_id","name","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_product_event_session_occurred" ON "algocoach"."coach_product_event" USING btree ("session_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_test_case_problem_ordinal" ON "algocoach"."coach_test_case" USING btree ("problem_id","ordinal");--> statement-breakpoint
CREATE INDEX "idx_coach_test_case_problem_sample" ON "algocoach"."coach_test_case" USING btree ("problem_id","is_sample","ordinal");--> statement-breakpoint
CREATE INDEX "idx_credit_consume_fifo" ON "algocoach"."credit" USING btree ("user_id","status","transaction_type","remaining_credits","expires_at");--> statement-breakpoint
CREATE INDEX "idx_credit_order_no" ON "algocoach"."credit" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "idx_credit_subscription_no" ON "algocoach"."credit" USING btree ("subscription_no");--> statement-breakpoint
CREATE INDEX "idx_order_user_status_payment_type" ON "algocoach"."order" USING btree ("user_id","status","payment_type");--> statement-breakpoint
CREATE INDEX "idx_order_transaction_provider" ON "algocoach"."order" USING btree ("transaction_id","payment_provider");--> statement-breakpoint
CREATE INDEX "idx_order_created_at" ON "algocoach"."order" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_permission_resource_action" ON "algocoach"."permission" USING btree ("resource","action");--> statement-breakpoint
CREATE INDEX "idx_post_type_status" ON "algocoach"."post" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "idx_role_status" ON "algocoach"."role" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_role_permission_role_permission" ON "algocoach"."role_permission" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX "idx_session_user_expires" ON "algocoach"."session" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_subscription_user_status_interval" ON "algocoach"."subscription" USING btree ("user_id","status","interval");--> statement-breakpoint
CREATE INDEX "idx_subscription_provider_id" ON "algocoach"."subscription" USING btree ("subscription_id","payment_provider");--> statement-breakpoint
CREATE INDEX "idx_subscription_created_at" ON "algocoach"."subscription" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_taxonomy_type_status" ON "algocoach"."taxonomy" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "idx_user_name" ON "algocoach"."user" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_user_created_at" ON "algocoach"."user" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_user_role_user_expires" ON "algocoach"."user_role" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_verification_identifier" ON "algocoach"."verification" USING btree ("identifier");
