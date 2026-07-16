CREATE TABLE "algocoach"."coach_ai_request_metric" (
	"trace_id" text PRIMARY KEY NOT NULL,
	"surface" text NOT NULL,
	"action" text NOT NULL,
	"mode" text DEFAULT 'live' NOT NULL,
	"status" text NOT NULL,
	"relay_origin" text,
	"selected_model" text,
	"fallback_from" text,
	"attempts" smallint DEFAULT 1 NOT NULL,
	"error_code" text,
	"latency_ms" integer NOT NULL,
	"usage_reported" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"estimated_cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_ai_metric_surface" CHECK ("algocoach"."coach_ai_request_metric"."surface" in ('artifact', 'chat', 'catalog_draft', 'canary', 'eval')),
	CONSTRAINT "chk_coach_ai_metric_mode" CHECK ("algocoach"."coach_ai_request_metric"."mode" in ('live', 'local')),
	CONSTRAINT "chk_coach_ai_metric_status" CHECK ("algocoach"."coach_ai_request_metric"."status" in ('succeeded', 'failed', 'cancelled')),
	CONSTRAINT "chk_coach_ai_metric_attempts" CHECK ("algocoach"."coach_ai_request_metric"."attempts" >= 0),
	CONSTRAINT "chk_coach_ai_metric_latency" CHECK ("algocoach"."coach_ai_request_metric"."latency_ms" >= 0),
	CONSTRAINT "chk_coach_ai_metric_tokens" CHECK (("algocoach"."coach_ai_request_metric"."input_tokens" is null or "algocoach"."coach_ai_request_metric"."input_tokens" >= 0) and ("algocoach"."coach_ai_request_metric"."output_tokens" is null or "algocoach"."coach_ai_request_metric"."output_tokens" >= 0) and ("algocoach"."coach_ai_request_metric"."total_tokens" is null or "algocoach"."coach_ai_request_metric"."total_tokens" >= 0)),
	CONSTRAINT "chk_coach_ai_metric_cost" CHECK ("algocoach"."coach_ai_request_metric"."estimated_cost_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_coach_ai_metric_created" ON "algocoach"."coach_ai_request_metric" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_ai_metric_status_created" ON "algocoach"."coach_ai_request_metric" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_coach_ai_metric_model_created" ON "algocoach"."coach_ai_request_metric" USING btree ("selected_model","created_at" DESC NULLS LAST);
