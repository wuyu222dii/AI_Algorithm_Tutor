# AlgoCoach / AI Algorithm Tutor

A bilingual algorithm training tool for programming learners, covering the full teach → practice → test → evaluate loop. Guests can run JavaScript, Python, and TypeScript in a browser Worker; signed-in users can incrementally sync learning records to PostgreSQL.

> Chinese backup: [README.zh-CN.md](./README.zh-CN.md)

## Local development

Requirements: Node.js 22.13+, pnpm 11.7.0; Docker is needed for database integration tests and image verification.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Dev startup reads `.env.development.local`, `.env.local`, `.env.development`, and `.env`. Database migrations are off by default; when you need them, set a dedicated `MIGRATION_DATABASE_URL` in an uncommitted local env file and run `pnpm db:migrate`. You can also set `DB_AUTO_MIGRATE=true` so startup migrates before launching Next.js. The migration script never falls back to `DATABASE_URL`. See `.env.example` for the env template.

Full local checks:

```bash
pnpm check
pnpm test:db:integration
pnpm test:e2e
docker build -t algocoach .
```

After a production build, `pnpm budget:coach` checks unique JavaScript for the learning hub, problem catalog, progress, and review pages (gzip ≤ 200 KiB), the real 73-problem `ProblemSummary` RSC serialized payload (gzip ≤ 150 KiB), and browser Runner Worker assets (≤ 6 MiB). If those non-execution pages accidentally pull in Monaco, QuickJS, the TypeScript compiler, or Pyodide, the check fails. Both `pnpm check` and the GitHub Production build include this gate.

The browser collects LCP, INP, and CLS via the Next.js Web Vitals hook and sends values, ratings, and budget status to Sentry Metrics; caps are 2.5s, 200ms, and 0.1. Reports never include URLs, users, DOM nodes, problem statements, or code. `NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE` controls session sampling; start production at `0.10`.

## Supabase

Production must use two distinct database roles:

- `MIGRATION_DATABASE_URL`: injected only into the release job; allows DDL.
- `DATABASE_URL`: the app runtime connection; uses a restricted DML role.

Local development follows the same boundary: keep migration and runtime connections in `.env.development.local`, do not commit them, and never put the same high-privilege account in both variables. If `DB_AUTO_MIGRATE=true` but `MIGRATION_DATABASE_URL` is missing, startup fails and reports the missing dedicated migration connection; with `DB_AUTO_MIGRATE=false`, startup does not change the schema.

First create the app role in the Supabase SQL Editor with admin privileges and a strong dedicated password:

```sql
CREATE ROLE algocoach_app
  WITH LOGIN PASSWORD '<generate-a-new-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
```

The release job verifies the role is not a schema owner or high-privilege role, then after migrations grants only DML on the `algocoach` schema, sequence usage, and migration-history read access. Migrations never run during production builds or container startup.

Any database password that has appeared in chat, logs, or commit history must be rotated in the Supabase console first, then updated in GitHub Environment and deployment-platform secrets.

Migration `0023` enables durable guest claim, anonymous funnel metrics, and user timezone semantics. On Staging, set both
`DURABLE_GUEST_CLAIM_ENABLED=true` and
`NEXT_PUBLIC_DURABLE_GUEST_CLAIM_ENABLED=true` first; the server does not clear the guest namespace until it receives an idempotent ACK.
With `ANONYMOUS_METRICS_ENABLED=true`, the browser only batches allowlisted event IDs, names, timestamps, and optional problem slugs; the server derives an anonymous subject with
`ANONYMOUS_METRICS_HMAC_SECRET` (falls back to `AUTH_SECRET` when unset) and never stores cookies, IPs, code, or problem statements.
Enable both features on Production with the same settings only after Staging validation.

## Google sign-in

Create separate Google Web OAuth clients for development and production:

- Dev Origin: `http://localhost:3000`
- Dev Redirect URI: `http://localhost:3000/api/auth/callback/google`
- Prod Origin: your production HTTPS Origin
- Prod Redirect URI: `{AUTH_URL}/api/auth/callback/google`

The OAuth consent screen needs branding, a support email, privacy policy, and terms of service. Runtime settings:

```dotenv
GOOGLE_AUTH_ENABLED=true
GOOGLE_ONE_TAP_ENABLED=false
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

The Client Secret may only live as a deployment secret—never in public DB config, the Git repo, or Docker build args. The app exposes only the standard Google button; Google-verified same-email accounts are merged automatically, different emails cannot be linked, and existing name, avatar, and learning data are never overwritten.

## AI coach runtime policy

AlgoCoach connects only to a custom OpenAI-compatible relay; it does not call the official OpenAI API. `OpenAI-compatible` means the `/v1/chat/completions` protocol only. The server uses the settings below; model IDs must match the relay `/v1/models` response exactly:

```dotenv
AI_RELAY_BASE_URL=https://codeapix.top/v1
AI_RELAY_API_KEY=...
AI_RELAY_PRIMARY_MODEL=...
AI_RELAY_FALLBACK_MODEL=...
AI_RELAY_STRUCTURED_OUTPUT_MODE=json
AI_LIVE_EVAL_GATE_PROFILE=strict
AI_RELAY_CANARY_TOKEN=...
AI_RELAY_PRICING_JSON='{"relay-model-id":{"inputPerMillionUsd":3,"outputPerMillionUsd":15}}'
```

Run `pnpm ai:preflight` first to verify model listing, normal generation, streaming, and structured JSON. The command prints only Origin, models, capabilities, and error classes—never keys, problem statements, or code. `OPENROUTER_*` and the old global model variables remain for one-version compatibility and emit deprecation warnings; new deployment secrets must use `AI_RELAY_*`. Unknown client request fields are stripped; clients cannot pick a model.

If you set action-level `ALGO_COACH_<ACTION>_MODEL`, production values may only use the preflighted primary or fallback models above. `AI_RELAY_STRUCTURED_OUTPUT_MODE=json-schema` is allowed only when both models pass JSON Schema preflight; otherwise use `json` and let the server run strict structural validation plus one repair attempt.

Live evaluation has two gate profiles: `strict` keeps public-beta targets (request success ≥ 99.5%, counterexample executability 100%, P95 < 8s); `flow` is Staging-only for temporarily validating the full workflow (success ≥ 95%, counterexample executability ≥ 75%, P95 ≤ 25s). Both require a full 100 bilingual samples, traceable diagnostic facts, prompt-injection pass, and 0% answer leakage. The Staging workflow temporarily uses `flow` when the GitHub Environment variable is unset, or you can set `AI_LIVE_EVAL_GATE_PROFILE=flow` explicitly; Production always uses `strict`. Switch Staging back to `strict` once the relay is stable.

On group rejection, no available channel, `429`, `5xx`, or timeout, the primary model fails over once to the preflighted fallback; `401` fails immediately. Invalid structured output is repaired once on the same model; three consecutive transient failures trip a Redis circuit breaker for 60 seconds. Redis capacity leases also cap concurrency, daily tokens, and estimated spend per user/guest and trusted proxy IP; the default daily learner budget is `US$0.05`. When the relay omits usage, the pre-request max cost reservation is retained; actual pricing is read only from `AI_RELAY_PRICING_JSON`. Chat may switch models only before the first content chunk; failures after the stream starts are logged separately. Production never silently falls back to deterministic demo results when the relay fails.

## Versioned problem catalog

Production catalog reads only published revisions from PostgreSQL. Practice, run results, AI feedback, and local self-tests are pinned to `{slug, contentVersion}`, so problem updates never rewrite historical learning records. Required settings:

```dotenv
DB_CATALOG_ENABLED=true
CATALOG_SYNC_ENABLED=false
CATALOG_ADMIN_DATABASE_URL=
CATALOG_STRUCTURED_REVIEW_MODE=shadow
CATALOG_BOOTSTRAP_ENABLED=false
CATALOG_DISCOVERY_ENABLED=false
CATALOG_DISCOVERY_MAX_EXERCISES=20
CATALOG_ANOMALY_DELTA_THRESHOLD=25
CATALOG_DISCOVERY_INGEST_ENABLED=false
CATALOG_AI_DRAFT_ENABLED=false
CATALOG_AI_MODEL=<same-as-AI_RELAY_PRIMARY_MODEL>
TYPESCRIPT_ENABLED=true
EXERCISM_GITHUB_TOKEN=
```

`DB_CATALOG_ENABLED=false` is for test fixtures only; production readiness rejects it. `CATALOG_STRUCTURED_REVIEW_MODE` defaults to `shadow` in production and should move to `write` only after read-only projection checks pass; no mode lets scheduled sync auto-approve or publish candidates. `CATALOG_SYNC_ENABLED` is off by default and should be set to `true` only temporarily in restricted sync jobs. Exercism sync creates candidates only and never auto-publishes; the first 20 problems keep the full MIT LICENSE text, license/statement/canonical-data Git blob SHAs, content SHA-256, attribution, and a pinned upstream commit. Bootstrap stores the same blob baseline so an immediate discovery run does not misreport the unchanged 20 as new candidates. Canonical UUIDs are for change detection and audit only; they never auto-replace AlgoCoach-reviewed tests.

Migrations create three `NOLOGIN` capability roles: `algocoach_catalog_sync`, `algocoach_catalog_reviewer`, and `algocoach_catalog_publisher`. In Supabase, create two dedicated login accounts once, with freshly generated secret passwords:

```sql
CREATE ROLE algocoach_catalog_worker LOGIN PASSWORD '<new-sync-password>';
GRANT algocoach_catalog_sync TO algocoach_catalog_worker;

CREATE ROLE algocoach_catalog_admin LOGIN NOINHERIT PASSWORD '<new-admin-password>';
GRANT algocoach_catalog_reviewer, algocoach_catalog_publisher
  TO algocoach_catalog_admin;
```

Store the worker connection string as GitHub Environment secret `CATALOG_DATABASE_URL`; store the admin connection string only as the app server secret `CATALOG_ADMIN_DATABASE_URL`. Each backend operation runs `SET LOCAL ROLE` for the current stage, and candidates require distinct approver and publisher login users. Do not give publish rights to the app `DATABASE_URL`, the sync account, or the browser.

The `CATALOG_DATABASE_URL` secret value must be a bare PostgreSQL URL—no `CATALOG_DATABASE_URL=`, `export`, quotes, backticks, or `<PASSWORD>` placeholders; reserved characters in passwords (`#`, `/`, `?`, etc.) must be URL-encoded. The workflow runs `pnpm catalog:db:preflight` first to validate the URL, login identity, sync-role membership, and minimal table grants without printing the connection string.

After Git Tree discovery resolves `main` to a full commit SHA, every tree, LICENSE, statement, and canonical-data request is pinned to that SHA. Per-request limits: 10s timeout, LICENSE ≤ 64 KiB, statements ≤ 256 KiB, canonical-data ≤ 2 MiB with JSON depth ≤ 32. Candidates retain the full LICENSE text, Git blob SHAs, content SHA-256, raw statements, and canonical-data for human review and test construction. Discovery always produces structured drafts with `publishable: false`. With `CATALOG_AI_DRAFT_ENABLED`, `CATALOG_AI_MODEL` may only use a preflighted, price-configured primary or fallback relay model, and may only suggest bilingual titles, descriptions, difficulty, knowledge points, learning goals, and a single function signature. JavaScript, Python, and TypeScript starter templates are generated deterministically from the signature locally and contain only TODO / `pass` / `throw` placeholders; solutions, hints, and authoritative tests stay empty. Drafts remain quarantined after ingest and cannot be published directly. Scheduled jobs prioritize upstream changes to published problems before discovering ordinary new ones; ordinary new ingest pauses when pending candidates reach 50; unchanged items do not count against the batch cap (max 10 per batch). That number is only the candidate-review intake cap—it does not mean problems auto-publish.

```bash
# Fixture-only validation; no upstream access
pnpm catalog:sync -- --fixture --workspace .catalog/review.json
pnpm catalog:validate -- --workspace .catalog/review.json
pnpm catalog:approve -- --workspace .catalog/review.json --reviewer reviewer@example.com --candidate <id>
pnpm catalog:publish -- --workspace .catalog/review.json --reviewer release-manager@example.com --candidate <id>

# Write candidates via the restricted DATABASE_URL; sync/validate are gated
CATALOG_SYNC_ENABLED=true pnpm catalog:sync
CATALOG_SYNC_ENABLED=true pnpm catalog:validate
CATALOG_SYNC_ENABLED=true pnpm catalog:monitor
pnpm catalog:db:preflight
pnpm catalog:source:status

# Generate a safe review artifact for problems not yet in the catalog
CATALOG_DISCOVERY_ENABLED=true pnpm catalog:discover -- --output .catalog/discovery.json

# Ingest the same artifact as quarantine via the restricted writer, then validate again
CATALOG_DISCOVERY_ENABLED=true CATALOG_DISCOVERY_INGEST_ENABLED=true \
  pnpm catalog:discover -- --output .catalog/discovery.json --ingest --reviewer operator@example.com
CATALOG_SYNC_ENABLED=true pnpm catalog:validate

# Run once before enabling scheduled sync: establish upstream baselines for the
# published 20 problems without creating candidates, revisions, or tests.
# Turn the flag off immediately afterward.
CATALOG_BOOTSTRAP_ENABLED=true pnpm catalog:bootstrap -- --reviewer operator@example.com

# DB approve / publish / rollback require explicit human identity and targets per stage
pnpm catalog:approve -- --reviewer <better-auth-reviewer-user-id> --candidate <id>
pnpm catalog:publish -- --reviewer <different-publisher-user-id> --candidate <id>
pnpm catalog:rollback -- --reviewer <publisher-user-id> --problem <slug> --revision <n>

# In DB mode, reviewer must be an existing Better Auth user.id; approver ≠ publisher.

# Workspace mode rolls back by immutable release
pnpm catalog:rollback -- --workspace .catalog/review.json --reviewer reviewer@example.com --release <id>
```

The daily GitHub Workflow binds the `catalog-sync-production` Environment, uses `CATALOG_DATABASE_URL` to write and validate the PostgreSQL candidate area, and produces a real Git Tree discovery review artifact plus a separate deterministic fixture artifact; it never approve or publish. After first configuring the Environment, run `workflow_dispatch` with `bootstrap=true` once to establish the baseline (discovery/ingest jobs skip); afterwards use the schedule or `bootstrap=false` for routine sync. Candidates in `validated` can still be inspected and revised, then must be explicitly approved by a reviewer and explicitly published by a publisher. Each stage writes its own audit record; repeats stay idempotent; publish still re-runs full content and provenance checks. Unknown licenses, duplicate content, dangerous Markdown, missing reliable canonical tests, or function-protocol mismatches are rejected; only temporarily unparseable candidates needing human handling remain in quarantine.

An independent anomaly monitor writes a GitHub Job Summary and annotates the run when two consecutive discovery failures occur, MIT SPDX/license hashes change, or a single sync’s candidate count / upstream problem-tree delta exceeds `CATALOG_ANOMALY_DELTA_THRESHOLD`. Hard failures (`consecutive_failures`, `license_changed`) emit `::error` and fail the monitor step; delta spikes emit `::warning` only. The monitor job uses `continue-on-error` so it does not turn a successful sync/discover into a red workflow. The monitor only reads sync history and never mutates the published catalog.

### Catalog Sync troubleshooting runbook

Historical failure modes observed on `AlgoCoach Exercism Catalog Sync` (newest first):

| When | First failing job / step | Root cause pattern |
|------|--------------------------|--------------------|
| 2026-08-06 | Jobs cancelled | `cancel-in-progress` cancelled an in-flight schedule when another run started |
| 2026-07-16 | `catalog-anomaly-monitor` | Monitor gate failed after sync already succeeded (delta / consecutive failure) |
| 2026-07-15 | `discover-review-drafts` | Discovery/ingest against Exercism Git failed |
| 2026-07-14 | Preflight / restricted writer URL | Missing or invalid `CATALOG_DATABASE_URL` |

**Checklist (run in order):**

1. Open the failed Actions run and note the **first red job/step** and any `[catalog]` / `::error` lines.
2. Confirm GitHub Environment `catalog-sync-production` has Secret `CATALOG_DATABASE_URL` as a **bare** `postgresql://` URL (no `export`, quotes, or `CATALOG_DATABASE_URL=` prefix; percent-encode `#` `/` `?` in the password).
3. Locally (with the restricted sync URL exported as `DATABASE_URL`):

```bash
pnpm catalog:db:preflight
pnpm catalog:source:status
CATALOG_SYNC_ENABLED=true pnpm catalog:sync -- --trigger manual
CATALOG_SYNC_ENABLED=true pnpm catalog:validate
```

4. If `catalog:source:status` reports `scheduledSyncReady: false`, re-enable the Exercism source (privileged role):

```sql
UPDATE algocoach.coach_catalog_source
SET status = 'active', sync_enabled = true, updated_at = NOW()
WHERE key = 'exercism-problem-specifications';
```

5. If the error is `Catalog snapshot local content fingerprint is stale.`, run a one-time `workflow_dispatch` with `bootstrap=true`, then return to the normal schedule (`bootstrap=false`).
6. Keep `CATALOG_AI_DRAFT_ENABLED=false` until `AI_RELAY_*`, `CATALOG_AI_MODEL`, and `AI_RELAY_PRICING_JSON` pass `pnpm ai:preflight`.
7. Admin UI at `/admin/catalog/candidates` shows recent `coach_catalog_sync_run` rows and whether scheduled sync is ready.

**Error code → fix**

| Code / message | Fix |
|----------------|-----|
| `assignment_in_value` / `wrapped_in_quotes` | Store only the bare URL in the Environment secret |
| `malformed_percent_encoding` / `fragment_not_allowed` | URL-encode reserved password characters (`#` → `%23`) |
| `sync_role_missing` | `GRANT algocoach_catalog_sync TO <worker_login>;` |
| `published_catalog_write_present` | Use a restricted worker; revoke INSERT/UPDATE/DELETE on `coach_problem` |
| `migration_0021_required` | Run release migrations through 0021+ |
| `connection_or_probe_failed` | Check password, Supabase network allowlist, and that Actions can reach the DB |
| `Scheduled Exercism synchronization is paused.` | Re-enable source (SQL above) |
| `local content fingerprint is stale` | One-time bootstrap |
| Exercism 403 / 429 / timeout | Retry (workflow retries sync/discover); optionally set a PAT Secret later |

## Release

GitHub Actions runs format, types, zero-warning lint, unit tests, offline AI evaluation, editor asset budgets, PostgreSQL integration, production build, Playwright, and Docker smoke tests on PRs.

`pnpm test:coverage` enforces public-beta critical-path coverage: lines/functions/statements ≥ 80%, branches ≥ 75%. Scope includes sync, evaluation, AI routing, model failover, rate limiting, learning evidence, review scoring, anonymous events, guest claim, and readiness. Large UI flows and DB persistence are covered by Playwright and PostgreSQL integration tests so low-value template files do not dilute critical-domain coverage.

Before a manual release, configure the `staging` and `production` GitHub Environments:

- Secret: `MIGRATION_DATABASE_URL`
- `catalog-sync-production` Environment Secret: `CATALOG_DATABASE_URL` (grants only what source, sync run, candidate, and audit need)
- Variable: `DATABASE_APPLICATION_ROLE=algocoach_app`
- App deployment secrets: `DATABASE_URL`, `CATALOG_ADMIN_DATABASE_URL`, `AUTH_SECRET`, Google, `AI_RELAY_API_KEY`, Redis, and optional telemetry
- GitHub Environment Secrets: `VERCEL_TOKEN`, `AI_RELAY_CANARY_TOKEN`
- GitHub Environment Variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

Start from Actions by manually selecting `staging` and completing acceptance with a real Google test account; production releases may only start from `main`. After the release job succeeds, it publishes an immutable GHCR image with SBOM and provenance, builds and deploys the same commit via the Vercel CLI, then runs live, ready, and AI relay canary checks against the real deployment URL. Vercel Preview and Production runtime env vars must be configured separately; GitHub Environment variables are not auto-injected into Vercel.

Release migrations must follow expand/contract: the release job only applies backward-compatible new tables, columns, indexes, or constraint prep; dropping or changing old field semantics must wait until old images are fully retired. Readiness rejects missing or out-of-order migrations but allows the database to temporarily lead the image while the current history prefix stays intact, so an AI Gate failure does not mark older images that already include that prefix-compatible logic as unavailable.

When upgrading from an older image that does not support “DB ahead of image,” first deploy a bridge image with the new readiness logic but the old expected migration set; confirm the bridge is healthy, run the release migration, then deploy the final image. If the platform cannot do a three-step release, complete the relay Gate in a maintenance window, migrate the database, and cut over to the final image immediately. Later versions that keep using backward-compatible migrations can return to the normal “migration job parallel with AI Gate; publish image after Gate passes” flow.

Runtime probes:

- `GET /api/health/live`: process liveness
- `GET /api/health/ready`: checks config, auth, AI mode, Redis connectivity, restricted DB role, migration version, and published catalog; production returns `503` if any required check fails
- `POST /api/health/ai-relay`: protected low-cost relay probe using `Authorization: Bearer $AI_RELAY_CANARY_TOKEN`

In the `staging` and `production` GitHub Environments, set Variable `DEPLOYMENT_BASE_URL` (HTTPS Origin only), optional Variable `DEPLOYMENT_HEALTH_TIMEOUT_MS`, and Secret `AI_RELAY_CANARY_TOKEN`. That secret must match the deployment runtime `AI_RELAY_CANARY_TOKEN` exactly—do not reuse the relay API key. If Vercel Preview or Production has Deployment Protection enabled, also set Secret `VERCEL_AUTOMATION_BYPASS_SECRET` in the matching GitHub Environment; leave it empty when protection is off.

The `AlgoCoach Deployment Canary` workflow checks production automatically at minute 17 and 47 of every UTC hour, and can be run manually for staging or production. If production `DEPLOYMENT_BASE_URL` is unset, the schedule logs a Warning and skips cleanly; manual runs still fail on missing config. Once configured, it runs strictly live → ready → AI canary and never sends canary credentials if an earlier step fails—covering process, env, DB/migrations, Redis, auth, and real relay primary/fallback models. You can also run `pnpm health:deployment` with the same env vars for post-deploy manual acceptance. Probe output includes only Origin, status, latency, and error class—never tokens or response bodies.

Vercel Git auto-deploy is disabled in `vercel.json` so quality checks, migrations, and the AI Gate cannot be bypassed. After first merging that config, manually run a staging release from GitHub Actions so the Vercel project picks up the new settings; production creates an unbound candidate deployment first and promotes only after readiness and AI canary pass.

Production must set HTTPS REST `REDIS_URL` and `REDIS_TOKEN`. Full Vercel/Upstash auto-injected pairs `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_URL` / `KV_REST_API_TOKEN` also work. Readiness runs side-effect-free `PING` and `EVAL return 1` to ensure credentials have the Lua rights needed for rate limiting and concurrency leases; remote cleartext HTTP is rejected; `REDIS_ALLOW_INSECURE_LOCAL=true` is only for Docker smoke against a local mock. Without Redis in development, process-local rate limiting continues and local startup is unaffected. AI readiness only validates model, Base URL, and credential configuration; real relay connectivity is checked by the protected canary and release AI Gate so short relay outages do not trigger restart loops.

## License

See [LICENSE](./LICENSE). Do not redistribute the underlying licensed template code unless the license permits it.
