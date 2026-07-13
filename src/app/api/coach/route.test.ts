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
    generateLiveArtifact: vi.fn(),
    getCoachRuntimeConfig: vi.fn(),
    recordOperationalEvent: vi.fn(),
  };
});

vi.mock('@/features/algorithm-coach/rate-limit.server', () => ({
  enforceCoachRateLimits: mocks.enforceCoachRateLimits,
}));

vi.mock('@/features/algorithm-coach/server', () => ({
  COACH_PROMPT_VERSION: 'coach-test-v1',
  CoachModelError: mocks.CoachModelError,
  generateLiveArtifact: mocks.generateLiveArtifact,
  getCoachRuntimeConfig: mocks.getCoachRuntimeConfig,
}));

vi.mock('@/shared/lib/observability', () => ({
  recordOperationalEvent: mocks.recordOperationalEvent,
}));

function coachRequest(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/coach', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'hint',
      problemSlug: 'dependency-cycle',
      hintLevel: 1,
      locale: 'zh',
      ...body,
    }),
  });
}

describe('POST /api/coach provider fallback', () => {
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
    mocks.generateLiveArtifact.mockRejectedValue(
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

  it('returns an explicitly labeled local artifact in development', async () => {
    const response = await POST(coachRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-coach-mode')).toBe('local');
    expect(body).toMatchObject({
      mode: 'local',
      model: 'deterministic-demo',
      artifact: {
        type: 'hint',
        generationMode: 'local',
        model: 'deterministic-demo',
      },
    });
    expect(JSON.stringify(body)).not.toContain('No available channel');
    expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'coach_provider_fallback',
        level: 'warn',
      })
    );
  });

  it('keeps provider failures visible in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await POST(coachRequest());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(response.headers.get('x-coach-mode')).toBeNull();
    expect(body.error).toMatchObject({
      code: 'provider_failed',
      message: 'The AI provider could not generate a valid coach response.',
    });
    expect(JSON.stringify(body)).not.toContain('No available channel');
  });

  it('does not fallback for imported problem parsing', async () => {
    const response = await POST(
      coachRequest({
        action: 'parse',
        problemSlug: undefined,
        hintLevel: undefined,
        statement: 'Create a function that sums an array.',
      })
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('x-coach-mode')).toBeNull();
  });

  it('preserves the no-key curated problem fallback', async () => {
    mocks.getCoachRuntimeConfig.mockResolvedValue({
      apiKey: '',
      model: 'gpt-5.5',
    });

    const response = await POST(coachRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('local');
    expect(mocks.generateLiveArtifact).not.toHaveBeenCalled();
  });

  it('returns 400 for a disallowed model without falling back', async () => {
    mocks.getCoachRuntimeConfig.mockRejectedValue(
      new mocks.CoachModelError('Model is not allowed', 'model_not_allowed')
    );

    const response = await POST(coachRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('model_not_allowed');
    expect(response.headers.get('x-coach-mode')).toBeNull();
  });
});
