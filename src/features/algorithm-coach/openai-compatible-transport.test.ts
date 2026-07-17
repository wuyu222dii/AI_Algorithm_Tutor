import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { describe, expect, it, vi } from 'vitest';

describe('OpenAI-compatible JSON transport', () => {
  it('passes the named-provider JSON object response format without a network request', async () => {
    let requestBody: unknown;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: 'completion-1',
            object: 'chat.completion',
            created: 1,
            model: 'gpt-5.5',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '{"ok":true}' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    );
    const relay = createOpenAICompatible({
      name: 'algocoach-relay',
      apiKey: 'test-key',
      baseURL: 'https://relay.example/v1',
      fetch: fetcher,
    });

    await generateText({
      model: relay.chatModel('gpt-5.5'),
      prompt: 'Return JSON.',
      maxRetries: 0,
      providerOptions: {
        'algocoach-relay': {
          response_format: { type: 'json_object' },
        },
      },
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      model: 'gpt-5.5',
      response_format: { type: 'json_object' },
    });
  });
});
