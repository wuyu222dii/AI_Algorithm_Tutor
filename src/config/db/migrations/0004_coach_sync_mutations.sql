CREATE TABLE "algocoach"."coach_sync_mutation" (
	"user_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"result_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_sync_mutation_result_revision" CHECK ("algocoach"."coach_sync_mutation"."result_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_sync_mutation" ADD CONSTRAINT "coach_sync_mutation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "algocoach"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_sync_mutation_user_id" ON "algocoach"."coach_sync_mutation" USING btree ("user_id","mutation_id");
--> statement-breakpoint
CREATE INDEX "idx_coach_sync_mutation_user_created" ON "algocoach"."coach_sync_mutation" USING btree ("user_id","created_at" DESC NULLS LAST);
