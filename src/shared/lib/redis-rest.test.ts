import { describe, expect, it } from 'vitest';

import {
  redisRestConfigurationState,
  resolveRedisRestConfiguration,
} from './redis-rest';

describe('Redis REST environment resolution', () => {
  it('prefers the explicit AlgoCoach variables', () => {
    expect(
      resolveRedisRestConfiguration({
        REDIS_URL: 'https://explicit.example.test/',
        REDIS_TOKEN: 'explicit-token',
        UPSTASH_REDIS_REST_URL: 'https://upstash.example.test',
        UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
      })
    ).toEqual({
      url: 'https://explicit.example.test',
      token: 'explicit-token',
      source: 'redis',
    });
  });

  it('accepts Upstash and Vercel KV managed aliases', () => {
    expect(
      resolveRedisRestConfiguration({
        UPSTASH_REDIS_REST_URL: 'https://upstash.example.test',
        UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
      })
    ).toMatchObject({ source: 'upstash' });
    expect(
      resolveRedisRestConfiguration({
        KV_REST_API_URL: 'https://kv.example.test',
        KV_REST_API_TOKEN: 'kv-token',
      })
    ).toMatchObject({ source: 'vercel-kv' });
  });

  it('does not combine credentials from different providers', () => {
    const state = redisRestConfigurationState({
      UPSTASH_REDIS_REST_URL: 'https://upstash.example.test',
      KV_REST_API_TOKEN: 'kv-token',
    });
    expect(state).toMatchObject({
      configuration: null,
      urlConfigured: true,
      tokenConfigured: true,
    });
  });
});
