CREATE TABLE "algocoach"."coach_review_item" (
	"user_id" text NOT NULL,
	"problem_slug" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"interval_days" integer NOT NULL,
	"repetitions" integer NOT NULL,
	"ease_factor" double precision NOT NULL,
	"last_observed_run_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"last_rating" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chk_coach_review_item_status" CHECK ("algocoach"."coach_review_item"."status" in ('due', 'resolved', 'mastered')),
	CONSTRAINT "chk_coach_review_item_source" CHECK ("algocoach"."coach_review_item"."source" in ('mistake', 'completion')),
	CONSTRAINT "chk_coach_review_item_interval" CHECK ("algocoach"."coach_review_item"."interval_days" between 1 and 365),
	CONSTRAINT "chk_coach_review_item_repetitions" CHECK ("algocoach"."coach_review_item"."repetitions" between 0 and 1000),
	CONSTRAINT "chk_coach_review_item_ease_factor" CHECK ("algocoach"."coach_review_item"."ease_factor" between 1.3 and 3.2),
	CONSTRAINT "chk_coach_review_item_rating" CHECK ("algocoach"."coach_review_item"."last_rating" is null or "algocoach"."coach_review_item"."last_rating" in ('again', 'hard', 'good', 'easy'))
);
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_item" ADD CONSTRAINT "coach_review_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_review_item_user_problem" ON "algocoach"."coach_review_item" USING btree ("user_id","problem_slug");--> statement-breakpoint
CREATE INDEX "idx_coach_review_item_user_due" ON "algocoach"."coach_review_item" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "idx_coach_review_item_user_status" ON "algocoach"."coach_review_item" USING btree ("user_id","status","updated_at" DESC NULLS LAST);