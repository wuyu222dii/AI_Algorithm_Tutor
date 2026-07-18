import {
  checkDeploymentHealth,
  DeploymentHealthConfigurationError,
} from '../src/shared/lib/deployment-health';

async function main() {
  const result = await checkDeploymentHealth({
    baseUrl: process.env.DEPLOYMENT_BASE_URL ?? '',
    canaryToken: process.env.AI_RELAY_CANARY_TOKEN ?? '',
    vercelProtectionBypass:
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? undefined,
    timeoutMs: process.env.DEPLOYMENT_HEALTH_TIMEOUT_MS
      ? Number(process.env.DEPLOYMENT_HEALTH_TIMEOUT_MS)
      : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ok') process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: 'error',
      code:
        error instanceof DeploymentHealthConfigurationError
          ? error.code
          : 'deployment_health_check_failed',
    })
  );
  process.exitCode = 1;
});
