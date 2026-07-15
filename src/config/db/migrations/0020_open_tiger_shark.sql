CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_catalog_admin_mutation" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone DEFAULT now() + interval '5 minutes' NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_catalog_admin_mutation_action" CHECK ("algocoach"."coach_catalog_admin_mutation"."action" in ('update_draft', 'validate', 'approve', 'reject', 'publish', 'rollback', 'bootstrap')),
	CONSTRAINT "chk_coach_catalog_admin_mutation_target" CHECK ("algocoach"."coach_catalog_admin_mutation"."target_type" in ('candidate', 'problem', 'revision', 'catalog')),
	CONSTRAINT "chk_coach_catalog_admin_mutation_status" CHECK ("algocoach"."coach_catalog_admin_mutation"."status" in ('claimed', 'completed', 'failed')),
	CONSTRAINT "chk_coach_catalog_admin_mutation_attempt_count" CHECK ("algocoach"."coach_catalog_admin_mutation"."attempt_count" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "algocoach"."coach_catalog_ai_generation" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"actor_user_id" text,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_coach_catalog_ai_kind" CHECK ("algocoach"."coach_catalog_ai_generation"."kind" in ('translation', 'topic_mapping', 'difficulty', 'review_summary')),
	CONSTRAINT "chk_coach_catalog_ai_status" CHECK ("algocoach"."coach_catalog_ai_generation"."status" in ('generated', 'accepted', 'rejected'))
);
--> statement-breakpoint
DROP INDEX "algocoach"."uq_coach_review_item_user_problem";--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD COLUMN "source_revision" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD COLUMN "draft_hash" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD COLUMN "draft_revision" integer;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD COLUMN "policy_version" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "raw_content_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "draft" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "draft_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "draft_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "policy_version" text DEFAULT 'catalog-policy-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "change_kind" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "target_problem_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "approved_content_hash" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "approved_source_revision" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "approved_draft_hash" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "approved_draft_revision" integer;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "approved_policy_version" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "published_by_user_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "candidate_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "catalog_source_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "source_external_id" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "source_statement_path" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "source_license_spdx" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "source_license_hash" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "source_attribution" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "source_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "policy_version" text DEFAULT 'catalog-policy-legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "draft_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "draft_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD COLUMN "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_item" ADD COLUMN "problem_content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD COLUMN "source_kind" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD COLUMN "source_test_uuid" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_admin_mutation" ADD CONSTRAINT "coach_catalog_admin_mutation_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "algocoach"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_ai_generation" ADD CONSTRAINT "coach_catalog_ai_generation_candidate_id_coach_problem_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "algocoach"."coach_problem_candidate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_ai_generation" ADD CONSTRAINT "coach_catalog_ai_generation_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "algocoach"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_catalog_admin_mutation_actor_key" ON "algocoach"."coach_catalog_admin_mutation" USING btree ("actor_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_coach_catalog_admin_mutation_status" ON "algocoach"."coach_catalog_admin_mutation" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "idx_coach_catalog_ai_candidate_created" ON "algocoach"."coach_catalog_ai_generation" USING btree ("candidate_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "coach_problem_candidate_target_problem_id_coach_problem_id_fk" FOREIGN KEY ("target_problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "coach_problem_candidate_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "algocoach"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "coach_problem_candidate_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "algocoach"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD CONSTRAINT "coach_problem_revision_candidate_id_coach_problem_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "algocoach"."coach_problem_candidate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD CONSTRAINT "coach_problem_revision_catalog_source_id_coach_catalog_source_id_fk" FOREIGN KEY ("catalog_source_id") REFERENCES "algocoach"."coach_catalog_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_coach_problem_candidate_target" ON "algocoach"."coach_problem_candidate" USING btree ("target_problem_id");--> statement-breakpoint
CREATE INDEX "idx_coach_problem_revision_candidate" ON "algocoach"."coach_problem_revision" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coach_review_item_user_problem" ON "algocoach"."coach_review_item" USING btree ("user_id","problem_slug","problem_content_version");--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "chk_coach_problem_candidate_draft_revision" CHECK ("algocoach"."coach_problem_candidate"."draft_revision" > 0);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "chk_coach_problem_candidate_change_kind" CHECK ("algocoach"."coach_problem_candidate"."change_kind" in ('new', 'content_update', 'translation_update', 'metadata_update'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "chk_coach_problem_candidate_distinct_actors" CHECK ("algocoach"."coach_problem_candidate"."published_by_user_id" is null or "algocoach"."coach_problem_candidate"."approved_by_user_id" is null or "algocoach"."coach_problem_candidate"."published_by_user_id" <> "algocoach"."coach_problem_candidate"."approved_by_user_id");--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_revision" ADD CONSTRAINT "chk_coach_problem_revision_draft_revision" CHECK ("algocoach"."coach_problem_revision"."draft_revision" > 0);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_review_item" ADD CONSTRAINT "chk_coach_review_item_version" CHECK ("algocoach"."coach_review_item"."problem_content_version" > 0);--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD CONSTRAINT "chk_coach_test_case_source_kind" CHECK ("algocoach"."coach_test_case"."source_kind" in ('canonical', 'manual', 'legacy'));--> statement-breakpoint
ALTER TABLE "algocoach"."coach_test_case" ADD CONSTRAINT "chk_coach_test_case_source_evidence" CHECK (("algocoach"."coach_test_case"."source_kind" = 'canonical' and "algocoach"."coach_test_case"."source_test_uuid" is not null) or ("algocoach"."coach_test_case"."source_kind" = 'manual' and nullif(btrim("algocoach"."coach_test_case"."review_note"), '') is not null) or "algocoach"."coach_test_case"."source_kind" = 'legacy');
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" DROP CONSTRAINT "chk_coach_problem_candidate_status";
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_problem_candidate" ADD CONSTRAINT "chk_coach_problem_candidate_status" CHECK ("algocoach"."coach_problem_candidate"."status" in ('discovered', 'drafting', 'quarantined', 'validated', 'approved', 'rejected', 'published', 'archived'));
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" DROP CONSTRAINT "coach_catalog_review_audit_candidate_id_coach_problem_candidate_id_fk", DROP CONSTRAINT "coach_catalog_review_audit_problem_id_coach_problem_id_fk", DROP CONSTRAINT "coach_catalog_review_audit_revision_id_coach_problem_revision_id_fk", DROP CONSTRAINT "coach_catalog_review_audit_reviewer_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD CONSTRAINT "coach_catalog_review_audit_candidate_id_coach_problem_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "algocoach"."coach_problem_candidate"("id") ON DELETE restrict ON UPDATE no action, ADD CONSTRAINT "coach_catalog_review_audit_problem_id_coach_problem_id_fk" FOREIGN KEY ("problem_id") REFERENCES "algocoach"."coach_problem"("id") ON DELETE restrict ON UPDATE no action, ADD CONSTRAINT "coach_catalog_review_audit_revision_id_coach_problem_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "algocoach"."coach_problem_revision"("id") ON DELETE restrict ON UPDATE no action, ADD CONSTRAINT "coach_catalog_review_audit_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "algocoach"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" DROP CONSTRAINT "chk_coach_catalog_review_action";
--> statement-breakpoint
ALTER TABLE "algocoach"."coach_catalog_review_audit" ADD CONSTRAINT "chk_coach_catalog_review_action" CHECK ("algocoach"."coach_catalog_review_audit"."action" in ('submitted', 'draft_updated', 'approved', 'rejected', 'published', 'archived', 'rolled_back'));
--> statement-breakpoint
UPDATE "algocoach"."coach_problem_candidate"
SET
	"raw_payload" = COALESCE("normalized_problem"->'upstream', '{}'::jsonb),
	"raw_content_hash" = COALESCE("normalized_problem"#>>'{upstream,statementHash}', "content_hash"),
	"draft" = COALESCE("normalized_problem"->'problem', '{}'::jsonb),
	"draft_hash" = COALESCE("normalized_problem"#>>'{problem,origin,contentHash}', "content_hash"),
	"draft_revision" = 1,
	"policy_version" = 'catalog-policy-v1';
--> statement-breakpoint
UPDATE "algocoach"."coach_problem_candidate" AS candidate
SET
	"target_problem_id" = origin."problem_id",
	"change_kind" = CASE WHEN candidate."status" = 'published' THEN 'content_update' ELSE candidate."change_kind" END
FROM "algocoach"."coach_problem_origin" AS origin
WHERE origin."source_id" = candidate."source_id"
		AND origin."external_id" = candidate."external_id";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_coach_problem_revision_immutable" ON "algocoach"."coach_problem_revision";
--> statement-breakpoint
UPDATE "algocoach"."coach_problem_revision" AS revision
SET
	"candidate_id" = candidate."id",
	"catalog_source_id" = candidate."source_id",
	"source_external_id" = candidate."external_id",
	"source_statement_path" = candidate."normalized_problem"#>>'{problem,origin,statementPath}',
	"source_license_spdx" = candidate."license_spdx",
	"source_attribution" = candidate."attribution",
	"source_fetched_at" = candidate."created_at",
	"policy_version" = candidate."policy_version",
	"draft_revision" = candidate."draft_revision",
	"draft_hash" = candidate."draft_hash",
	"provenance" = jsonb_build_object(
		'candidateId', candidate."id",
		'sourceId', candidate."source_id",
		'externalId', candidate."external_id",
		'upstreamUrl', candidate."upstream_url",
		'sourceRevision', candidate."source_revision",
		'licenseSpdx', candidate."license_spdx",
		'attribution', candidate."attribution",
		'policyVersion', candidate."policy_version",
		'draftRevision', candidate."draft_revision",
		'draftHash', candidate."draft_hash"
	)
FROM "algocoach"."coach_problem_candidate" AS candidate
WHERE revision."content_hash" = candidate."content_hash"
	AND revision."source_revision" = candidate."source_revision"
	AND revision."candidate_id" IS NULL;
--> statement-breakpoint
UPDATE "algocoach"."coach_problem_revision" AS revision
SET
	"catalog_source_id" = COALESCE(revision."catalog_source_id", origin."source_id"),
	"source_external_id" = COALESCE(revision."source_external_id", origin."external_id"),
	"source_statement_path" = COALESCE(revision."source_statement_path", 'exercises/' || origin."external_id" || '/description.md'),
	"source_license_spdx" = COALESCE(revision."source_license_spdx", origin."license_spdx"),
	"source_attribution" = COALESCE(revision."source_attribution", origin."attribution"),
	"source_fetched_at" = COALESCE(revision."source_fetched_at", origin."fetched_at"),
	"provenance" = revision."provenance" || jsonb_build_object(
		'sourceId', origin."source_id",
		'externalId', origin."external_id",
		'upstreamUrl', origin."upstream_url",
		'sourceRevision', origin."source_revision",
		'licenseSpdx', origin."license_spdx",
		'attribution', origin."attribution",
		'fetchedAt', origin."fetched_at"
	)
FROM "algocoach"."coach_problem_origin" AS origin
WHERE revision."problem_id" = origin."problem_id";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_coach_test_case_immutable" ON "algocoach"."coach_test_case";
--> statement-breakpoint
UPDATE "algocoach"."coach_test_case" AS test_case
SET
	"source_kind" = 'manual',
	"review_note" = 'Legacy reviewed catalog adaptation; canonical UUID mapping was not recorded.'
FROM "algocoach"."coach_problem_revision" AS revision
WHERE test_case."revision_id" = revision."id"
		AND revision."candidate_id" IS NOT NULL
		AND test_case."source_kind" = 'legacy';
--> statement-breakpoint
-- Supabase-managed migrators can create capability roles but may not mutate
-- their authentication settings afterward, so existing roles are validated.
DO $$
DECLARE
	capability_role_name text;
	capability_role record;
BEGIN
	FOREACH capability_role_name IN ARRAY ARRAY[
		'algocoach_application',
		'algocoach_catalog_sync',
		'algocoach_catalog_reviewer',
		'algocoach_catalog_publisher'
	]::text[] LOOP
		IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = capability_role_name) THEN
			EXECUTE format(
				'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
				capability_role_name
			);
		END IF;

		SELECT "rolcanlogin", "rolsuper", "rolcreatedb", "rolcreaterole", "rolinherit"
		INTO STRICT capability_role
		FROM "pg_roles"
		WHERE "rolname" = capability_role_name;

		IF capability_role."rolcanlogin"
			OR capability_role."rolsuper"
			OR capability_role."rolcreatedb"
			OR capability_role."rolcreaterole"
			OR capability_role."rolinherit" THEN
			RAISE EXCEPTION
				'Catalog capability role % has unsafe attributes; provision it externally as NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
				capability_role_name
				USING ERRCODE = '42501';
		END IF;
	END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."guard_coach_problem_candidate_governance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	is_sync boolean := pg_has_role(current_user, 'algocoach_catalog_sync', 'member');
	is_reviewer boolean := pg_has_role(current_user, 'algocoach_catalog_reviewer', 'member');
	is_publisher boolean := pg_has_role(current_user, 'algocoach_catalog_publisher', 'member');
	is_super boolean := COALESCE((SELECT "rolsuper" FROM "pg_roles" WHERE "rolname" = current_user), false);
	draft_changed boolean := NEW."draft" IS DISTINCT FROM OLD."draft";
	target_changed boolean := ROW(NEW."target_problem_id", NEW."change_kind")
		IS DISTINCT FROM ROW(OLD."target_problem_id", OLD."change_kind");
	normalized_changed boolean := NEW."normalized_problem" IS DISTINCT FROM OLD."normalized_problem";
	content_changed boolean := NEW."content_hash" IS DISTINCT FROM OLD."content_hash";
	approval_changed boolean := ROW(
		NEW."approved_by_user_id", NEW."approved_at", NEW."approved_content_hash",
		NEW."approved_source_revision", NEW."approved_draft_hash",
		NEW."approved_draft_revision", NEW."approved_policy_version"
	) IS DISTINCT FROM ROW(
		OLD."approved_by_user_id", OLD."approved_at", OLD."approved_content_hash",
		OLD."approved_source_revision", OLD."approved_draft_hash",
		OLD."approved_draft_revision", OLD."approved_policy_version"
	);
	publication_changed boolean := ROW(NEW."published_by_user_id", NEW."published_at")
		IS DISTINCT FROM ROW(OLD."published_by_user_id", OLD."published_at");
BEGIN
	IF OLD."status" IN ('published', 'archived') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
		RAISE EXCEPTION 'Published catalog candidates are immutable';
	END IF;

	IF NEW."raw_payload" IS DISTINCT FROM OLD."raw_payload"
		OR NEW."raw_content_hash" IS DISTINCT FROM OLD."raw_content_hash"
		OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
		OR NEW."sync_run_id" IS DISTINCT FROM OLD."sync_run_id"
		OR NEW."external_id" IS DISTINCT FROM OLD."external_id"
		OR NEW."source_revision" IS DISTINCT FROM OLD."source_revision"
		OR NEW."upstream_url" IS DISTINCT FROM OLD."upstream_url"
		OR NEW."license_spdx" IS DISTINCT FROM OLD."license_spdx"
		OR NEW."attribution" IS DISTINCT FROM OLD."attribution" THEN
		RAISE EXCEPTION 'Catalog candidate raw source evidence is immutable';
	END IF;

	IF draft_changed OR target_changed THEN
		IF OLD."status" IN ('approved', 'published', 'archived') THEN
			RAISE EXCEPTION 'Approved or published catalog drafts are immutable';
		END IF;
		IF NOT is_super AND NOT (is_reviewer AND NOT is_publisher) THEN
			RAISE EXCEPTION 'Only the catalog reviewer role may edit drafts or target associations';
		END IF;
		IF NEW."draft_revision" <> OLD."draft_revision" + 1
			OR nullif(btrim(NEW."draft_hash"), '') IS NULL
			OR NEW."status" <> 'quarantined'
			OR NEW."approved_by_user_id" IS NOT NULL
			OR NEW."approved_at" IS NOT NULL
			OR NEW."approved_content_hash" IS NOT NULL
			OR NEW."approved_source_revision" IS NOT NULL
			OR NEW."approved_draft_hash" IS NOT NULL
			OR NEW."approved_draft_revision" IS NOT NULL
			OR NEW."approved_policy_version" IS NOT NULL
			OR NEW."published_by_user_id" IS NOT NULL
			OR NEW."published_at" IS NOT NULL THEN
			RAISE EXCEPTION 'Draft updates must increment revision, refresh hash, clear approval, and return to quarantine';
		END IF;
	ELSIF NEW."draft_revision" IS DISTINCT FROM OLD."draft_revision"
		OR NEW."draft_hash" IS DISTINCT FROM OLD."draft_hash"
		OR NEW."policy_version" IS DISTINCT FROM OLD."policy_version" THEN
		RAISE EXCEPTION 'Draft hash and revision may only change with the draft';
	END IF;
	IF (normalized_changed OR content_changed) AND NOT draft_changed THEN
		RAISE EXCEPTION 'Normalized content and content hash may only change with a reviewed draft revision';
	END IF;
	IF target_changed AND NOT draft_changed
		AND NEW."policy_version" IS DISTINCT FROM OLD."policy_version" THEN
		RAISE EXCEPTION 'Target association cannot alter the review policy';
	END IF;

	IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
		(OLD."status" = 'discovered' AND NEW."status" IN ('drafting', 'quarantined', 'validated', 'rejected')) OR
		(OLD."status" = 'drafting' AND NEW."status" IN ('quarantined', 'rejected')) OR
		(OLD."status" = 'quarantined' AND NEW."status" IN ('validated', 'rejected')) OR
		(OLD."status" = 'validated' AND NEW."status" IN ('quarantined', 'approved', 'rejected')) OR
		(OLD."status" = 'approved' AND NEW."status" IN ('quarantined', 'rejected', 'published')) OR
		(OLD."status" = 'rejected' AND NEW."status" = 'quarantined' AND (draft_changed OR target_changed))
	) THEN
		RAISE EXCEPTION 'Invalid catalog candidate status transition: % -> %', OLD."status", NEW."status";
	END IF;

	IF NEW."status" NOT IN ('approved', 'published') AND (
		NEW."approved_by_user_id" IS NOT NULL OR NEW."approved_at" IS NOT NULL OR
		NEW."approved_content_hash" IS NOT NULL OR NEW."approved_source_revision" IS NOT NULL OR
		NEW."approved_draft_hash" IS NOT NULL OR NEW."approved_draft_revision" IS NOT NULL OR
		NEW."approved_policy_version" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'Approval binding cannot exist outside approved or published state';
	END IF;
	IF NEW."status" <> 'published' AND (
		NEW."published_by_user_id" IS NOT NULL OR NEW."published_at" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'Publication binding cannot exist outside published state';
	END IF;
	IF approval_changed AND NOT (
		(OLD."status" = 'validated' AND NEW."status" = 'approved') OR
		(OLD."status" = 'approved' AND NEW."status" IN ('quarantined', 'rejected'))
	) THEN
		RAISE EXCEPTION 'Approval binding may only be created at approval or cleared during rework/rejection';
	END IF;
	IF publication_changed AND NOT (OLD."status" = 'approved' AND NEW."status" = 'published') THEN
		RAISE EXCEPTION 'Publication binding may only be created during publication';
	END IF;

	IF NEW."status" = 'approved' AND OLD."status" <> 'approved' THEN
		IF NEW."approved_by_user_id" IS NULL
			OR NEW."approved_at" IS NULL
			OR NEW."approved_content_hash" IS DISTINCT FROM NEW."content_hash"
			OR NEW."approved_source_revision" IS DISTINCT FROM NEW."source_revision"
			OR NEW."approved_draft_hash" IS DISTINCT FROM NEW."draft_hash"
			OR NEW."approved_draft_revision" IS DISTINCT FROM NEW."draft_revision"
			OR NEW."approved_policy_version" IS DISTINCT FROM NEW."policy_version"
			OR COALESCE((NEW."validation"->>'valid')::boolean, false) IS NOT TRUE THEN
			RAISE EXCEPTION 'Catalog approval must bind validated content, source, draft, and policy';
		END IF;
	END IF;

	IF NEW."status" = 'published' AND OLD."status" <> 'published' THEN
		IF OLD."status" <> 'approved'
			OR NEW."published_by_user_id" IS NULL
			OR NEW."published_at" IS NULL
			OR NEW."approved_by_user_id" IS NULL
			OR NEW."published_by_user_id" = NEW."approved_by_user_id"
			OR NEW."approved_content_hash" IS DISTINCT FROM NEW."content_hash"
			OR NEW."approved_source_revision" IS DISTINCT FROM NEW."source_revision"
			OR NEW."approved_draft_hash" IS DISTINCT FROM NEW."draft_hash"
			OR NEW."approved_draft_revision" IS DISTINCT FROM NEW."draft_revision"
			OR NEW."approved_policy_version" IS DISTINCT FROM NEW."policy_version" THEN
			RAISE EXCEPTION 'Catalog publication requires an independent publisher and intact approval binding';
		END IF;
	END IF;

	IF NOT is_super AND is_sync AND NOT is_reviewer AND NOT is_publisher AND (
		draft_changed OR target_changed OR normalized_changed OR content_changed OR approval_changed OR publication_changed OR
		NEW."status" IN ('approved', 'published', 'archived')
	) THEN
		RAISE EXCEPTION 'Catalog sync role cannot edit or release reviewed content';
	END IF;
	IF NOT is_super AND is_reviewer AND NOT is_publisher AND (
		publication_changed OR NEW."status" IN ('published', 'archived')
	) THEN
		RAISE EXCEPTION 'Catalog reviewer role cannot publish content';
	END IF;
	IF NOT is_super AND is_publisher AND NOT is_reviewer AND (
		draft_changed OR target_changed OR normalized_changed OR content_changed OR NEW."status" = 'approved'
	) THEN
		RAISE EXCEPTION 'Catalog publisher role cannot edit or approve drafts';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_coach_problem_candidate_governance"
BEFORE UPDATE ON "algocoach"."coach_problem_candidate"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_problem_candidate_governance"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."guard_coach_problem_candidate_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF nullif(btrim(NEW."raw_content_hash"), '') IS NULL
		OR nullif(btrim(NEW."draft_hash"), '') IS NULL
		OR nullif(btrim(NEW."policy_version"), '') IS NULL
		OR NEW."draft_revision" <> 1 THEN
		RAISE EXCEPTION 'Catalog candidates require immutable raw evidence and an initial draft binding';
	END IF;
	IF pg_has_role(current_user, 'algocoach_catalog_sync', 'member')
		AND NOT pg_has_role(current_user, 'algocoach_catalog_reviewer', 'member')
		AND NOT pg_has_role(current_user, 'algocoach_catalog_publisher', 'member')
		AND NEW."status" NOT IN ('discovered', 'drafting', 'quarantined', 'rejected') THEN
		RAISE EXCEPTION 'Catalog sync role can only insert quarantined candidates';
	END IF;
	IF NEW."status" IN ('approved', 'published', 'archived') THEN
		RAISE EXCEPTION 'Released catalog candidates cannot be inserted directly';
	END IF;
	IF NEW."approved_by_user_id" IS NOT NULL OR NEW."approved_at" IS NOT NULL OR
		NEW."approved_content_hash" IS NOT NULL OR NEW."approved_source_revision" IS NOT NULL OR
		NEW."approved_draft_hash" IS NOT NULL OR NEW."approved_draft_revision" IS NOT NULL OR
		NEW."approved_policy_version" IS NOT NULL OR NEW."published_by_user_id" IS NOT NULL OR
		NEW."published_at" IS NOT NULL THEN
		RAISE EXCEPTION 'New catalog candidates cannot contain approval or publication bindings';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_coach_problem_candidate_insert"
BEFORE INSERT ON "algocoach"."coach_problem_candidate"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_problem_candidate_insert"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."guard_coach_problem_revision_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Published problem revisions cannot be deleted'
			USING ERRCODE = '23514';
	END IF;
	IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
		RAISE EXCEPTION 'Problem revision content and provenance are immutable; create a new revision'
			USING ERRCODE = '23514';
	END IF;
	IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
		(OLD."status" = 'published' AND NEW."status" = 'archived') OR
		(OLD."status" = 'archived' AND NEW."status" = 'published')
	) THEN
		RAISE EXCEPTION 'Problem revision status may only transition between published and archived'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."guard_coach_test_case_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'Revision-bound test cases are immutable; create a new revision'
		USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_coach_problem_revision_immutable"
BEFORE UPDATE OR DELETE ON "algocoach"."coach_problem_revision"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_problem_revision_immutable"();
--> statement-breakpoint
CREATE TRIGGER "trg_coach_test_case_immutable"
BEFORE UPDATE OR DELETE ON "algocoach"."coach_test_case"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_test_case_immutable"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."guard_coach_catalog_audit_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'Catalog audit records are append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_coach_catalog_review_audit_append_only"
BEFORE UPDATE OR DELETE ON "algocoach"."coach_catalog_review_audit"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_catalog_audit_append_only"();
--> statement-breakpoint
CREATE TRIGGER "trg_coach_catalog_ai_generation_append_only"
BEFORE UPDATE OR DELETE ON "algocoach"."coach_catalog_ai_generation"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_catalog_audit_append_only"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."validate_coach_catalog_audit_actor"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	is_sync boolean := pg_has_role(current_user, 'algocoach_catalog_sync', 'member');
	is_reviewer boolean := pg_has_role(current_user, 'algocoach_catalog_reviewer', 'member');
	is_publisher boolean := pg_has_role(current_user, 'algocoach_catalog_publisher', 'member');
	is_super boolean := COALESCE((SELECT "rolsuper" FROM "pg_roles" WHERE "rolname" = current_user), false);
	candidate_record "algocoach"."coach_problem_candidate"%ROWTYPE;
BEGIN
	IF NEW."action" IN ('draft_updated', 'approved', 'rejected', 'published', 'rolled_back')
		AND NEW."reviewer_user_id" IS NULL THEN
		RAISE EXCEPTION 'Human catalog actions require a real reviewer user id';
	END IF;
	IF NOT is_super AND is_sync AND NOT is_reviewer AND NOT is_publisher
		AND NEW."action" <> 'submitted' THEN
		RAISE EXCEPTION 'Catalog sync role may only append submitted audits';
	END IF;
	IF NOT is_super AND is_reviewer AND NOT is_publisher
		AND NEW."action" IN ('published', 'archived', 'rolled_back') THEN
		RAISE EXCEPTION 'Catalog reviewer role cannot append publication audits';
	END IF;
	IF NOT is_super AND is_publisher AND NOT is_reviewer
		AND NEW."action" IN ('draft_updated', 'approved') THEN
		RAISE EXCEPTION 'Catalog publisher role cannot append draft or approval audits';
	END IF;
	IF NEW."action" IN ('approved', 'published') AND (
		NEW."content_hash" IS NULL OR NEW."source_revision" IS NULL OR
		NEW."draft_hash" IS NULL OR NEW."draft_revision" IS NULL OR
		NEW."policy_version" IS NULL
	) THEN
		RAISE EXCEPTION 'Approval and publication audits require immutable binding evidence';
	END IF;
	IF NEW."candidate_id" IS NOT NULL THEN
		SELECT * INTO candidate_record
		FROM "algocoach"."coach_problem_candidate"
		WHERE "id" = NEW."candidate_id";
		IF NOT FOUND THEN
			RAISE EXCEPTION 'Catalog audit candidate does not exist';
		END IF;
		IF NEW."action" = 'draft_updated' AND (
			candidate_record."status" <> 'quarantined' OR
			NEW."reviewer_user_id" IS NULL
		) THEN
			RAISE EXCEPTION 'Draft audit does not match candidate state';
		END IF;
		IF NEW."action" = 'approved' AND (
			candidate_record."status" <> 'approved' OR
			NEW."reviewer_user_id" IS DISTINCT FROM candidate_record."approved_by_user_id" OR
			NEW."content_hash" IS DISTINCT FROM candidate_record."content_hash" OR
			NEW."source_revision" IS DISTINCT FROM candidate_record."source_revision" OR
			NEW."draft_hash" IS DISTINCT FROM candidate_record."draft_hash" OR
			NEW."draft_revision" IS DISTINCT FROM candidate_record."draft_revision" OR
			NEW."policy_version" IS DISTINCT FROM candidate_record."policy_version"
		) THEN
			RAISE EXCEPTION 'Approval audit does not match candidate binding';
		END IF;
		IF NEW."action" = 'published' AND (
			candidate_record."status" <> 'published' OR
			NEW."reviewer_user_id" IS DISTINCT FROM candidate_record."published_by_user_id" OR
			NEW."content_hash" IS DISTINCT FROM candidate_record."content_hash" OR
			NEW."source_revision" IS DISTINCT FROM candidate_record."source_revision" OR
			NEW."draft_hash" IS DISTINCT FROM candidate_record."draft_hash" OR
			NEW."draft_revision" IS DISTINCT FROM candidate_record."draft_revision" OR
			NEW."policy_version" IS DISTINCT FROM candidate_record."policy_version"
		) THEN
			RAISE EXCEPTION 'Publication audit does not match candidate binding';
		END IF;
		IF NEW."action" = 'rejected' AND candidate_record."status" <> 'rejected' THEN
			RAISE EXCEPTION 'Rejection audit does not match candidate state';
		END IF;
	END IF;
	IF NEW."action" IN ('draft_updated', 'approved', 'rejected', 'published')
		AND NEW."candidate_id" IS NULL THEN
		RAISE EXCEPTION 'Candidate audit action requires a candidate';
	END IF;
	IF NEW."action" = 'rolled_back' AND (
		NEW."problem_id" IS NULL OR NEW."revision_id" IS NULL OR NEW."reviewer_user_id" IS NULL
	) THEN
		RAISE EXCEPTION 'Rollback audit requires problem, revision, and actor';
	END IF;
	IF NEW."action" = 'rolled_back' AND NOT EXISTS (
		SELECT 1 FROM "algocoach"."coach_problem" AS problem
		JOIN "algocoach"."coach_problem_revision" AS revision
			ON revision."id" = problem."current_revision_id" AND revision."problem_id" = problem."id"
		WHERE problem."id" = NEW."problem_id" AND revision."id" = NEW."revision_id"
			AND revision."status" = 'published'
	) THEN
		RAISE EXCEPTION 'Rollback audit does not match the active revision';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_coach_catalog_review_audit_actor"
BEFORE INSERT ON "algocoach"."coach_catalog_review_audit"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."validate_coach_catalog_audit_actor"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."require_coach_candidate_release_audit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."status" = 'approved' AND OLD."status" <> 'approved' AND NOT EXISTS (
		SELECT 1 FROM "algocoach"."coach_catalog_review_audit" AS audit
		WHERE audit."candidate_id" = NEW."id" AND audit."action" = 'approved'
			AND audit."reviewer_user_id" = NEW."approved_by_user_id"
			AND audit."content_hash" = NEW."content_hash"
			AND audit."source_revision" = NEW."source_revision"
			AND audit."draft_hash" = NEW."draft_hash"
			AND audit."draft_revision" = NEW."draft_revision"
			AND audit."policy_version" = NEW."policy_version"
			AND audit."created_at" >= transaction_timestamp()
	) THEN
		RAISE EXCEPTION 'Catalog approval requires an atomic matching audit'
			USING ERRCODE = '23514';
	END IF;
	IF NEW."status" = 'published' AND OLD."status" <> 'published' AND NOT EXISTS (
		SELECT 1 FROM "algocoach"."coach_catalog_review_audit" AS audit
		WHERE audit."candidate_id" = NEW."id" AND audit."action" = 'published'
			AND audit."reviewer_user_id" = NEW."published_by_user_id"
			AND audit."content_hash" = NEW."content_hash"
			AND audit."source_revision" = NEW."source_revision"
			AND audit."draft_hash" = NEW."draft_hash"
			AND audit."draft_revision" = NEW."draft_revision"
			AND audit."policy_version" = NEW."policy_version"
			AND audit."created_at" >= transaction_timestamp()
	) THEN
		RAISE EXCEPTION 'Catalog publication requires an atomic matching audit'
			USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trg_coach_candidate_release_audit"
AFTER UPDATE ON "algocoach"."coach_problem_candidate"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "algocoach"."require_coach_candidate_release_audit"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."require_coach_problem_pointer_audit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."current_revision_id" IS DISTINCT FROM OLD."current_revision_id" AND NOT EXISTS (
		SELECT 1 FROM "algocoach"."coach_catalog_review_audit" AS audit
		WHERE audit."problem_id" = NEW."id"
			AND audit."revision_id" = NEW."current_revision_id"
			AND audit."action" IN ('published', 'rolled_back')
			AND audit."created_at" >= transaction_timestamp()
	) THEN
		RAISE EXCEPTION 'Catalog revision pointer change requires an atomic publication or rollback audit'
			USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trg_coach_problem_pointer_audit"
AFTER UPDATE ON "algocoach"."coach_problem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "algocoach"."require_coach_problem_pointer_audit"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."validate_coach_revision_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	candidate_record "algocoach"."coach_problem_candidate"%ROWTYPE;
	license_text text;
	license_content_hash text;
	license_git_blob_sha text;
	calculated_license_hash text;
	calculated_git_blob_sha text;
BEGIN
	IF (NEW."candidate_id" IS NOT NULL OR NEW."catalog_source_id" IS NOT NULL) AND (
		NEW."catalog_source_id" IS NULL OR NEW."source_external_id" IS NULL OR
		NEW."source_statement_path" IS NULL OR NEW."source_license_spdx" IS NULL OR
		NEW."source_license_hash" IS NULL OR
		NEW."source_attribution" IS NULL OR NEW."source_fetched_at" IS NULL OR
		nullif(btrim(NEW."policy_version"), '') IS NULL OR
		nullif(btrim(NEW."draft_hash"), '') IS NULL OR
		nullif(NEW."provenance"->>'licenseText', '') IS NULL OR
		nullif(NEW."provenance"->>'licenseContentHash', '') IS NULL OR
		nullif(NEW."provenance"->>'licenseGitBlobSha', '') IS NULL
	) THEN
		RAISE EXCEPTION 'External revisions require complete immutable source, draft, and license provenance';
	END IF;
	IF NEW."candidate_id" IS NOT NULL OR NEW."catalog_source_id" IS NOT NULL THEN
		license_text := NEW."provenance"->>'licenseText';
		license_content_hash := NEW."provenance"->>'licenseContentHash';
		license_git_blob_sha := NEW."provenance"->>'licenseGitBlobSha';
		calculated_license_hash := 'sha256:' || encode(sha256(convert_to(license_text, 'UTF8')), 'hex');
		calculated_git_blob_sha := encode(
			digest(
				convert_to('blob ' || octet_length(convert_to(license_text, 'UTF8'))::text, 'UTF8') ||
				decode('00', 'hex') || convert_to(license_text, 'UTF8'),
				'sha1'
			),
			'hex'
		);
		IF NEW."source_license_spdx" <> 'MIT'
			OR octet_length(convert_to(license_text, 'UTF8')) > 65536
			OR position('MIT License' in license_text) = 0
			OR position('Permission is hereby granted, free of charge' in license_text) = 0
			OR license_content_hash !~ '^sha256:[a-f0-9]{64}$'
			OR license_git_blob_sha !~ '^[a-f0-9]{40}$'
			OR license_content_hash IS DISTINCT FROM calculated_license_hash
			OR license_git_blob_sha IS DISTINCT FROM calculated_git_blob_sha
			OR NEW."source_license_hash" IS DISTINCT FROM license_content_hash THEN
			RAISE EXCEPTION 'External revision license evidence is incomplete or invalid';
		END IF;
	END IF;
	IF NEW."candidate_id" IS NOT NULL THEN
		SELECT * INTO candidate_record
		FROM "algocoach"."coach_problem_candidate"
		WHERE "id" = NEW."candidate_id";
		IF NOT FOUND OR candidate_record."status" <> 'approved' OR
			candidate_record."approved_content_hash" IS DISTINCT FROM candidate_record."content_hash" OR
			candidate_record."approved_source_revision" IS DISTINCT FROM candidate_record."source_revision" OR
			candidate_record."approved_draft_hash" IS DISTINCT FROM candidate_record."draft_hash" OR
			candidate_record."approved_draft_revision" IS DISTINCT FROM candidate_record."draft_revision" OR
			candidate_record."approved_policy_version" IS DISTINCT FROM candidate_record."policy_version" OR
			NEW."catalog_source_id" IS DISTINCT FROM candidate_record."source_id" OR
			NEW."source_external_id" IS DISTINCT FROM candidate_record."external_id" OR
			NEW."source_license_spdx" IS DISTINCT FROM candidate_record."license_spdx" OR
			NEW."source_attribution" IS DISTINCT FROM candidate_record."attribution" OR
			NEW."source_revision" IS DISTINCT FROM candidate_record."source_revision" OR
			NEW."content_hash" IS DISTINCT FROM candidate_record."content_hash" OR
			NEW."policy_version" IS DISTINCT FROM candidate_record."policy_version" OR
			NEW."draft_hash" IS DISTINCT FROM candidate_record."draft_hash" OR
			NEW."draft_revision" IS DISTINCT FROM candidate_record."draft_revision" OR
			candidate_record."raw_payload"#>>'{source,licenseSpdx}' IS DISTINCT FROM 'MIT' OR
			candidate_record."raw_payload"#>>'{source,licenseText}' IS DISTINCT FROM license_text OR
			candidate_record."raw_payload"#>>'{source,licenseContentHash}' IS DISTINCT FROM license_content_hash OR
			candidate_record."raw_payload"#>>'{source,licenseGitBlobSha}' IS DISTINCT FROM license_git_blob_sha OR
			candidate_record."raw_payload"#>>'{source,attribution}' IS DISTINCT FROM candidate_record."attribution" THEN
			RAISE EXCEPTION 'Revision provenance does not match the independently approved candidate';
		END IF;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_coach_problem_revision_provenance"
BEFORE INSERT ON "algocoach"."coach_problem_revision"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."validate_coach_revision_provenance"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."validate_coach_test_case_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."source_kind" = 'legacy' AND EXISTS (
		SELECT 1 FROM "algocoach"."coach_problem_revision" AS revision
		WHERE revision."id" = NEW."revision_id" AND revision."candidate_id" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'New external catalog tests require canonical or manual review provenance';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_coach_test_case_provenance"
BEFORE INSERT ON "algocoach"."coach_test_case"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."validate_coach_test_case_provenance"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "algocoach"."guard_coach_external_problem_application_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF COALESCE((SELECT NOT "rolsuper" FROM "pg_roles" WHERE "rolname" = current_user), false)
		AND pg_has_role(current_user, 'algocoach_application', 'member') AND (
		(TG_OP = 'INSERT' AND (NEW."owner_user_id" IS NULL OR NEW."source" <> 'imported')) OR
		(TG_OP IN ('UPDATE', 'DELETE') AND OLD."owner_user_id" IS NULL)
	) THEN
		RAISE EXCEPTION 'Application role cannot modify the shared catalog';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_coach_problem_application_catalog_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "algocoach"."coach_problem"
FOR EACH ROW EXECUTE FUNCTION "algocoach"."guard_coach_external_problem_application_write"();
--> statement-breakpoint
REVOKE ALL ON TABLE
	"algocoach"."coach_catalog_source",
	"algocoach"."coach_catalog_sync_run",
	"algocoach"."coach_problem_candidate",
	"algocoach"."coach_catalog_ai_generation",
	"algocoach"."coach_catalog_admin_mutation",
	"algocoach"."coach_catalog_review_audit",
	"algocoach"."coach_problem_revision",
	"algocoach"."coach_problem_origin",
	"algocoach"."coach_test_case"
FROM algocoach_catalog_sync, algocoach_catalog_reviewer, algocoach_catalog_publisher;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "algocoach" TO algocoach_catalog_sync, algocoach_catalog_reviewer, algocoach_catalog_publisher;
--> statement-breakpoint
GRANT SELECT ON TABLE
	"algocoach"."coach_catalog_source", "algocoach"."coach_catalog_sync_run",
	"algocoach"."coach_problem_candidate", "algocoach"."coach_problem",
	"algocoach"."coach_problem_revision", "algocoach"."coach_problem_origin",
	"algocoach"."coach_test_case", "algocoach"."coach_catalog_review_audit",
	"algocoach"."coach_catalog_ai_generation", "algocoach"."coach_catalog_admin_mutation"
TO algocoach_catalog_sync, algocoach_catalog_reviewer, algocoach_catalog_publisher;
--> statement-breakpoint
GRANT SELECT ("id", "email") ON TABLE "algocoach"."user" TO algocoach_catalog_reviewer, algocoach_catalog_publisher;
--> statement-breakpoint
GRANT INSERT, UPDATE ON TABLE "algocoach"."coach_catalog_source", "algocoach"."coach_catalog_sync_run", "algocoach"."coach_problem_candidate"
TO algocoach_catalog_sync;
--> statement-breakpoint
GRANT INSERT ON TABLE "algocoach"."coach_catalog_review_audit" TO algocoach_catalog_sync, algocoach_catalog_reviewer, algocoach_catalog_publisher;
--> statement-breakpoint
GRANT UPDATE ON TABLE "algocoach"."coach_problem_candidate" TO algocoach_catalog_reviewer, algocoach_catalog_publisher;
--> statement-breakpoint
GRANT INSERT ON TABLE "algocoach"."coach_catalog_ai_generation" TO algocoach_catalog_sync, algocoach_catalog_reviewer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "algocoach"."coach_catalog_admin_mutation" TO algocoach_catalog_reviewer, algocoach_catalog_publisher;
--> statement-breakpoint
GRANT INSERT, UPDATE ON TABLE "algocoach"."coach_problem", "algocoach"."coach_problem_revision", "algocoach"."coach_problem_origin"
TO algocoach_catalog_publisher;
--> statement-breakpoint
GRANT INSERT ON TABLE "algocoach"."coach_test_case" TO algocoach_catalog_publisher;
--> statement-breakpoint
INSERT INTO "algocoach"."permission" ("id", "code", "resource", "action", "title", "description", "created_at", "updated_at") VALUES
	('permission_admin_catalog_read', 'admin.catalog.read', 'catalog', 'read', 'Read AlgoCoach Catalog', 'View catalog candidates, validation, and source evidence', now(), now()),
	('permission_admin_catalog_review', 'admin.catalog.review', 'catalog', 'review', 'Review AlgoCoach Catalog', 'Edit, validate, approve, and reject catalog candidates', now(), now()),
	('permission_admin_catalog_publish', 'admin.catalog.publish', 'catalog', 'publish', 'Publish AlgoCoach Catalog', 'Publish an independently approved catalog candidate', now(), now()),
	('permission_admin_catalog_rollback', 'admin.catalog.rollback', 'catalog', 'rollback', 'Rollback AlgoCoach Catalog', 'Restore a previously published immutable revision', now(), now())
ON CONFLICT ("code") DO UPDATE SET
	"resource" = EXCLUDED."resource", "action" = EXCLUDED."action",
	"title" = EXCLUDED."title", "description" = EXCLUDED."description", "updated_at" = now();
--> statement-breakpoint
INSERT INTO "algocoach"."role_permission" ("id", "role_id", "permission_id", "created_at", "updated_at")
SELECT
	'role_permission_catalog_' || role."name" || '_' || permission."action",
	role."id", permission."id", now(), now()
FROM "algocoach"."role" AS role
JOIN "algocoach"."permission" AS permission ON permission."code" IN (
	'admin.catalog.read', 'admin.catalog.review', 'admin.catalog.publish', 'admin.catalog.rollback'
)
WHERE
	(role."name" = 'admin') OR
	(role."name" = 'editor' AND permission."code" IN ('admin.catalog.read', 'admin.catalog.review')) OR
	(role."name" = 'viewer' AND permission."code" = 'admin.catalog.read')
ON CONFLICT ("id") DO UPDATE SET "deleted_at" = NULL, "updated_at" = now();
