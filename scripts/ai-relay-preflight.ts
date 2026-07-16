import { parseAiRelayPricingJson } from '../src/features/algorithm-coach/model';
import {
  resolveAiRelayEnvironment,
  warnAiRelayLegacyConfiguration,
} from '../src/features/algorithm-coach/relay-config';
import {
  aiRelayPreflightFailureReport,
  runAiRelayPreflight,
} from '../src/features/algorithm-coach/relay-preflight';

function configuredModel(primary: boolean) {
  return (
    process.env[
      primary ? 'AI_RELAY_PRIMARY_MODEL' : 'AI_RELAY_FALLBACK_MODEL'
    ] ??
    process.env[primary ? 'ALGO_COACH_MODEL' : 'ALGO_COACH_FALLBACK_MODEL'] ??
    ''
  ).trim();
}

async function main() {
  const configuredStructuredMode =
    process.env.AI_RELAY_STRUCTURED_OUTPUT_MODE?.trim();
  if (
    configuredStructuredMode &&
    !['json', 'json-schema'].includes(configuredStructuredMode)
  ) {
    throw new Error('AI_RELAY_STRUCTURED_OUTPUT_MODE is invalid.');
  }
  const relay = resolveAiRelayEnvironment();
  warnAiRelayLegacyConfiguration(relay.legacyVariables);
  const usesRelayModelPair = Boolean(relay.primaryModel || relay.fallbackModel);
  const primaryModel = usesRelayModelPair
    ? (relay.primaryModel ?? '')
    : configuredModel(true);
  const fallbackModel = usesRelayModelPair
    ? (relay.fallbackModel ?? '')
    : configuredModel(false);
  const pricing = parseAiRelayPricingJson(process.env.AI_RELAY_PRICING_JSON);
  if (!pricing?.[primaryModel] || !pricing[fallbackModel]) {
    throw new Error(
      'AI_RELAY_PRICING_JSON must price both configured relay models.'
    );
  }
  const result = await runAiRelayPreflight({
    apiKey: relay.apiKey,
    baseURL: relay.baseURL ?? '',
    primaryModel,
    fallbackModel,
    structuredOutputMode: relay.structuredOutputMode,
    timeoutMs: Number(process.env.AI_RELAY_PREFLIGHT_TIMEOUT_MS) || 10_000,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify(aiRelayPreflightFailureReport(error)));
  process.exitCode = 1;
});
