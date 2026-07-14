ALTER TABLE "algocoach"."coach_problem" ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
WITH ranked_imports AS (
	SELECT "id", row_number() OVER (PARTITION BY "owner_user_id" ORDER BY "updated_at" DESC, "id") AS position
	FROM "algocoach"."coach_problem"
	WHERE "owner_user_id" IS NOT NULL AND "source" = 'imported'
)
UPDATE "algocoach"."coach_problem" AS problem
SET "is_active" = true
FROM ranked_imports
WHERE problem."id" = ranked_imports."id" AND ranked_imports.position = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_owner_active" ON "algocoach"."coach_problem" USING btree ("owner_user_id") WHERE "algocoach"."coach_problem"."owner_user_id" is not null and "algocoach"."coach_problem"."is_active" = true;
