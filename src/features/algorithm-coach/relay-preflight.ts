import { z } from 'zod';

export type AiRelayFailureKind =
  | 'invalid_configuration'
  | 'credential_invalid'
  | 'group_access_denied'
  | 'rate_limited'
  | 'channel_unavailable'
  | 'timeout'
  | 'invalid_output';

export interface AiRelayProbeConfig {
  apiKey: string;
  baseURL: string;
  primaryModel: string;
  fallbackModel: string;
  structuredOutputMode?: 'json' | 'json-schema';
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export interface AiRelayModelCapabilities {
  model: string;
  ordinary: boolean;
  streaming: boolean;
  structured: 'json-schema' | 'json';
}

export interface AiRelayPreflightResult {
  status: 'ok';
  origin: string;
  modelsListed: boolean;
  models: AiRelayModelCapabilities[];
}

export class AiRelayProbeError extends Error {
  constructor(
    public readonly kind: AiRelayFailureKind,
    public readonly httpStatus?: number,
    public readonly requestId?: string
  ) {
    super(`AI relay preflight failed: ${kind}`);
    this.name = 'AiRelayProbeError';
  }
}

const structuredProbeSchema = z.object({ ok: z.boolean() }).strict();

function endpoint(baseURL: string, path: string) {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function requestId(response: Response) {
  return (
    response.headers.get('x-request-id') ??
    response.headers.get('request-id') ??
    undefined
  );
}

function classifyFailure(
  status: number | undefined,
  message: string,
  timedOut = false
): AiRelayFailureKind {
  if (timedOut || /abort|timeout|timed out|deadline/i.test(message)) {
    return 'timeout';
  }
  if (status === 408 || status === 504) return 'timeout';
  if (
    status === 401 ||
    /invalid (?:api )?(?:key|token)|unauthori[sz]ed/i.test(message)
  ) {
    return 'credential_invalid';
  }
  if (
    status === 403 ||
    /forbidden|access denied|group.*(?:denied|forbidden)|无权访问|权限不足|没有权限/i.test(
      message
    )
  ) {
    return 'group_access_denied';
  }
  if (
    status === 429 ||
    /rate[ _-]?limit|too many requests|请求(?:过于)?频繁/i.test(message)
  ) {
    return 'rate_limited';
  }
  if (
    (status !== undefined && status >= 500) ||
    /no available channel|无可用(?:通道|渠道)|temporarily unavailable|service unavailable|overloaded/i.test(
      message
    )
  ) {
    return 'channel_unavailable';
  }
  return 'invalid_output';
}

function bodyReadFailure(
  error: unknown,
  response: Response
): AiRelayProbeError {
  const isTimeout = (value: unknown, depth = 0): boolean => {
    if (depth > 4 || !value || typeof value !== 'object') return false;
    const candidate = value as {
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    return (
      candidate.name === 'AbortError' ||
      candidate.name === 'TimeoutError' ||
      (typeof candidate.message === 'string' &&
        /abort|timeout|timed out|deadline/i.test(candidate.message)) ||
      isTimeout(candidate.cause, depth + 1)
    );
  };
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = isTimeout(error);
  return new AiRelayProbeError(
    timedOut
      ? classifyFailure(undefined, message, true)
      : 'channel_unavailable',
    response.status,
    requestId(response)
  );
}

async function responseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw bodyReadFailure(error, response);
  }
}

async function responseError(response: Response): Promise<AiRelayProbeError> {
  const body = (await responseText(response)).slice(0, 8_000);
  return new AiRelayProbeError(
    classifyFailure(response.status, body),
    response.status,
    requestId(response)
  );
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await responseText(response));
  } catch (error) {
    if (error instanceof AiRelayProbeError) throw error;
    throw new AiRelayProbeError(
      'invalid_output',
      response.status,
      requestId(response)
    );
  }
}

async function relayFetch(
  config: AiRelayProbeConfig,
  path: string,
  init: RequestInit
) {
  const relayUrl = new URL(config.baseURL);
  const localRelay = ['localhost', '127.0.0.1', '::1'].includes(
    relayUrl.hostname
  );
  if (relayUrl.protocol !== 'https:' && !localRelay) {
    throw new AiRelayProbeError('credential_invalid');
  }
  try {
    return await (config.fetcher ?? globalThis.fetch)(
      endpoint(config.baseURL, path),
      {
        ...init,
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          ...init.headers,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut =
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw new AiRelayProbeError(
      timedOut
        ? classifyFailure(undefined, message, true)
        : 'channel_unavailable'
    );
  }
}

function completionContent(payload: unknown): string | undefined {
  const parsed = z
    .object({
      choices: z.array(
        z.object({ message: z.object({ content: z.string() }).passthrough() })
      ),
    })
    .passthrough()
    .safeParse(payload);
  return parsed.success ? parsed.data.choices[0]?.message.content : undefined;
}

function completionUsage(payload: unknown, prompt: string, maxTokens: number) {
  const parsed = z
    .object({
      usage: z
        .object({
          prompt_tokens: z.number().int().nonnegative().optional(),
          completion_tokens: z.number().int().nonnegative().optional(),
          total_tokens: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .passthrough()
    .safeParse(payload);
  const inputTokens = parsed.success
    ? parsed.data.usage?.prompt_tokens
    : undefined;
  const outputTokens = parsed.success
    ? parsed.data.usage?.completion_tokens
    : undefined;
  const totalTokens = parsed.success
    ? parsed.data.usage?.total_tokens
    : undefined;
  const usageReported = Boolean(
    inputTokens &&
      inputTokens > 0 &&
      outputTokens &&
      outputTokens > 0 &&
      (totalTokens === undefined || totalTokens >= inputTokens + outputTokens)
  );
  if (usageReported) {
    return {
      usageReported,
      usage: {
        inputTokens: inputTokens!,
        outputTokens: outputTokens!,
        totalTokens: totalTokens ?? inputTokens! + outputTokens!,
      },
    };
  }
  const estimatedInputTokens = Math.max(
    1,
    Math.ceil(new TextEncoder().encode(prompt).byteLength / 3)
  );
  return {
    usageReported,
    usage: {
      inputTokens: estimatedInputTokens,
      outputTokens: maxTokens,
      totalTokens: estimatedInputTokens + maxTokens,
    },
  };
}

function throwIfRelayErrorPayload(payload: unknown, response: Response) {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return;
  const message = JSON.stringify((payload as { error?: unknown }).error).slice(
    0,
    8_000
  );
  throw new AiRelayProbeError(
    classifyFailure(undefined, message),
    response.status,
    requestId(response)
  );
}

async function chatCompletion(
  config: AiRelayProbeConfig,
  model: string,
  responseFormat?: Record<string, unknown>,
  prompt = 'Reply with the single word OK.'
) {
  const maxTokens = 32;
  const response = await relayFetch(config, 'chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });
  if (!response.ok) throw await responseError(response);
  const payload = await responseJson(response);
  throwIfRelayErrorPayload(payload, response);
  const content = completionContent(payload);
  if (!content?.trim()) {
    throw new AiRelayProbeError(
      'invalid_output',
      response.status,
      requestId(response)
    );
  }
  return {
    content,
    requestId: requestId(response),
    ...completionUsage(payload, prompt, maxTokens),
  };
}

export async function probeAiRelayChat(
  config: AiRelayProbeConfig,
  model = config.primaryModel
) {
  return chatCompletion(config, model);
}

async function streamingCompletion(config: AiRelayProbeConfig, model: string) {
  const response = await relayFetch(config, 'chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_tokens: 32,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!response.ok) throw await responseError(response);
  const body = (await responseText(response)).slice(0, 64_000);
  let content = '';
  let validFinish = false;
  for (const line of body.split(/\r?\n/)) {
    const value = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!value) continue;
    if (value === '[DONE]') continue;
    let payload: unknown;
    try {
      payload = JSON.parse(value);
    } catch {
      throw new AiRelayProbeError(
        'invalid_output',
        response.status,
        requestId(response)
      );
    }
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const message = JSON.stringify(
        (payload as { error?: unknown }).error
      ).slice(0, 8_000);
      throw new AiRelayProbeError(
        classifyFailure(undefined, message),
        response.status,
        requestId(response)
      );
    }
    const parsed = z
      .object({
        choices: z.array(
          z
            .object({
              delta: z
                .object({ content: z.string().nullish() })
                .passthrough()
                .nullable(),
              finish_reason: z.string().nullable().optional(),
            })
            .passthrough()
        ),
      })
      .passthrough()
      .safeParse(payload);
    if (!parsed.success) {
      throw new AiRelayProbeError(
        'invalid_output',
        response.status,
        requestId(response)
      );
    }
    const finishReasons = parsed.data.choices
      .map((choice) => choice.finish_reason)
      .filter((finish): finish is string => Boolean(finish));
    if (
      finishReasons.some(
        (finish) => !['stop', 'length', 'content_filter'].includes(finish)
      )
    ) {
      throw new AiRelayProbeError(
        'invalid_output',
        response.status,
        requestId(response)
      );
    }
    if (finishReasons.length) validFinish = true;
    content += parsed.data.choices
      .map((choice) => choice.delta?.content ?? '')
      .join('');
  }
  if (!content.trim() || !validFinish) {
    throw new AiRelayProbeError(
      'invalid_output',
      response.status,
      requestId(response)
    );
  }
}

async function structuredCompletion(
  config: AiRelayProbeConfig,
  model: string
): Promise<'json-schema' | 'json'> {
  const prompt = 'Return only JSON with the exact shape {"ok":true}.';
  const schemaFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'algocoach_relay_probe',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
    },
  };
  try {
    const result = await chatCompletion(config, model, schemaFormat, prompt);
    structuredProbeSchema.parse(JSON.parse(result.content));
    return 'json-schema';
  } catch (error) {
    if (
      error instanceof AiRelayProbeError &&
      !['invalid_output'].includes(error.kind) &&
      error.httpStatus !== 400 &&
      error.httpStatus !== 422
    ) {
      throw error;
    }
  }

  const fallback = await chatCompletion(
    config,
    model,
    { type: 'json_object' },
    prompt
  );
  try {
    structuredProbeSchema.parse(JSON.parse(fallback.content));
  } catch {
    throw new AiRelayProbeError('invalid_output');
  }
  return 'json';
}

export async function runAiRelayPreflight(
  config: AiRelayProbeConfig
): Promise<AiRelayPreflightResult> {
  if (!config.apiKey || !config.baseURL || !config.primaryModel) {
    throw new AiRelayProbeError('invalid_configuration');
  }
  if (!config.fallbackModel || config.fallbackModel === config.primaryModel) {
    throw new AiRelayProbeError('invalid_configuration');
  }
  const relayUrl = new URL(config.baseURL);
  const localRelay = ['localhost', '127.0.0.1', '::1'].includes(
    relayUrl.hostname
  );
  if (relayUrl.protocol !== 'https:' && !localRelay) {
    throw new AiRelayProbeError('credential_invalid');
  }
  const origin = relayUrl.origin;
  const modelsResponse = await relayFetch(config, 'models', { method: 'GET' });
  if (!modelsResponse.ok) throw await responseError(modelsResponse);
  const rawModelsPayload = await responseJson(modelsResponse);
  throwIfRelayErrorPayload(rawModelsPayload, modelsResponse);
  const modelsPayload = z
    .object({ data: z.array(z.object({ id: z.string() }).passthrough()) })
    .passthrough()
    .safeParse(rawModelsPayload);
  const listed = new Set(
    modelsPayload.success ? modelsPayload.data.data.map((item) => item.id) : []
  );
  if (
    !modelsPayload.success ||
    !listed.has(config.primaryModel) ||
    !listed.has(config.fallbackModel)
  ) {
    throw new AiRelayProbeError('group_access_denied');
  }

  const models: AiRelayModelCapabilities[] = [];
  for (const model of [config.primaryModel, config.fallbackModel]) {
    await probeAiRelayChat(config, model);
    await streamingCompletion(config, model);
    const structured = await structuredCompletion(config, model);
    if (
      config.structuredOutputMode === 'json-schema' &&
      structured !== 'json-schema'
    ) {
      throw new AiRelayProbeError('invalid_output');
    }
    models.push({ model, ordinary: true, streaming: true, structured });
  }
  return { status: 'ok', origin, modelsListed: true, models };
}
