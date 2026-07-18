import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  completeSignedAssessment: vi.fn(),
  createSignedAssessmentSession: vi.fn(),
  inspectSignedAssessmentSession: vi.fn(),
  readSignedAssessmentSession: vi.fn(),
  getRuntimeProblem: vi.fn(),
  listRuntimeProblems: vi.fn(),
  enforceDistributedWindowRateLimit: vi.fn(),
  runtimeEnabledLanguages: vi.fn(),
}));

vi.mock('@/features/algorithm-coach/assessment.server', () => ({
  completeSignedAssessment: mocks.completeSignedAssessment,
  createSignedAssessmentSession: mocks.createSignedAssessmentSession,
  inspectSignedAssessmentSession: mocks.inspectSignedAssessmentSession,
  readSignedAssessmentSession: mocks.readSignedAssessmentSession,
}));
vi.mock('@/features/algorithm-coach/catalog-runtime.server', () => ({
  getRuntimeProblem: mocks.getRuntimeProblem,
  listRuntimeProblems: mocks.listRuntimeProblems,
  runtimeEnabledLanguages: mocks.runtimeEnabledLanguages,
}));
vi.mock('@/features/algorithm-coach/problem-contracts', () => ({
  toAssessmentProblemDetail: (problem: unknown) => problem,
}));
vi.mock('@/shared/lib/rate-limit', () => ({
  enforceDistributedWindowRateLimit: mocks.enforceDistributedWindowRateLimit,
}));

function request(body: unknown) {
  return new Request('http://localhost/api/assessment/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const token = 'x'.repeat(64);
const signedSession = {
  id: 'assessment-1',
  kind: 'practice',
  version: '2026-07-v4',
  problemSlugs: ['two-sum', 'valid-brackets'],
  problemVersions: [
    { slug: 'two-sum', contentVersion: 1 },
    { slug: 'valid-brackets', contentVersion: 2 },
  ],
  durationMinutes: 20,
  startedAt: '2099-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:20:00.000Z',
  graceExpiresAt: '2099-01-01T00:25:00.000Z',
};

describe('POST /api/assessment/session recovery actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceDistributedWindowRateLimit.mockResolvedValue(null);
    mocks.readSignedAssessmentSession.mockReturnValue(signedSession);
    mocks.inspectSignedAssessmentSession.mockReturnValue(signedSession);
    mocks.getRuntimeProblem.mockResolvedValue({ id: 'problem' });
    mocks.createSignedAssessmentSession.mockReturnValue({
      ...signedSession,
      token,
    });
    mocks.listRuntimeProblems.mockResolvedValue([
      {
        id: 'problem-one',
        slug: 'two-sum',
        version: { contentVersion: 1 },
      },
      {
        id: 'problem-two',
        slug: 'valid-brackets',
        version: { contentVersion: 2 },
      },
    ]);
    mocks.runtimeEnabledLanguages.mockReturnValue([
      'javascript',
      'typescript',
      'python',
    ]);
  });

  it('starts with complete details for the two signed revisions', async () => {
    const response = await POST(request({ action: 'start', kind: 'practice' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: 'assessment-1',
      token,
      problems: [
        { id: 'problem-one', slug: 'two-sum' },
        { id: 'problem-two', slug: 'valid-brackets' },
      ],
    });
    expect(Number.isFinite(Date.parse(body.data.serverNow))).toBe(true);
  });

  it('resumes only after every pinned revision remains available', async () => {
    const response = await POST(request({ action: 'resume', token }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: 'assessment-1',
      problemVersions: signedSession.problemVersions,
      status: 'active',
      problems: [{ id: 'problem' }, { id: 'problem' }],
    });
    expect(Number.isFinite(Date.parse(body.data.serverNow))).toBe(true);
    expect(mocks.getRuntimeProblem).toHaveBeenCalledTimes(2);
  });

  it('preserves resumability when a historical revision is temporarily unavailable', async () => {
    mocks.getRuntimeProblem
      .mockResolvedValueOnce({ id: 'problem' })
      .mockResolvedValueOnce(null);

    const response = await POST(request({ action: 'resume', token }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'assessment_catalog_unavailable',
    });
  });

  it('distinguishes an expired signed session from a transient service error', async () => {
    mocks.readSignedAssessmentSession.mockImplementationOnce(() => {
      throw new Error('Assessment has expired');
    });
    const expired = await POST(request({ action: 'resume', token }));
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ error: 'assessment_expired' });

    mocks.readSignedAssessmentSession.mockImplementationOnce(() => {
      throw new Error('database offline');
    });
    const unavailable = await POST(request({ action: 'resume', token }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: 'assessment_unavailable',
    });
  });

  it('accepts an idempotent client-side abandon without loading the catalog', async () => {
    const response = await POST(request({ action: 'abandon', token }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: 'assessment-1',
      status: 'abandoned',
    });
    expect(mocks.inspectSignedAssessmentSession).toHaveBeenCalledWith(token);
    expect(mocks.getRuntimeProblem).not.toHaveBeenCalled();
  });

  it('completes against the exact signed revisions', async () => {
    mocks.completeSignedAssessment.mockReturnValue({
      id: signedSession.id,
      score: 100,
      evidenceMode: 'browser_local',
    });
    const runs = [
      { problemSlug: 'two-sum', passed: true, durationMs: 100 },
      { problemSlug: 'valid-brackets', passed: true, durationMs: 120 },
    ];

    const response = await POST(request({ action: 'complete', token, runs }));

    expect(response.status).toBe(200);
    expect(mocks.completeSignedAssessment).toHaveBeenCalledWith({
      token,
      runs,
      problems: [{ id: 'problem' }, { id: 'problem' }],
    });
  });

  it('rejects completion when a pinned revision disappears', async () => {
    mocks.getRuntimeProblem
      .mockResolvedValueOnce({ id: 'problem' })
      .mockResolvedValueOnce(undefined);

    const response = await POST(
      request({
        action: 'complete',
        token,
        runs: [
          { problemSlug: 'two-sum', passed: true, durationMs: 100 },
          { problemSlug: 'valid-brackets', passed: false, durationMs: 120 },
        ],
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'assessment_catalog_unavailable',
    });
  });

  it('returns stable errors for invalid requests and signed-token rejection', async () => {
    const invalid = await POST(request({ action: 'resume', token: 'short' }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'invalid_request' });

    mocks.readSignedAssessmentSession.mockImplementationOnce(() => {
      throw new Error('Assessment token is invalid');
    });
    const rejected = await POST(request({ action: 'resume', token }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: 'assessment_rejected',
    });
  });

  it('returns the distributed limiter response before parsing input', async () => {
    mocks.enforceDistributedWindowRateLimit.mockResolvedValueOnce(
      Response.json({ error: 'rate_limited' }, { status: 429 })
    );

    const response = await POST(request({ invalid: true }));

    expect(response.status).toBe(429);
    expect(mocks.listRuntimeProblems).not.toHaveBeenCalled();
  });

  it('rejects a start session whose selected revision is unavailable', async () => {
    mocks.listRuntimeProblems.mockResolvedValueOnce([
      {
        id: 'problem-one',
        slug: 'two-sum',
        version: { contentVersion: 1 },
      },
    ]);

    const response = await POST(request({ action: 'start' }));

    expect(response.status).toBe(503);
  });
});
