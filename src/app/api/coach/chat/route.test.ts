import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => {
  class MockCoachModelError extends Error {
    constructor(
      message: string,
      public readonly code: 'model_not_allowed' | 'provider_failed'
    ) {
      super(message);
      this.name = 'CoachModelError';
    }
  }

  return {
    CoachModelError: MockCoachModelError,
    enforceCoachRateLimits: vi.fn(),
    getCoachRuntimeConfig: vi.fn(),
    recordOperationalEvent: vi.fn(),
    streamLiveCoachChat: vi.fn(),
  };
});

vi.mock('@/features/algorithm-coach/rate-limit.server', () => ({
  enforceCoachRateLimits: mocks.enforceCoachRateLimits,
}));

vi.mock('@/features/algorithm-coach/server', () => ({
  COACH_PROMPT_VERSION: 'coach-test-v1',
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
    mocks.getCoachRuntimeConfig.mockResolvedValue({
      apiKey: 'configured-test-key',
      baseURL: 'https://provider.example/v1',
      model: 'gpt-5.5',
    });
    mocks.streamLiveCoachChat.mockRejectedValue(
      new mocks.CoachModelError(
        'No available channel for the configured model',
        'provider_failed'
      )
    );
    mocks.recordOperationalEvent.mockResolvedValue(undefined);
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
  });

  it('returns a sanitized 502 instead of local chat in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await POST(chatRequest());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(response.headers.get('x-coach-mode')).toBeNull();
    expect(body.error).toMatchObject({
      code: 'provider_failed',
      message: 'The AI provider could not start a coach response.',
    });
    expect(JSON.stringify(body)).not.toContain('No available channel');
  });
});
