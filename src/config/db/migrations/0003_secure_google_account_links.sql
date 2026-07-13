DO $$
DECLARE
	duplicate_accounts text;
BEGIN
	SELECT string_agg(
		format('%s / %s (%s rows)', "provider_id", "account_id", row_count),
		E'\n' ORDER BY row_count DESC, "provider_id", "account_id"
	)
	INTO duplicate_accounts
	FROM (
		SELECT "provider_id", "account_id", count(*) AS row_count
		FROM "algocoach"."account"
		GROUP BY "provider_id", "account_id"
		HAVING count(*) > 1
		ORDER BY count(*) DESC, "provider_id", "account_id"
		LIMIT 20
	) AS duplicates;

	IF duplicate_accounts IS NOT NULL THEN
		RAISE EXCEPTION USING
			MESSAGE = 'OAuth account uniqueness migration blocked by duplicate provider accounts',
			DETAIL = duplicate_accounts,
			HINT = 'Audit and resolve every duplicate (provider_id, account_id) mapping before retrying migration 0003.';
	END IF;
END $$;
--> statement-breakpoint
DROP INDEX "algocoach"."idx_account_provider_account";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_account_provider_account" ON "algocoach"."account" USING btree ("provider_id","account_id");
