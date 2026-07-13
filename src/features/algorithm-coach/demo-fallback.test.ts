import { afterEach, describe, expect, it, vi } from 'vitest';

import { canUseCoachDemoFallback } from './demo-fallback';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('coach deterministic demo fallback', () => {
  it('allows an explicitly enabled curated problem outside production', () => {
    vi.stubEnv('COACH_DEMO_FALLBACK_ENABLED', 'true');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', '');

    expect(
      canUseCoachDemoFallback({
        action: 'hint',
        problemSlug: 'dependency-cycle',
        hintLevel: 1,
      })
    ).toBe(true);
  });

  it('rejects imported problems, disabled fallback, and production', () => {
    vi.stubEnv('COACH_DEMO_FALLBACK_ENABLED', 'true');
    vi.stubEnv('NODE_ENV', 'development');
    expect(
      canUseCoachDemoFallback({
        action: 'hint',
        problemSlug: 'imported-draft',
        hintLevel: 1,
      })
    ).toBe(false);

    vi.stubEnv('COACH_DEMO_FALLBACK_ENABLED', 'false');
    expect(
      canUseCoachDemoFallback({
        action: 'hint',
        problemSlug: 'dependency-cycle',
        hintLevel: 1,
      })
    ).toBe(false);

    vi.stubEnv('COACH_DEMO_FALLBACK_ENABLED', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    expect(
      canUseCoachDemoFallback({
        action: 'hint',
        problemSlug: 'dependency-cycle',
        hintLevel: 1,
      })
    ).toBe(false);
  });
});
