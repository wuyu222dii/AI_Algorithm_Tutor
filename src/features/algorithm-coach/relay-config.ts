export interface AiRelayLegacySettings {
  openrouter_api_key?: string | null;
  openrouter_base_url?: string | null;
}

export interface AiRelayEnvironmentConfig {
  apiKey: string;
  baseURL?: string;
  primaryModel?: string;
  fallbackModel?: string;
  structuredOutputMode: 'json' | 'json-schema';
  legacyVariables: string[];
}

export type AiRelayEnvironment = Readonly<Record<string, string | undefined>>;

function configured(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * Resolves the server-side relay configuration without assuming an upstream
 * vendor. Callers must never log the returned apiKey.
 */
export function resolveAiRelayEnvironment(
  env: AiRelayEnvironment = process.env,
  legacySettings: AiRelayLegacySettings = {}
): AiRelayEnvironmentConfig {
  const legacyVariables = new Set<string>();
  const relayApiKey = configured(env.AI_RELAY_API_KEY);
  const relayBaseURL = configured(env.AI_RELAY_BASE_URL);
  const databaseApiKey = configured(legacySettings.openrouter_api_key);
  const databaseBaseURL = configured(legacySettings.openrouter_base_url);
  const legacyApiKey = configured(env.OPENROUTER_API_KEY);
  const legacyBaseURL = configured(env.OPENROUTER_BASE_URL);

  let apiKey: string | undefined;
  let baseURL: string | undefined;
  if (relayApiKey || relayBaseURL) {
    // Never combine a new credential with a legacy host (or vice versa).
    apiKey = relayApiKey;
    baseURL = relayBaseURL;
  } else if (databaseApiKey || databaseBaseURL) {
    apiKey = databaseApiKey;
    baseURL = databaseBaseURL;
    if (databaseApiKey) legacyVariables.add('openrouter_api_key');
    if (databaseBaseURL) legacyVariables.add('openrouter_base_url');
  } else {
    apiKey = legacyApiKey;
    baseURL = legacyBaseURL;
    if (legacyApiKey) legacyVariables.add('OPENROUTER_API_KEY');
    if (legacyBaseURL) legacyVariables.add('OPENROUTER_BASE_URL');
  }
  const structuredOutputMode =
    configured(env.AI_RELAY_STRUCTURED_OUTPUT_MODE) === 'json-schema'
      ? 'json-schema'
      : 'json';

  return {
    apiKey: apiKey ?? '',
    baseURL: baseURL?.replace(/\/+$/, ''),
    primaryModel: configured(env.AI_RELAY_PRIMARY_MODEL),
    fallbackModel: configured(env.AI_RELAY_FALLBACK_MODEL),
    structuredOutputMode,
    legacyVariables: Array.from(legacyVariables),
  };
}

const warnedLegacyVariables = new Set<string>();

export function warnAiRelayLegacyConfiguration(variableNames: string[]) {
  const unseen = variableNames.filter(
    (name) => !warnedLegacyVariables.has(name)
  );
  if (!unseen.length) return;
  unseen.forEach((name) => warnedLegacyVariables.add(name));
  console.warn(
    `[ai-relay] ${unseen.join(', ')} is deprecated; migrate to AI_RELAY_* configuration.`
  );
}

export function resetAiRelayLegacyWarningsForTests() {
  warnedLegacyVariables.clear();
}
