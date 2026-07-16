import 'server-only';

import { sql } from 'drizzle-orm';

import { dbPostgres } from '@/core/db';
import { envConfigs } from '@/config';

const WINDOW_DAYS = 7;

type SqlRow = Record<string, unknown>;

function schemaTable(name: string) {
  const schema = (envConfigs.db_schema || 'algocoach').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error('DB_SCHEMA is invalid for beta operations metrics.');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('Metric table name is invalid.');
  }
  return sql.raw(`"${schema}"."${name}"`);
}

function firstRow(value: unknown): SqlRow {
  return (Array.isArray(value) ? value[0] : undefined) ?? {};
}

function rows(value: unknown): SqlRow[] {
  return Array.isArray(value) ? (value as SqlRow[]) : [];
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export interface BetaOperationsMetrics {
  generatedAt: string;
  windowDays: number;
  ai: {
    available: boolean;
    totalRequests: number;
    succeededRequests: number;
    successRate: number;
    p95LatencyMs: number;
    fallbackRequests: number;
    fallbackRate: number;
    usageMissingRequests: number;
    estimatedCostUsd: number;
    bySurface: Array<{
      surface: string;
      requests: number;
      successRate: number;
      p95LatencyMs: number;
      estimatedCostUsd: number;
    }>;
  };
  learning: {
    users: number;
    activeUsers: number;
    activatedUsers: number;
    activationRate: number;
    firstValueUsers: number;
    firstValueRate: number;
    eligibleD1Users: number;
    retainedD1Users: number;
    retainedD1Rate: number;
    eligibleD7Users: number;
    retainedD7Users: number;
    retainedD7Rate: number;
    effectivePractices: number;
    dailyPlanCompletionRate: number;
    diagnosisThreeRunPassRate: number;
  };
  catalog: {
    publishedProblems: number;
    candidateBacklog: number;
    candidatesByStatus: Record<string, number>;
    oldestBacklogAt?: string;
    syncRuns: number;
    successfulSyncRuns: number;
    failedSyncRuns: number;
    latestSync?: {
      status: string;
      upstreamRevision?: string;
      completedAt?: string;
    };
  };
  productEvents: Array<{ name: string; count: number }>;
}

async function loadAiMetrics(database: ReturnType<typeof dbPostgres>) {
  const metricTable = schemaTable('coach_ai_request_metric');
  const catalogAiTable = schemaTable('coach_catalog_ai_generation');
  const catalogAuditTable = schemaTable('coach_catalog_review_audit');
  try {
    const [summaryResult, surfaceResult, catalogAiResult] = await Promise.all([
      database.execute(sql`
        SELECT
          count(*) FILTER (WHERE status IN ('succeeded', 'failed'))::integer AS total_requests,
          count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded_requests,
          count(*) FILTER (WHERE fallback_from IS NOT NULL AND status IN ('succeeded', 'failed'))::integer AS fallback_requests,
          count(*) FILTER (WHERE usage_reported = false AND status IN ('succeeded', 'failed'))::integer AS usage_missing_requests,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status IN ('succeeded', 'failed')), 0)::double precision AS p95_latency_ms,
          COALESCE(sum(estimated_cost_micro_usd), 0)::bigint AS estimated_cost_micro_usd
        FROM ${metricTable}
        WHERE mode = 'live'
          AND surface IN ('artifact', 'chat')
          AND created_at >= now() - (${WINDOW_DAYS} * interval '1 day')
      `),
      database.execute(sql`
        SELECT
          surface,
          count(*) FILTER (WHERE status IN ('succeeded', 'failed'))::integer AS requests,
          count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded_requests,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status IN ('succeeded', 'failed')), 0)::double precision AS p95_latency_ms,
          COALESCE(sum(estimated_cost_micro_usd), 0)::bigint AS estimated_cost_micro_usd
        FROM ${metricTable}
        WHERE mode = 'live'
          AND created_at >= now() - (${WINDOW_DAYS} * interval '1 day')
        GROUP BY surface
        HAVING count(*) FILTER (WHERE status IN ('succeeded', 'failed')) > 0
        ORDER BY requests DESC, surface ASC
      `),
      database.execute(sql`
        WITH catalog_outcomes AS (
          SELECT
            'succeeded'::text AS status,
            COALESCE((metadata->>'latencyMs')::double precision, 0) AS latency_ms,
            COALESCE((metadata->>'estimatedCostUsd')::double precision, 0) AS estimated_cost_usd
          FROM ${catalogAiTable}
          WHERE created_at >= now() - (${WINDOW_DAYS} * interval '1 day')
            AND provider = 'ai-relay'
            AND kind = 'review_summary'
          UNION ALL
          SELECT
            'failed'::text AS status,
            COALESCE((metadata->'aiFailureMetadata'->>'latencyMs')::double precision, 0) AS latency_ms,
            COALESCE((metadata->'aiFailureMetadata'->>'reservedCostUsd')::double precision, 0) AS estimated_cost_usd
          FROM ${catalogAuditTable}
          WHERE created_at >= now() - (${WINDOW_DAYS} * interval '1 day')
            AND action = 'submitted'
            AND metadata->>'aiDraftOutcome' = 'failed_fallback'
        )
        SELECT
          count(*)::integer AS requests,
          count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded_requests,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::double precision AS p95_latency_ms,
          COALESCE(sum(estimated_cost_usd), 0)::double precision AS estimated_cost_usd
        FROM catalog_outcomes
      `),
    ]);
    const summary = firstRow(summaryResult);
    const totalRequests = numeric(summary.total_requests);
    const succeededRequests = numeric(summary.succeeded_requests);
    const fallbackRequests = numeric(summary.fallback_requests);
    const bySurface = rows(surfaceResult).map((row) => {
      const requests = numeric(row.requests);
      return {
        surface: String(row.surface ?? 'unknown'),
        requests,
        successRate: requests ? numeric(row.succeeded_requests) / requests : 0,
        p95LatencyMs: numeric(row.p95_latency_ms),
        estimatedCostUsd: numeric(row.estimated_cost_micro_usd) / 1_000_000,
      };
    });
    const catalogAi = firstRow(catalogAiResult);
    const catalogRequests = numeric(catalogAi.requests);
    if (catalogRequests) {
      bySurface.push({
        surface: 'catalog_draft',
        requests: catalogRequests,
        successRate: numeric(catalogAi.succeeded_requests) / catalogRequests,
        p95LatencyMs: numeric(catalogAi.p95_latency_ms),
        estimatedCostUsd: numeric(catalogAi.estimated_cost_usd),
      });
    }
    return {
      available: true,
      totalRequests,
      succeededRequests,
      successRate: totalRequests ? succeededRequests / totalRequests : 0,
      p95LatencyMs: numeric(summary.p95_latency_ms),
      fallbackRequests,
      fallbackRate: totalRequests ? fallbackRequests / totalRequests : 0,
      usageMissingRequests: numeric(summary.usage_missing_requests),
      estimatedCostUsd: numeric(summary.estimated_cost_micro_usd) / 1_000_000,
      bySurface,
    };
  } catch (error) {
    const code =
      (error as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (error as { code?: string }).code;
    if (code !== '42P01') throw error;
    return {
      available: false,
      totalRequests: 0,
      succeededRequests: 0,
      successRate: 0,
      p95LatencyMs: 0,
      fallbackRequests: 0,
      fallbackRate: 0,
      usageMissingRequests: 0,
      estimatedCostUsd: 0,
      bySurface: [],
    };
  }
}

export async function loadBetaOperationsMetrics(): Promise<BetaOperationsMetrics> {
  const database = dbPostgres();
  const cohortView = schemaTable('coach_cohort_metric_v');
  const eventTable = schemaTable('coach_product_event');
  const problemTable = schemaTable('coach_problem');
  const candidateTable = schemaTable('coach_problem_candidate');
  const syncRunTable = schemaTable('coach_catalog_sync_run');

  const [ai, learningResult, eventResult, catalogResult, syncResult] =
    await Promise.all([
      loadAiMetrics(database),
      database.execute(sql`
        SELECT
          count(*)::integer AS users,
          (SELECT count(DISTINCT user_id)::integer FROM ${eventTable}
            WHERE occurred_at >= now() - (${WINDOW_DAYS} * interval '1 day')) AS active_users,
          count(*) FILTER (WHERE activated)::integer AS activated_users,
          count(*) FILTER (WHERE first_value_reached)::integer AS first_value_users,
          count(*) FILTER (WHERE cohort_started_at <= now() - interval '1 day')::integer AS eligible_d1_users,
          count(*) FILTER (WHERE retained_d1)::integer AS retained_d1_users,
          count(*) FILTER (WHERE cohort_started_at <= now() - interval '7 days')::integer AS eligible_d7_users,
          count(*) FILTER (WHERE retained_d7)::integer AS retained_d7_users,
          COALESCE(sum(effective_practices), 0)::integer AS effective_practices,
          COALESCE(avg(daily_plan_completion_rate), 0)::double precision AS daily_plan_completion_rate,
          COALESCE(avg(diagnosis_three_run_pass_rate) FILTER (WHERE correction_episodes > 0), 0)::double precision AS diagnosis_three_run_pass_rate
        FROM ${cohortView}
      `),
      database.execute(sql`
        SELECT name, count(*)::integer AS count
        FROM ${eventTable}
        WHERE occurred_at >= now() - (${WINDOW_DAYS} * interval '1 day')
        GROUP BY name
        ORDER BY count DESC, name ASC
        LIMIT 12
      `),
      database.execute(sql`
        SELECT
          (SELECT count(*)::integer FROM ${problemTable}
            WHERE owner_user_id IS NULL AND status = 'published') AS published_problems,
          COALESCE(sum(status_count) FILTER (WHERE status IN ('discovered', 'drafting', 'quarantined', 'validated', 'approved')), 0)::integer AS candidate_backlog,
          min(created_at) FILTER (WHERE status IN ('discovered', 'drafting', 'quarantined', 'validated', 'approved')) AS oldest_backlog_at,
          COALESCE(jsonb_object_agg(status, status_count), '{}'::jsonb) AS candidates_by_status
        FROM (
          SELECT status, count(*)::integer AS status_count, min(created_at) AS created_at
          FROM ${candidateTable}
          GROUP BY status
        ) AS candidate_counts
      `),
      database.execute(sql`
        SELECT
          count(*)::integer AS sync_runs,
          count(*) FILTER (WHERE status = 'succeeded')::integer AS successful_sync_runs,
          count(*) FILTER (WHERE status IN ('failed', 'partial'))::integer AS failed_sync_runs,
          (array_agg(status ORDER BY created_at DESC))[1] AS latest_status,
          (array_agg(upstream_revision ORDER BY created_at DESC))[1] AS latest_upstream_revision,
          (array_agg(completed_at ORDER BY created_at DESC))[1] AS latest_completed_at
        FROM ${syncRunTable}
        WHERE created_at >= now() - (${WINDOW_DAYS} * interval '1 day')
      `),
    ]);

  const learning = firstRow(learningResult);
  const users = numeric(learning.users);
  const activeUsers = numeric(learning.active_users);
  const activatedUsers = numeric(learning.activated_users);
  const firstValueUsers = numeric(learning.first_value_users);
  const eligibleD1Users = numeric(learning.eligible_d1_users);
  const retainedD1Users = numeric(learning.retained_d1_users);
  const eligibleD7Users = numeric(learning.eligible_d7_users);
  const retainedD7Users = numeric(learning.retained_d7_users);
  const catalog = firstRow(catalogResult);
  const sync = firstRow(syncResult);
  const rawStatusCounts =
    catalog.candidates_by_status &&
    typeof catalog.candidates_by_status === 'object'
      ? (catalog.candidates_by_status as Record<string, unknown>)
      : {};
  const candidatesByStatus = Object.fromEntries(
    Object.entries(rawStatusCounts).map(([key, value]) => [key, numeric(value)])
  );
  const syncRuns = numeric(sync.sync_runs);

  return {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    ai,
    learning: {
      users,
      activeUsers,
      activatedUsers,
      activationRate: users ? activatedUsers / users : 0,
      firstValueUsers,
      firstValueRate: users ? firstValueUsers / users : 0,
      eligibleD1Users,
      retainedD1Users,
      retainedD1Rate: eligibleD1Users ? retainedD1Users / eligibleD1Users : 0,
      eligibleD7Users,
      retainedD7Users,
      retainedD7Rate: eligibleD7Users ? retainedD7Users / eligibleD7Users : 0,
      effectivePractices: numeric(learning.effective_practices),
      dailyPlanCompletionRate: numeric(learning.daily_plan_completion_rate),
      diagnosisThreeRunPassRate: numeric(
        learning.diagnosis_three_run_pass_rate
      ),
    },
    catalog: {
      publishedProblems: numeric(catalog.published_problems),
      candidateBacklog: numeric(catalog.candidate_backlog),
      candidatesByStatus,
      oldestBacklogAt: nullableDate(catalog.oldest_backlog_at),
      syncRuns,
      successfulSyncRuns: numeric(sync.successful_sync_runs),
      failedSyncRuns: numeric(sync.failed_sync_runs),
      latestSync: syncRuns
        ? {
            status: String(sync.latest_status ?? 'unknown'),
            upstreamRevision: sync.latest_upstream_revision
              ? String(sync.latest_upstream_revision)
              : undefined,
            completedAt: nullableDate(sync.latest_completed_at),
          }
        : undefined,
    },
    productEvents: rows(eventResult).map((row) => ({
      name: String(row.name ?? 'unknown'),
      count: numeric(row.count),
    })),
  };
}
