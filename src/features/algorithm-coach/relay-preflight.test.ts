import { describe, expect, it, vi } from 'vitest';

import {
  aiRelayPreflightFailureReport,
  resolvePreflightStructuredOutputMode,
  runAiRelayPreflight,
} from './relay-preflight';

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

const structuredProbeContent = JSON.stringify({
  title: 'Relay check',
  summary: 'Structured output is available.',
  details: ['Nested artifact accepted.'],
  nextAction: null,
  hint: {
    level: 1,
    principle: 'Keep the contract.',
    direction: null,
    pseudocode: null,
  },
});

describe('AI relay preflight', () => {
  it('enables JSON Schema only when both distinct models passed that probe', () => {
    const result = {
      status: 'ok' as const,
      origin: 'https://relay.example',
      modelsListed: true,
      models: [
        {
          model: 'relay-primary',
          ordinary: true,
          streaming: true,
          structured: 'json-schema' as const,
        },
        {
          model: 'relay-fallback',
          ordinary: true,
          streaming: true,
          structured: 'json-schema' as const,
        },
      ],
    };

    expect(resolvePreflightStructuredOutputMode(result)).toBe('json-schema');
    expect(
      resolvePreflightStructuredOutputMode({
        ...result,
        models: [result.models[0], { ...result.models[1], structured: 'json' }],
      })
    ).toBe('json');
    expect(
      resolvePreflightStructuredOutputMode({
        ...result,
        models: [result.models[0], { ...result.models[0] }],
      })
    ).toBe('json');
  });

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
          response_format?: {
            type?: string;
            json_schema?: { schema?: Record<string, unknown> };
          };
          messages?: Array<{ content?: string }>;
          max_tokens?: number;
        };
        if (body.stream) {
          expect(body.stream_options).toEqual({ include_usage: true });
          return new Response(
            'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":null,"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{"content":null},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
          );
        }
        if (body.response_format) {
          expect(body.max_tokens).toBe(320);
          expect(body.messages?.[0]?.content).toContain('"hint"');
          expect(body.response_format.json_schema?.schema).toMatchObject({
            type: 'object',
            required: ['title', 'summary', 'details', 'nextAction', 'hint'],
            properties: {
              hint: {
                type: 'object',
                required: ['level', 'principle', 'direction', 'pseudocode'],
              },
            },
          });
        }
        return response({
          choices: [
            {
              message: {
                content: body.response_format ? structuredProbeContent : 'OK',
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

  it('rejects a trivial JSON response that does not satisfy an AlgoCoach artifact contract', async () => {
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
    ).rejects.toMatchObject({
      kind: 'invalid_output',
      stage: 'structured_output',
      model: 'relay-primary',
    });
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
      stage: 'models_list',
      model: 'relay-primary',
    });
  });

  it('reports the model-specific stage without exposing the key or response body', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        return response(
          { error: { message: 'denied sk-private-response-body' } },
          403,
          { 'x-request-id': 'completion-request-id' }
        );
      }
    );
    const error = await runAiRelayPreflight({ ...config, fetcher }).catch(
      (caught) => caught
    );

    const report = aiRelayPreflightFailureReport(error);
    expect(report).toEqual({
      status: 'error',
      kind: 'group_access_denied',
      httpStatus: 403,
      stage: 'ordinary_completion',
      model: 'relay-primary',
      requestId: 'completion-request-id',
    });
    expect(JSON.stringify(report)).not.toContain('relay-secret');
    expect(JSON.stringify(report)).not.toContain('private-response-body');
  });

  it('classifies CodeApiX insufficient quota before its generic HTTP 403', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return response({
            data: [{ id: 'relay-primary' }, { id: 'relay-fallback' }],
          });
        }
        return response(
          {
            error: {
              message: 'Insufficient user quota',
              type: 'new_api_error',
              code: 'insufficient_user_quota',
            },
          },
          403,
          { 'x-request-id': 'codeapix-request-id' }
        );
      }
    );
    const error = await runAiRelayPreflight({ ...config, fetcher }).catch(
      (caught) => caught
    );

    expect(aiRelayPreflightFailureReport(error)).toEqual({
      status: 'error',
      kind: 'quota_exhausted',
      httpStatus: 403,
      stage: 'ordinary_completion',
      model: 'relay-primary',
      requestId: 'codeapix-request-id',
    });
  });

  it('reports a missing model with only a limited, related model list', async () => {
    const relatedModels = Array.from({ length: 12 }, (_, index) => ({
      id: `relay-primary-variant-${index}`,
    }));
    const fetcher = vi.fn().mockResolvedValue(
      response(
        {
          data: [
            { id: 'relay-fallback' },
            ...relatedModels,
            { id: 'private-catalog-entry' },
          ],
        },
        200,
        { 'x-request-id': 'models-request-id' }
      )
    );
    const error = await runAiRelayPreflight({ ...config, fetcher }).catch(
      (caught) => caught
    );

    const report = aiRelayPreflightFailureReport(error);
    expect(report).toMatchObject({
      status: 'error',
      kind: 'group_access_denied',
      httpStatus: 200,
      stage: 'models_list',
      model: 'relay-primary',
      requestId: 'models-request-id',
    });
    expect(report.availableModels).toHaveLength(8);
    expect(report.availableModels?.[0]).toBe('relay-fallback');
    expect(report.availableModels).not.toContain('private-catalog-entry');
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
                content: body.response_format ? structuredProbeContent : 'OK',
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
                content: body.response_format ? structuredProbeContent : 'OK',
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
