import { loadBetaOperationsMetrics } from '@/features/algorithm-coach/admin-metrics.server';
import { Metric } from '@/features/algorithm-coach/components/coach-ui';
import {
  Activity,
  BrainCircuit,
  Clock3,
  Coins,
  Database,
  GitBranch,
  ListTodo,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';

import { Header, Main } from '@/shared/blocks/dashboard';
import { Badge } from '@/shared/components/ui/badge';

export const dynamic = 'force-dynamic';

function percent(value: number) {
  return `${(Math.max(0, value) * 100).toFixed(1)}%`;
}

function compactNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function dateTime(value: string | undefined, locale: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusLabel(status: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    discovered: ['已发现', 'Discovered'],
    drafting: ['生成草稿', 'Drafting'],
    quarantined: ['隔离中', 'Quarantined'],
    validated: ['已校验', 'Validated'],
    approved: ['已批准', 'Approved'],
    rejected: ['已拒绝', 'Rejected'],
    published: ['已发布', 'Published'],
    archived: ['已归档', 'Archived'],
    succeeded: ['成功', 'Succeeded'],
    partial: ['部分成功', 'Partial'],
    failed: ['失败', 'Failed'],
  };
  return labels[status]?.[zh ? 0 : 1] ?? status;
}

export default async function BetaMetricsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const zh = locale === 'zh';
  const metrics = await loadBetaOperationsMetrics();
  const syncSuccessRate = metrics.catalog.syncRuns
    ? metrics.catalog.successfulSyncRuns / metrics.catalog.syncRuns
    : 0;

  return (
    <>
      <Header
        title={zh ? '公测运营指标' : 'Beta operations'}
        show_locale
        show_theme
      />
      <Main>
        <div className="mx-auto w-full max-w-7xl space-y-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-normal">
                {zh ? '运行状态与学习漏斗' : 'Operations and learning funnel'}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {zh
                  ? `AI、同步与事件窗口为最近 ${metrics.windowDays} 天；学习漏斗按全部已注册 cohort 计算；不采集代码、题面或凭据`
                  : `AI, sync, and event window: ${metrics.windowDays} days; learning funnel: all registered cohorts; no code, statements, or credentials`}
              </p>
            </div>
            <p className="text-muted-foreground text-xs tabular-nums">
              {zh ? '生成于' : 'Generated'}{' '}
              {dateTime(metrics.generatedAt, locale)}
            </p>
          </div>

          <section aria-labelledby="ai-metrics-title" className="space-y-4">
            <div className="flex items-center justify-between gap-3 border-b pb-3">
              <div className="flex min-w-0 items-center gap-2">
                <BrainCircuit className="text-primary size-4 shrink-0" />
                <h2 id="ai-metrics-title" className="text-sm font-semibold">
                  {zh ? '中转站 AI' : 'AI relay'}
                </h2>
              </div>
              <Badge variant={metrics.ai.available ? 'outline' : 'destructive'}>
                {metrics.ai.available
                  ? zh
                    ? '指标已启用'
                    : 'Metrics enabled'
                  : zh
                    ? '需要迁移 0022'
                    : 'Migration 0022 required'}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label={zh ? '请求成功率' : 'Request success'}
                value={percent(metrics.ai.successRate)}
                detail={`${metrics.ai.succeededRequests}/${metrics.ai.totalRequests}`}
                icon={<Activity className="size-4" />}
                accent={metrics.ai.successRate >= 0.995 ? 'success' : 'amber'}
              />
              <Metric
                label={zh ? 'P95 延迟' : 'P95 latency'}
                value={`${Math.round(metrics.ai.p95LatencyMs)} ms`}
                detail={zh ? '端到端生成' : 'End-to-end generation'}
                icon={<Clock3 className="size-4" />}
                accent={metrics.ai.p95LatencyMs <= 8_000 ? 'success' : 'amber'}
              />
              <Metric
                label={zh ? '备用模型切换' : 'Model fallback'}
                value={percent(metrics.ai.fallbackRate)}
                detail={`${metrics.ai.fallbackRequests} ${zh ? '次' : 'requests'}`}
                icon={<GitBranch className="size-4" />}
              />
              <Metric
                label={zh ? '估算成本' : 'Estimated cost'}
                value={`$${metrics.ai.estimatedCostUsd.toFixed(4)}`}
                detail={`${zh ? `${metrics.windowDays} 日流量合计` : `${metrics.windowDays}-day traffic total`} · ${metrics.ai.usageMissingRequests} ${zh ? '次无 usage' : 'missing usage'}`}
                icon={<Coins className="size-4" />}
              />
            </div>
            {metrics.ai.bySurface.length ? (
              <div className="divide-y rounded-md border">
                {metrics.ai.bySurface.map((item) => (
                  <div
                    key={item.surface}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {item.surface}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {item.requests} {zh ? '次' : 'req'}
                    </span>
                    <span className="w-20 text-right tabular-nums">
                      {percent(item.successRate)}
                    </span>
                    <span className="col-span-2 col-start-2 w-full text-right tabular-nums sm:col-span-1 sm:col-start-auto sm:w-20">
                      ${item.estimatedCostUsd.toFixed(4)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section
            aria-labelledby="learning-metrics-title"
            className="space-y-4"
          >
            <div className="flex items-center gap-2 border-b pb-3">
              <TrendingUp className="text-primary size-4" />
              <h2 id="learning-metrics-title" className="text-sm font-semibold">
                {zh ? '学习效果' : 'Learning outcomes'}
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label={zh ? '激活率' : 'Activation'}
                value={percent(metrics.learning.activationRate)}
                detail={`${metrics.learning.activatedUsers}/${metrics.learning.users}`}
                icon={<Users className="size-4" />}
              />
              <Metric
                label={zh ? '首次价值达成' : 'First value'}
                value={percent(metrics.learning.firstValueRate)}
                detail={`${metrics.learning.firstValueUsers}/${metrics.learning.users}`}
                icon={<Activity className="size-4" />}
              />
              <Metric
                label="D1 / D7"
                value={`${percent(metrics.learning.retainedD1Rate)} / ${percent(metrics.learning.retainedD7Rate)}`}
                detail={`${metrics.learning.retainedD1Users}/${metrics.learning.eligibleD1Users} · ${metrics.learning.retainedD7Users}/${metrics.learning.eligibleD7Users}`}
                icon={<RefreshCw className="size-4" />}
              />
              <Metric
                label={zh ? '有效练习' : 'Effective practices'}
                value={compactNumber(
                  metrics.learning.effectivePractices,
                  locale
                )}
                detail={`${metrics.learning.activeUsers} ${zh ? '名近 7 日活跃用户' : 'active users in 7 days'}`}
                icon={<ListTodo className="size-4" />}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Metric
                label={zh ? '每日计划完成率' : 'Daily plan completion'}
                value={percent(metrics.learning.dailyPlanCompletionRate)}
              />
              <Metric
                label={
                  zh
                    ? '诊断后 3 次内通过率'
                    : 'Passed within 3 runs after diagnosis'
                }
                value={percent(metrics.learning.diagnosisThreeRunPassRate)}
              />
            </div>
          </section>

          <section
            aria-labelledby="catalog-metrics-title"
            className="space-y-4"
          >
            <div className="flex items-center gap-2 border-b pb-3">
              <Database className="text-primary size-4" />
              <h2 id="catalog-metrics-title" className="text-sm font-semibold">
                {zh ? '题库同步' : 'Catalog sync'}
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label={zh ? '发布题目' : 'Published problems'}
                value={String(metrics.catalog.publishedProblems)}
                icon={<Database className="size-4" />}
              />
              <Metric
                label={zh ? '待审核积压' : 'Candidate backlog'}
                value={String(metrics.catalog.candidateBacklog)}
                detail={
                  metrics.catalog.oldestBacklogAt
                    ? `${zh ? '最早' : 'Oldest'} ${dateTime(metrics.catalog.oldestBacklogAt, locale)}`
                    : undefined
                }
                icon={<ListTodo className="size-4" />}
                accent={
                  metrics.catalog.candidateBacklog >= 50 ? 'danger' : 'amber'
                }
              />
              <Metric
                label={zh ? '同步成功率' : 'Sync success'}
                value={percent(syncSuccessRate)}
                detail={`${metrics.catalog.successfulSyncRuns}/${metrics.catalog.syncRuns}`}
                icon={<RefreshCw className="size-4" />}
              />
              <Metric
                label={zh ? '最近同步' : 'Latest sync'}
                value={
                  metrics.catalog.latestSync
                    ? statusLabel(metrics.catalog.latestSync.status, zh)
                    : '-'
                }
                detail={dateTime(
                  metrics.catalog.latestSync?.completedAt,
                  locale
                )}
                icon={<Activity className="size-4" />}
              />
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-normal uppercase">
                  {zh ? '候选状态' : 'Candidate status'}
                </h3>
                <div className="divide-y rounded-md border">
                  {Object.entries(metrics.catalog.candidatesByStatus).map(
                    ([status, count]) => (
                      <div
                        key={status}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                      >
                        <span>{statusLabel(status, zh)}</span>
                        <span className="font-medium tabular-nums">
                          {count}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-normal uppercase">
                  {zh ? '关键学习事件' : 'Key learning events'}
                </h3>
                <div className="divide-y rounded-md border">
                  {metrics.productEvents.map((event) => (
                    <div
                      key={event.name}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <span className="min-w-0 truncate">{event.name}</span>
                      <span className="font-medium tabular-nums">
                        {event.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </Main>
    </>
  );
}
