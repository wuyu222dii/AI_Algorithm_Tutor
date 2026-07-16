import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => {
  class MockCoachModelError extends Error {
    public readonly attempts = 1;

    constructor(
      message: string,
      public readonly code: 'model_not_allowed' | 'provider_failed',
      public readonly reason = 'unknown',
      public readonly selectedModel?: string,
      public readonly fallbackFrom?: string
    ) {
      super(message);
      this.name = 'CoachModelError';
    }
  }

  class MockCoachChatCancelledError extends Error {
    constructor() {
      super('cancelled');
      this.name = 'CoachChatCancelledError';
    }
  }

  return {
    CoachChatCancelledError: MockCoachChatCancelledError,
    CoachModelError: MockCoachModelError,
    acquireCoachCapacity: vi.fn(),
    commitCoachConservativeUsage: vi.fn(),
    commitCoachFailedUsage: vi.fn(),
    commitCoachUsage: vi.fn(),
    enforceCoachRateLimits: vi.fn(),
    getCoachRuntimeConfig: vi.fn(),
    recordCoachAiRequestMetric: vi.fn(),
    recordOperationalEvent: vi.fn(),
    streamLiveCoachChat: vi.fn(),
    releaseCoachCapacity: vi.fn(),
  };
});

vi.mock('@/features/algorithm-coach/rate-limit.server', () => ({
  acquireCoachCapacity: mocks.acquireCoachCapacity,
  commitCoachConservativeUsage: mocks.commitCoachConservativeUsage,
  commitCoachFailedUsage: mocks.commitCoachFailedUsage,
  commitCoachUsage: mocks.commitCoachUsage,
  enforceCoachRateLimits: mocks.enforceCoachRateLimits,
  releaseCoachCapacity: mocks.releaseCoachCapacity,
}));

vi.mock('@/features/algorithm-coach/ai-metrics.server', () => ({
  recordCoachAiRequestMetric: mocks.recordCoachAiRequestMetric,
  relayOriginFromBaseUrl: (value?: string) =>
    value ? new URL(value).origin : undefined,
}));

vi.mock('@/features/algorithm-coach/server', () => ({
  COACH_CHAT_MAX_OUTPUT_TOKENS: 500,
  COACH_PROMPT_VERSION: 'coach-test-v1',
  CoachChatCancelledError: mocks.CoachChatCancelledError,
  CoachModelError: mocks.CoachModelError,
  getCoachRuntimeConfig: mocks.getCoachRuntimeConfig,
  streamLiveCoachChat: mocks.streamLiveCoachChat,
}));

vi.mock('@/shared/lib/observability', () => ({
  recordOperationalEvent: mocks.recordOperationalEvent,
}));

function chatRequest() {
  return new Request('http://localhost/api/coach/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      problemSlug: 'dependency-cycle',
      locale: 'zh',
      messages: [{ role: 'user', content: '我应该从哪里开始？' }],
    }),
  });
}

describe('POST /api/coach/chat provider fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('COACH_DEMO_FALLBACK_ENABLED', 'true');
    mocks.enforceCoachRateLimits.mockResolvedValue(null);
    mocks.acquireCoachCapacity.mockResolvedValue({
      id: 'lease-1',
      identity: 'guest:test',
      backend: 'memory',
      reservedTokens: 1000,
      reservedCostMicroUsd: 1000,
      expiresAt: Date.now() + 1000,
      settled: false,
    });
    mocks.commitCoachFailedUsage.mockResolvedValue({
      totalTokens: 1000,
      estimatedCostUsd: 0.008,
    });
    mocks.commitCoachConservativeUsage.mockResolvedValue({
      totalTokens: 1000,
      estimatedCostUsd: 0.008,
    });
    mocks.commitCoachUsage.mockResolvedValue({
      totalTokens: 15,
      estimatedCostUsd: 0.00003,
    });
    mocks.releaseCoachCapacity.mockResolvedValue(undefined);
    mocks.getCoachRuntimeConfig.mockResolvedValue({
      apiKey: 'configured-test-key',
      baseURL: 'https://provider.example/v1',
      model: 'gpt-5.5',
    });
    mocks.streamLiveCoachChat.mockRejectedValue(
      new mocks.CoachModelError(
        'No available channel for the configured model',
        'provider_failed',
        'channel_unavailable'
      )
    );
    mocks.recordOperationalEvent.mockResolvedValue(undefined);
    mocks.recordCoachAiRequestMetric.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns local chat guidance when a development provider cannot start', async () => {
    const response = await POST(chatRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-coach-mode')).toBe('local');
    expect(response.headers.get('x-coach-model')).toBe('deterministic-demo');
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain('No available channel');
    expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'coach_chat_provider_fallback',
        level: 'warn',
      })
    );
    expect(mocks.commitCoachFailedUsage).toHaveBeenCalledWith(
      expect.anything(),
      1
    );
    expect(mocks.recordCoachAiRequestMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'chat',
        status: 'failed',
        errorCode: 'channel_unavailable',
        estimatedCostUsd: 0.008,
      })
    );
  });

  it('returns a sanitized 502 instead of local chat in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await POST(chatRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('x-coach-mode')).toBeNull();
    expect(body.error).toMatchObject({
      code: 'provider_unavailable',
      message: 'The AI provider is temporarily unavailable.',
    });
    expect(JSON.stringify(body)).not.toContain('No available channel');
  });

  it('records successful stream usage after the response completes', async () => {
    mocks.streamLiveCoachChat.mockResolvedValue({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('先找不变量。'));
          controller.close();
        },
      }),
      selectedModel: 'relay-primary',
      attempts: 1,
      completion: Promise.resolve({
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        usageReported: true,
        estimatedCostUsd: 0.00003,
      }),
    });

    const response = await POST(chatRequest());
    await expect(response.text()).resolves.toContain('不变量');
    await vi.waitFor(() => {
      expect(mocks.recordCoachAiRequestMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'chat',
          status: 'succeeded',
          selectedModel: 'relay-primary',
          usageReported: true,
        })
      );
    });
  });

  it('settles a cancelled stream without counting a relay failure', async () => {
    mocks.streamLiveCoachChat.mockResolvedValue({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      selectedModel: 'relay-primary',
      attempts: 1,
      completion: Promise.reject(new mocks.CoachChatCancelledError()),
    });

    const response = await POST(chatRequest());
    await response.text();
    await vi.waitFor(() => {
      expect(mocks.commitCoachConservativeUsage).toHaveBeenCalled();
      expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'coach_chat_cancelled' })
      );
    });
    expect(mocks.recordCoachAiRequestMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'chat',
        status: 'cancelled',
        estimatedCostUsd: 0.008,
      })
    );
  });
});
