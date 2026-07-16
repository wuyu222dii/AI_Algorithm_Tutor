import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  probeAiRelayChat: vi.fn(),
  recordOperationalEvent: vi.fn(),
  recordCoachAiRequestMetric: vi.fn(),
}));

vi.mock(
  '@/features/algorithm-coach/relay-preflight',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/features/algorithm-coach/relay-preflight')
    >()),
    probeAiRelayChat: mocks.probeAiRelayChat,
  })
);
vi.mock('@/shared/lib/observability', () => ({
  recordOperationalEvent: mocks.recordOperationalEvent,
}));
vi.mock('@/features/algorithm-coach/ai-metrics.server', () => ({
  recordCoachAiRequestMetric: mocks.recordCoachAiRequestMetric,
  relayOriginFromEnvironment: () => 'https://relay.example',
}));

const token = 'a-canary-token-with-at-least-32-characters';

function request(authorization?: string) {
  return new Request('https://algocoach.example/api/health/ai-relay', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });
}

describe('protected AI relay canary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AI_RELAY_CANARY_TOKEN', token);
    vi.stubEnv('AI_RELAY_API_KEY', 'private-relay-key');
    vi.stubEnv('AI_RELAY_BASE_URL', 'https://relay.example/v1');
    vi.stubEnv('AI_RELAY_PRIMARY_MODEL', 'relay-primary');
    vi.stubEnv('AI_RELAY_FALLBACK_MODEL', 'relay-fallback');
    mocks.probeAiRelayChat.mockResolvedValue({
      requestId: 'provider-request',
      usageReported: false,
      usage: { inputTokens: 10, outputTokens: 32, totalTokens: 42 },
    });
  });

  it('rejects unauthenticated probes without calling the relay', async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
    expect(mocks.probeAiRelayChat).not.toHaveBeenCalled();
  });

  it('runs a low-cost authenticated relay probe', async () => {
    const response = await POST(request(`Bearer ${token}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      models: ['relay-primary', 'relay-fallback'],
    });
    expect(mocks.probeAiRelayChat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        apiKey: 'private-relay-key',
        baseURL: 'https://relay.example/v1',
        primaryModel: 'relay-primary',
      }),
      'relay-primary'
    );
    expect(mocks.probeAiRelayChat).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'relay-fallback'
    );
    expect(mocks.recordCoachAiRequestMetric).toHaveBeenCalledTimes(2);
    expect(mocks.recordCoachAiRequestMetric).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        surface: 'canary',
        status: 'succeeded',
        selectedModel: 'relay-fallback',
      })
    );
  });

  it('returns a generic dependency error without leaking relay details', async () => {
    mocks.probeAiRelayChat.mockRejectedValue(
      new Error('sk-private relay upstream failure')
    );
    const response = await POST(request(`Bearer ${token}`));
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain('relay_unavailable');
    expect(body).not.toContain('sk-private');
  });

  it('fails when only the configured fallback model is unavailable', async () => {
    mocks.probeAiRelayChat
      .mockResolvedValueOnce({
        requestId: 'primary-ok',
        usageReported: false,
        usage: { inputTokens: 10, outputTokens: 32, totalTokens: 42 },
      })
      .mockRejectedValueOnce(new Error('fallback unavailable'));

    const response = await POST(request(`Bearer ${token}`));

    expect(response.status).toBe(503);
    expect(mocks.probeAiRelayChat).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'relay-fallback'
    );
    expect(mocks.recordCoachAiRequestMetric).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        selectedModel: 'relay-fallback',
        estimatedCostUsd: expect.any(Number),
      })
    );
    const failedMetric =
      mocks.recordCoachAiRequestMetric.mock.calls.at(-1)?.[0];
    expect(failedMetric.estimatedCostUsd).toBeGreaterThan(0);
  });
});
