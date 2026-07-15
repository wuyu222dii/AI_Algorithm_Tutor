CREATE SEQUENCE "algocoach"."coach_catalog_problem_draft_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 21 CACHE 1;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "algocoach"."coach_problem_candidate"
		GROUP BY "source_id", "external_id", "raw_content_hash"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Duplicate immutable catalog candidate evidence must be resolved before migration';
	END IF;
END $$;--> statement-breakpoint
DROP INDEX "algocoach"."uq_coach_problem_candidate_content";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_problem_candidate_raw_content" ON "algocoach"."coach_problem_candidate" USING btree ("source_id","external_id","raw_content_hash");--> statement-breakpoint
SELECT setval(
	'"algocoach"."coach_catalog_problem_draft_id_seq"'::regclass,
	GREATEST(
		20,
		COALESCE((
			SELECT max(substring("normalized_problem"#>>'{problem,id}' from 4)::bigint)
			FROM "algocoach"."coach_problem_candidate"
			WHERE "normalized_problem"#>>'{problem,id}' ~ '^ex-[0-9]{3,6}$'
		), 0)
	),
	true
);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'algocoach_catalog_reviewer') THEN
		GRANT USAGE, SELECT ON SEQUENCE "algocoach"."coach_catalog_problem_draft_id_seq"
			TO "algocoach_catalog_reviewer";
	END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."coach_prevent_rejected_candidate_reopen"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, algocoach
AS $$
BEGIN
	IF OLD."status" = 'rejected' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
		RAISE EXCEPTION 'Rejected catalog candidates cannot be reopened';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "coach_prevent_rejected_candidate_reopen" ON "algocoach"."coach_problem_candidate";
--> statement-breakpoint
CREATE TRIGGER "coach_prevent_rejected_candidate_reopen"
BEFORE UPDATE ON "algocoach"."coach_problem_candidate"
FOR EACH ROW
EXECUTE FUNCTION "algocoach"."coach_prevent_rejected_candidate_reopen"();
