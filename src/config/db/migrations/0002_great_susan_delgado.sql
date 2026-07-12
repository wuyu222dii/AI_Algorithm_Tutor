CREATE TABLE "algocoach"."coach_sync_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_sync_state_revision" CHECK ("algocoach"."coach_sync_state"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_sync_state" ADD CONSTRAINT "coach_sync_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;