import { describe, expect, it } from 'vitest';

import {
  evaluateWebVitalBudget,
  isBudgetedWebVital,
  parseWebVitalsSampleRate,
  shouldSampleWebVitals,
} from './web-vitals';

describe('Web Vitals reporting policy', () => {
  it('clamps the public sampling configuration', () => {
    expect(parseWebVitalsSampleRate(undefined)).toBe(0.1);
    expect(parseWebVitalsSampleRate('0.25')).toBe(0.25);
    expect(parseWebVitalsSampleRate('-1')).toBe(0);
    expect(parseWebVitalsSampleRate('2')).toBe(1);
    expect(parseWebVitalsSampleRate('invalid')).toBe(0);
  });

  it('uses a stable session decision against the configured sample rate', () => {
    expect(shouldSampleWebVitals(0, 0)).toBe(false);
    expect(shouldSampleWebVitals(1, 0.99)).toBe(true);
    expect(shouldSampleWebVitals(0.1, 0.09)).toBe(true);
    expect(shouldSampleWebVitals(0.1, 0.1)).toBe(false);
  });

  it('classifies the public beta LCP, INP, and CLS budgets', () => {
    expect(
      evaluateWebVitalBudget({
        name: 'LCP',
        value: 2_500,
        rating: 'good',
      })
    ).toMatchObject({ status: 'within_budget', limit: 2_500 });
    expect(
      evaluateWebVitalBudget({
        name: 'INP',
        value: 201,
        rating: 'needs-improvement',
      })
    ).toMatchObject({ status: 'over_budget', limit: 200 });
    expect(
      evaluateWebVitalBudget({
        name: 'CLS',
        value: 0.11,
        rating: 'poor',
      })
    ).toMatchObject({ status: 'over_budget', limit: 0.1, unit: 'ratio' });
  });

  it('rejects non-core and non-finite browser metrics', () => {
    expect(isBudgetedWebVital({ name: 'TTFB', value: 10 })).toBe(false);
    expect(isBudgetedWebVital({ name: 'LCP', value: Number.NaN })).toBe(false);
    expect(isBudgetedWebVital({ name: 'CLS', value: 0.01 })).toBe(true);
  });
});
