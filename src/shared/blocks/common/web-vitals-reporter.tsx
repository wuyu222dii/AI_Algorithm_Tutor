'use client';

import { useEffect, useRef } from 'react';
import { useReportWebVitals } from 'next/web-vitals';
import * as Sentry from '@sentry/nextjs';

import {
  evaluateWebVitalBudget,
  isBudgetedWebVital,
  parseWebVitalsSampleRate,
  shouldSampleWebVitals,
} from '@/shared/lib/web-vitals';

const sampleRate = parseWebVitalsSampleRate(
  process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE
);

export function WebVitalsReporter() {
  const sampled = useRef(false);

  useEffect(() => {
    sampled.current = shouldSampleWebVitals(sampleRate, Math.random());
  }, []);

  useReportWebVitals((metric) => {
    if (
      !sampled.current ||
      !process.env.NEXT_PUBLIC_SENTRY_DSN ||
      !isBudgetedWebVital(metric)
    ) {
      return;
    }

    const result = evaluateWebVitalBudget(metric);
    const attributes = {
      metric: result.metric,
      rating: result.rating,
      budget_status: result.status,
      navigation_type: result.navigationType,
    };

    // Only curated numeric values and low-cardinality labels leave the browser.
    // URLs, element selectors, metric entries, users, and navigation IDs are omitted.
    Sentry.metrics.distribution(
      `algocoach.web_vitals.${result.metric.toLowerCase()}`,
      result.value,
      { unit: result.unit, attributes }
    );
    Sentry.metrics.count('algocoach.web_vitals.budget_evaluation', 1, {
      attributes,
    });
  });

  return null;
}
