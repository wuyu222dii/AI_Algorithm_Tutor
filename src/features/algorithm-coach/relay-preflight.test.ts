import { describe, expect, it, vi } from 'vitest';

import { runAiRelayPreflight } from './relay-preflight';

function response(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), { status, headers });
}

const config = {
  apiKey: 'relay-secret',
  baseURL: 'https://relay.example/v1',
  primaryModel: 'relay-primary',
  fallbackModel: 'relay-fallback',
  structuredOutputMode: 'json-schema' as const,
};

describe('AI relay preflight', () => {
  it('checks both relay models without exposing credentials', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as {
          stream?: boolean;
          stream_options?: { include_usage?: boolean };
          response_format?: { type?: string };
        };
        if (body.stream) {
          expect(body.stream_options).toEqual({ include_usage: true });
          return new Response(
            'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":null,"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{"content":null},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
          );
        }
        return response({
          choices: [
            {
              message: {
                content: body.response_format ? '{"ok":true}' : 'OK',
              },
            },
          ],
        });
      }
    );

    await expect(runAiRelayPreflight({ ...config, fetcher })).resolves.toEqual({
      status: 'ok',
      origin: 'https://relay.example',
      modelsListed: true,
      models: [
        {
          model: 'relay-primary',
          ordinary: true,
          streaming: true,
          structured: 'json-schema',
        },
        {
          model: 'relay-fallback',
          ordinary: true,
          streaming: true,
          structured: 'json-schema',
        },
      ],
    });
    expect(JSON.stringify(fetcher.mock.calls)).toContain('Bearer relay-secret');
  });

  it.each([
    [401, 'credential_invalid'],
    [403, 'group_access_denied'],
    [408, 'timeout'],
    [429, 'rate_limited'],
    [504, 'timeout'],
    [503, 'channel_unavailable'],
  ] as const)('classifies HTTP %s safely', async (status, kind) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response(
          { error: { message: status === 503 ? '无可用通道' : 'denied' } },
          status,
          { 'x-request-id': 'relay-request-id' }
        )
      );
    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({
      kind,
      httpStatus: status,
      requestId: 'relay-request-id',
    });
  });

  it('classifies a relay error payload returned with HTTP 200', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        error: { message: '无权访问模型分组' },
      })
    );

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'group_access_denied', httpStatus: 200 });
  });

  it('falls back to JSON object mode when JSON Schema is unsupported', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as {
          stream?: boolean;
          response_format?: { type?: string };
        };
        if (body.stream) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
          );
        }
        if (body.response_format?.type === 'json_schema') {
          return response({ error: { message: 'unsupported' } }, 400);
        }
        return response({
          choices: [
            {
              message: {
                content: body.response_format ? '{"ok":true}' : 'OK',
              },
            },
          ],
        });
      }
    );
    const result = await runAiRelayPreflight({
      ...config,
      structuredOutputMode: 'json',
      fetcher,
    });
    expect(result.models.every((model) => model.structured === 'json')).toBe(
      true
    );
  });

  it('fails when JSON Schema is configured but the relay only supports JSON mode', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as {
          stream?: boolean;
          response_format?: { type?: string };
        };
        if (body.stream) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
          );
        }
        if (body.response_format?.type === 'json_schema') {
          return response({ error: { message: 'unsupported' } }, 400);
        }
        return response({
          choices: [
            {
              message: {
                content: body.response_format ? '{"ok":true}' : 'OK',
              },
            },
          ],
        });
      }
    );

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('rejects a relay error delivered inside a successful SSE response', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (body.stream) {
          return new Response(
            'data: {"error":{"message":"无可用渠道"}}\n\ndata: [DONE]\n\n'
          );
        }
        return response({
          choices: [{ message: { content: 'OK' } }],
        });
      }
    );

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'channel_unavailable' });
  });

  it('rejects an SSE response without any generated content', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (body.stream) {
          return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n');
        }
        return response({
          choices: [{ message: { content: 'OK' } }],
        });
      }
    );

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('rejects an SSE response without a recognizable termination', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (body.stream) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
          );
        }
        return response({ choices: [{ message: { content: 'OK' } }] });
      }
    );

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('rejects an error finish reason even when the SSE includes content', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (body.stream) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"error"}]}\n\ndata: [DONE]\n\n'
          );
        }
        return response({ choices: [{ message: { content: 'OK' } }] });
      }
    );

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('rejects a malformed data event even when a later event finishes', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (body.stream) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: not-json\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
          );
        }
        return response({ choices: [{ message: { content: 'OK' } }] });
      }
    );

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('classifies a timeout while reading a successful response body', async () => {
    const timeoutBody = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new DOMException('timed out', 'TimeoutError'));
          },
        })
      );
    const fetcher = vi.fn().mockResolvedValue(timeoutBody());

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'timeout', httpStatus: 200 });
  });

  it('classifies a timeout while consuming an SSE body after headers', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        const body = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (body.stream) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(
                  new DOMException('stream timed out', 'TimeoutError')
                );
              },
            })
          );
        }
        return response({ choices: [{ message: { content: 'OK' } }] });
      }
    );

    await expect(
      runAiRelayPreflight({ ...config, fetcher })
    ).rejects.toMatchObject({ kind: 'timeout', httpStatus: 200 });
  });

  it('requires HTTPS for non-local relay origins', async () => {
    await expect(
      runAiRelayPreflight({ ...config, baseURL: 'http://relay.example/v1' })
    ).rejects.toMatchObject({ kind: 'credential_invalid' });
  });
});
