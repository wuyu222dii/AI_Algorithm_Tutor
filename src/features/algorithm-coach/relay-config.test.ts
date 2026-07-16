import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resetAiRelayLegacyWarningsForTests,
  resolveAiRelayEnvironment,
  warnAiRelayLegacyConfiguration,
} from './relay-config';

describe('AI relay configuration', () => {
  afterEach(() => {
    resetAiRelayLegacyWarningsForTests();
    vi.restoreAllMocks();
  });

  it('prefers provider-neutral relay variables over legacy settings', () => {
    const resolved = resolveAiRelayEnvironment(
      {
        AI_RELAY_API_KEY: 'relay-key',
        AI_RELAY_BASE_URL: 'https://relay.example/v1/',
        AI_RELAY_PRIMARY_MODEL: 'relay/primary',
        AI_RELAY_FALLBACK_MODEL: 'relay/fallback',
        AI_RELAY_STRUCTURED_OUTPUT_MODE: 'json-schema',
        OPENROUTER_API_KEY: 'legacy-env-key',
      },
      {
        openrouter_api_key: 'legacy-db-key',
        openrouter_base_url: 'https://legacy.example/v1',
      }
    );

    expect(resolved).toEqual({
      apiKey: 'relay-key',
      baseURL: 'https://relay.example/v1',
      primaryModel: 'relay/primary',
      fallbackModel: 'relay/fallback',
      structuredOutputMode: 'json-schema',
      legacyVariables: [],
    });
  });

  it('uses legacy settings for one release and reports names without values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const resolved = resolveAiRelayEnvironment({
      OPENROUTER_API_KEY: 'legacy-secret',
      OPENROUTER_BASE_URL: 'https://legacy.example/v1/',
    });

    warnAiRelayLegacyConfiguration(resolved.legacyVariables);
    warnAiRelayLegacyConfiguration(resolved.legacyVariables);

    expect(resolved.apiKey).toBe('legacy-secret');
    expect(resolved.baseURL).toBe('https://legacy.example/v1');
    expect(resolved.legacyVariables).toEqual([
      'OPENROUTER_API_KEY',
      'OPENROUTER_BASE_URL',
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).not.toContain('legacy-secret');
  });

  it('never mixes a new relay credential with a legacy Base URL', () => {
    const resolved = resolveAiRelayEnvironment(
      {
        AI_RELAY_API_KEY: 'new-relay-secret',
        OPENROUTER_BASE_URL: 'https://legacy.example/v1',
      },
      { openrouter_base_url: 'https://database-legacy.example/v1' }
    );

    expect(resolved.apiKey).toBe('new-relay-secret');
    expect(resolved.baseURL).toBeUndefined();
    expect(resolved.legacyVariables).toEqual([]);
  });

  it('never mixes a new relay Base URL with a legacy credential', () => {
    const resolved = resolveAiRelayEnvironment({
      AI_RELAY_BASE_URL: 'https://new-relay.example/v1',
      OPENROUTER_API_KEY: 'legacy-secret',
    });

    expect(resolved.apiKey).toBe('');
    expect(resolved.baseURL).toBe('https://new-relay.example/v1');
    expect(resolved.legacyVariables).toEqual([]);
  });

  it('never mixes database and environment legacy credentials', () => {
    const resolved = resolveAiRelayEnvironment(
      { OPENROUTER_BASE_URL: 'https://legacy-env.example/v1' },
      { openrouter_api_key: 'legacy-database-secret' }
    );

    expect(resolved.apiKey).toBe('legacy-database-secret');
    expect(resolved.baseURL).toBeUndefined();
    expect(resolved.legacyVariables).toEqual(['openrouter_api_key']);
  });

  it('defaults to prompt JSON mode for relay compatibility', () => {
    expect(resolveAiRelayEnvironment({}).structuredOutputMode).toBe('json');
    expect(
      resolveAiRelayEnvironment({
        AI_RELAY_STRUCTURED_OUTPUT_MODE: 'unsupported',
      }).structuredOutputMode
    ).toBe('json');
  });
});
