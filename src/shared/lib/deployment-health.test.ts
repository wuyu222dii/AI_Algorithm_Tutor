import { describe, expect, it, vi } from 'vitest';

import {
  checkDeploymentHealth,
  DeploymentHealthConfigurationError,
} from './deployment-health';

const TOKEN = 'deployment-canary-token-with-32-characters';

function successResponse(kind?: 'live' | 'ready') {
  return Response.json({ status: 'ok', ...(kind ? { kind } : {}) });
}

describe('deployment health checker', () => {
  it('checks liveness, readiness, and the authenticated canary in order', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(successResponse('live'))
      .mockResolvedValueOnce(successResponse('ready'))
      .mockResolvedValueOnce(successResponse());

    const result = await checkDeploymentHealth({
      baseUrl: 'https://beta.algocoach.example/',
      canaryToken: TOKEN,
      fetcher,
      now: () => new Date('2026-07-17T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      status: 'ok',
      origin: 'https://beta.algocoach.example',
      checkedAt: '2026-07-17T00:00:00.000Z',
      checks: [
        { name: 'live', status: 'ok', httpStatus: 200 },
        { name: 'ready', status: 'ok', httpStatus: 200 },
        { name: 'ai-relay', status: 'ok', httpStatus: 200 },
      ],
    });
    expect(
      fetcher.mock.calls.map(([input]) => new URL(input).pathname)
    ).toEqual([
      '/api/health/live',
      '/api/health/ready',
      '/api/health/ai-relay',
    ]);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toBeUndefined();
    expect(fetcher.mock.calls[1]?.[1]?.headers).toBeUndefined();
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      redirect: 'error',
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('stops before the canary when readiness fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(successResponse('live'))
      .mockResolvedValueOnce(
        Response.json(
          { status: 'error', code: 'migration_version_mismatch' },
          { status: 503 }
        )
      );

    await expect(
      checkDeploymentHealth({
        baseUrl: 'https://beta.algocoach.example',
        canaryToken: TOKEN,
        fetcher,
      })
    ).resolves.toMatchObject({
      status: 'error',
      failedCheck: 'ready',
      checks: [
        { name: 'live', status: 'ok' },
        {
          name: 'ready',
          status: 'error',
          httpStatus: 503,
          code: 'http_error',
          remoteCode: 'migration_version_mismatch',
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sends a Vercel protection bypass only to the fixed deployment origin', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(successResponse('live'))
      .mockResolvedValueOnce(successResponse('ready'))
      .mockResolvedValueOnce(successResponse());

    await checkDeploymentHealth({
      baseUrl: 'https://preview.algocoach.example',
      canaryToken: TOKEN,
      vercelProtectionBypass: 'vercel-bypass-secret',
      fetcher,
    });

    for (const [input, init] of fetcher.mock.calls) {
      expect(new URL(input).origin).toBe('https://preview.algocoach.example');
      expect(init?.headers).toMatchObject({
        'x-vercel-protection-bypass': 'vercel-bypass-secret',
      });
    }
    expect(fetcher.mock.calls[2]?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
    });
  });

  it('classifies timeouts without exposing provider details', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(successResponse('live'))
      .mockResolvedValueOnce(successResponse('ready'))
      .mockRejectedValueOnce(
        new DOMException('provider detail with secret body', 'TimeoutError')
      );

    const result = await checkDeploymentHealth({
      baseUrl: 'https://beta.algocoach.example',
      canaryToken: TOKEN,
      fetcher,
    });

    expect(result).toMatchObject({
      status: 'error',
      failedCheck: 'ai-relay',
      checks: [
        { name: 'live', status: 'ok' },
        { name: 'ready', status: 'ok' },
        { name: 'ai-relay', status: 'error', code: 'timeout' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('provider detail');
  });

  it.each([
    ['http://algocoach.example', 'base_url_must_use_https'],
    ['https://user:password@algocoach.example', 'base_url_must_be_origin'],
    ['https://algocoach.example/app', 'base_url_must_be_origin'],
  ])('rejects unsafe deployment URL %s', async (baseUrl, code) => {
    await expect(
      checkDeploymentHealth({ baseUrl, canaryToken: TOKEN })
    ).rejects.toEqual(expect.objectContaining({ code }));
  });

  it('allows an HTTP loopback origin for local smoke tests', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(successResponse('live'))
      .mockResolvedValueOnce(successResponse('ready'))
      .mockResolvedValueOnce(successResponse());

    await expect(
      checkDeploymentHealth({
        baseUrl: 'http://127.0.0.1:3200',
        canaryToken: TOKEN,
        fetcher,
      })
    ).resolves.toMatchObject({ status: 'ok', origin: 'http://127.0.0.1:3200' });
  });

  it('rejects short canary tokens before making a request', async () => {
    const fetcher = vi.fn();
    await expect(
      checkDeploymentHealth({
        baseUrl: 'https://beta.algocoach.example',
        canaryToken: 'too-short',
        fetcher,
      })
    ).rejects.toBeInstanceOf(DeploymentHealthConfigurationError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
