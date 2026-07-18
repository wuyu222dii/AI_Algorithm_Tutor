export const WEB_VITAL_BUDGETS = {
  LCP: { limit: 2_500, unit: 'millisecond' },
  INP: { limit: 200, unit: 'millisecond' },
  CLS: { limit: 0.1, unit: 'ratio' },
} as const;

export type BudgetedWebVitalName = keyof typeof WEB_VITAL_BUDGETS;

export interface BudgetedWebVital {
  name: BudgetedWebVitalName;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  navigationType?: string;
}

export interface WebVitalBudgetResult {
  metric: BudgetedWebVitalName;
  value: number;
  limit: number;
  unit: 'millisecond' | 'ratio';
  status: 'within_budget' | 'over_budget';
  rating: BudgetedWebVital['rating'];
  navigationType: string;
}

export function parseWebVitalsSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0.1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

export function shouldSampleWebVitals(
  sampleRate: number,
  randomValue: number
): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  return randomValue < sampleRate;
}

export function evaluateWebVitalBudget(
  metric: BudgetedWebVital
): WebVitalBudgetResult {
  const budget = WEB_VITAL_BUDGETS[metric.name];
  return {
    metric: metric.name,
    value: metric.value,
    limit: budget.limit,
    unit: budget.unit,
    status: metric.value <= budget.limit ? 'within_budget' : 'over_budget',
    rating: metric.rating,
    navigationType: metric.navigationType ?? 'unknown',
  };
}

export function isBudgetedWebVital(metric: {
  name?: string;
  value?: number;
}): metric is BudgetedWebVital {
  return (
    (metric.name === 'LCP' || metric.name === 'INP' || metric.name === 'CLS') &&
    typeof metric.value === 'number' &&
    Number.isFinite(metric.value)
  );
}
