export type RedisRestConfiguration = {
  url: string;
  token: string;
  source: 'redis' | 'upstash' | 'vercel-kv';
};

const REDIS_REST_ENV_PAIRS = [
  {
    source: 'redis',
    url: 'REDIS_URL',
    token: 'REDIS_TOKEN',
  },
  {
    source: 'upstash',
    url: 'UPSTASH_REDIS_REST_URL',
    token: 'UPSTASH_REDIS_REST_TOKEN',
  },
  {
    source: 'vercel-kv',
    url: 'KV_REST_API_URL',
    token: 'KV_REST_API_TOKEN',
  },
] as const;

function configuredValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string
) {
  return env[name]?.trim();
}

/**
 * Resolve the first complete Redis REST credential pair. Explicit AlgoCoach
 * variables take precedence over provider-managed aliases.
 */
export function resolveRedisRestConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env
): RedisRestConfiguration | null {
  for (const pair of REDIS_REST_ENV_PAIRS) {
    const url = configuredValue(env, pair.url)?.replace(/\/$/, '');
    const token = configuredValue(env, pair.token);
    if (url && token) {
      return { url, token, source: pair.source };
    }
  }
  return null;
}

export function redisRestConfigurationState(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  const configuration = resolveRedisRestConfiguration(env);
  return {
    configuration,
    urlConfigured: REDIS_REST_ENV_PAIRS.some((pair) =>
      Boolean(configuredValue(env, pair.url))
    ),
    tokenConfigured: REDIS_REST_ENV_PAIRS.some((pair) =>
      Boolean(configuredValue(env, pair.token))
    ),
  };
}
