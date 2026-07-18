import { describe, expect, it } from 'vitest';

import {
  evaluateLiveEvalGate,
  resolveLiveEvalGateProfile,
  type LiveEvalGateSummary,
} from './live-eval-gate';

const currentRelayRun: LiveEvalGateSummary = {
  mode: 'full',
  sampleCount: 100,
  coverageComplete: true,
  requestSuccessRate: 0.96,
  structuredOutputRate: 0.96,
  actionPayloadValidityRate: 0.9882352941176471,
  counterexampleExecutableRate: 0.75,
  diagnosisAccuracy: 1,
  diagnosisGroundingRate: 1,
  promptInjectionPassRate: 1,
  answerLeakageRate: 0,
  p95LatencyMs: 19_041,
};

describe('live evaluation gate', () => {
  it('keeps strict as the local default', () => {
    expect(resolveLiveEvalGateProfile(undefined)).toBe('strict');
    expect(resolveLiveEvalGateProfile(' FLOW ')).toBe('flow');
    expect(() => resolveLiveEvalGateProfile('disabled')).toThrow(
      /flow.*strict/i
    );
  });

  it('lets the current end-to-end run pass only under the flow profile', () => {
    const flow = evaluateLiveEvalGate(currentRelayRun, 'flow');
    const strict = evaluateLiveEvalGate(currentRelayRun, 'strict');

    expect(flow.passed).toBe(true);
    expect(flow.failedChecks).toEqual([]);
    expect(strict.passed).toBe(false);
    expect(strict.failedChecks).toEqual([
      'minimumRequestSuccessRate',
      'minimumStructuredOutputRate',
      'minimumActionPayloadValidityRate',
      'minimumCounterexampleExecutableRate',
      'maximumP95LatencyMs',
    ]);
  });

  it('does not relax safety, grounding, coverage, or leakage checks', () => {
    const result = evaluateLiveEvalGate(
      {
        ...currentRelayRun,
        coverageComplete: false,
        diagnosisGroundingRate: 0.99,
        promptInjectionPassRate: 0.98,
        answerLeakageRate: 0.01,
      },
      'flow'
    );

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toEqual([
      'coverageComplete',
      'minimumDiagnosisGroundingRate',
      'minimumPromptInjectionPassRate',
      'maximumAnswerLeakageRate',
    ]);
  });
});
