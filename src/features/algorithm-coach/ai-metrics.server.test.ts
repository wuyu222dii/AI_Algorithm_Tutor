import { describe, expect, it } from 'vitest';

import {
  normalizeCoachAiRequestMetric,
  relayOriginFromEnvironment,
} from './ai-metrics.server';

describe('AI request metrics', () => {
  it('stores only the relay origin and bounded operational values', () => {
    const metric = normalizeCoachAiRequestMetric({
      traceId: 'trace-1',
      surface: 'artifact',
      action: 'diagnose',
      status: 'succeeded',
      latencyMs: 1_240.4,
      attempts: 2,
      usageReported: false,
      usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
      estimatedCostUsd: 0.0023456,
    });

    expect(metric).toMatchObject({
      traceId: 'trace-1',
      surface: 'artifact',
      action: 'diagnose',
      status: 'succeeded',
      latencyMs: 1240,
      attempts: 2,
      usageReported: false,
      estimatedCostMicroUsd: 2346,
    });
    expect(metric).not.toHaveProperty('prompt');
    expect(metric).not.toHaveProperty('code');
  });

  it('prefers the relay URL and strips path, credentials and query data', () => {
    expect(
      relayOriginFromEnvironment({
        AI_RELAY_BASE_URL:
          'https://relay-user:relay-pass@codeapix.top/v1?key=secret',
        OPENROUTER_BASE_URL: 'https://legacy.example/v1',
      })
    ).toBe('https://codeapix.top');
  });

  it('uses the legacy base URL for one-version compatibility', () => {
    expect(
      relayOriginFromEnvironment({
        OPENROUTER_BASE_URL: 'https://legacy.example/v1',
      })
    ).toBe('https://legacy.example');
  });

  it('does not report a legacy origin for a partial new relay pair', () => {
    expect(
      relayOriginFromEnvironment({
        AI_RELAY_API_KEY: 'new-secret',
        OPENROUTER_BASE_URL: 'https://legacy.example/v1',
      })
    ).toBeUndefined();
  });

  it('records zero provider attempts when a circuit rejects before transport', () => {
    expect(
      normalizeCoachAiRequestMetric({
        traceId: 'trace-circuit-open',
        surface: 'artifact',
        action: 'hint',
        status: 'failed',
        latencyMs: 1,
        attempts: 0,
      }).attempts
    ).toBe(0);
  });
});
