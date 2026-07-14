import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetCoachModelCircuits } from './model';
import { generateLiveArtifact, type CoachRuntimeConfig } from './server';
import type { CoachRequest } from './types';

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => ({ chat: (model: string) => model }),
}));
vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  streamText: vi.fn(),
}));
vi.mock('@/shared/models/config', () => ({ getAllConfigs: vi.fn() }));

const config: CoachRuntimeConfig = {
  apiKey: 'test-key',
  model: 'openai/gpt-5.5',
  fallbackModel: 'google/gemini-2.5-flash',
  timeoutMs: 1000,
};

const hintRequest: CoachRequest = {
  action: 'hint',
  locale: 'zh',
  problemSlug: 'dependency-cycle',
  hintLevel: 1,
};

function generatedHint() {
  return {
    object: {
      title: '方向提示',
      summary: '先确定状态含义。',
      details: ['检查访问状态。'],
      nextAction: '写出一个状态转移。',
      hint: {
        level: 1,
        principle: '区分未访问、访问中和已完成。',
        direction: null,
        pseudocode: null,
      },
    },
    finishReason: 'stop',
    usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
  };
}

describe('live coach model routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COACH_INPUT_COST_PER_MILLION_USD', '');
    vi.stubEnv('COACH_OUTPUT_COST_PER_MILLION_USD', '');
    resetCoachModelCircuits();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails over once after an unavailable primary model', async () => {
    mocks.generateObject
      .mockRejectedValueOnce({ statusCode: 503, message: 'unavailable' })
      .mockResolvedValueOnce(generatedHint());

    const generation = await generateLiveArtifact(hintRequest, config);

    expect(mocks.generateObject).toHaveBeenCalledTimes(2);
    expect(generation.selectedModel).toBe('google/gemini-2.5-flash');
    expect(generation.fallbackFrom).toBe('openai/gpt-5.5');
    expect(generation.attempts).toBe(2);
    expect(generation.usage.totalTokens).toBe(140);
    expect(generation.estimatedCostUsd).toBe(0.0006);
  });

  it('does not spend the fallback on an invalid structured output', async () => {
    mocks.generateObject.mockRejectedValue(
      new Error('schema validation failed')
    );

    await expect(
      generateLiveArtifact(hintRequest, config)
    ).rejects.toMatchObject({
      code: 'provider_failed',
      reason: 'invalid_output',
      attempts: 2,
    });
    expect(mocks.generateObject).toHaveBeenCalledTimes(2);
    expect(mocks.generateObject.mock.calls[1]?.[0].system).toContain(
      'previous response failed schema'
    );
  });

  it('blocks complete arrow-function solutions returned as prose', async () => {
    const leaked = generatedHint();
    leaked.object.summary =
      'const solve = (values) => { for (const value of values) { return value; } };';
    mocks.generateObject.mockResolvedValue(leaked);

    await expect(
      generateLiveArtifact(hintRequest, config)
    ).rejects.toMatchObject({
      reason: 'invalid_output',
      attempts: 2,
    });
    expect(mocks.generateObject).toHaveBeenCalledTimes(2);
  });

  it('binds diagnosis category and evidence to the real failed run', async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: {
        title: '诊断',
        summary: '检查边界。',
        details: ['从失败位置回溯。'],
        nextAction: '重新运行。',
        diagnosisCategory: 'runtime',
      },
      finishReason: 'stop',
      usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
    });
    const request: CoachRequest = {
      action: 'diagnose',
      locale: 'zh',
      problemSlug: 'dependency-cycle',
      runResult: {
        id: 'run-1',
        problemSlug: 'dependency-cycle',
        language: 'javascript',
        status: 'failed',
        passedTests: 0,
        totalTests: 1,
        testResults: [
          {
            testId: 'dfs-2',
            passed: false,
            expected: true,
            actual: false,
            durationMs: 1,
          },
        ],
        console: [],
        durationMs: 1,
        executedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const generation = await generateLiveArtifact(request, config);

    expect(generation.artifact.runId).toBe('run-1');
    expect(generation.artifact.diagnosisCategory).toBe('wrong-answer');
    expect(generation.providerDiagnosisCategory).toBe('runtime');
    expect(generation.artifact.evidence.join(' ')).toContain('dfs-2');
    expect(generation.artifact.details[0]).toContain('运行证据');
  });
});
