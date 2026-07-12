#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

type EnvMode = 'development' | 'production' | 'test';

const args = process.argv.slice(2);

function takeOption(name: string): string | undefined {
  const exactIndex = args.indexOf(name);
  if (exactIndex >= 0) {
    const value = args[exactIndex + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a value`);
    }
    args.splice(exactIndex, 2);
    return value;
  }

  const prefix = `${name}=`;
  const inlineIndex = args.findIndex((arg) => arg.startsWith(prefix));
  if (inlineIndex >= 0) {
    const value = args[inlineIndex].slice(prefix.length);
    if (!value) throw new Error(`${name} requires a value`);
    args.splice(inlineIndex, 1);
    return value;
  }

  return undefined;
}

try {
  const explicitEnvFile = takeOption('--env') ?? process.env.ENV_FILE;
  const requestedMode =
    takeOption('--mode') ?? process.env.NODE_ENV ?? 'development';

  if (args.length === 0) throw new Error('No command provided');
  if (!['development', 'production', 'test'].includes(requestedMode)) {
    throw new Error(`Unsupported environment mode: ${requestedMode}`);
  }

  const dotenvArgs = explicitEnvFile
    ? ['-e', explicitEnvFile]
    : ['-c', requestedMode as EnvMode];

  console.log(
    explicitEnvFile
      ? `[env] loading ${explicitEnvFile}`
      : `[env] loading Next-compatible ${requestedMode} environment files`
  );

  const result = spawnSync('dotenv', [...dotenvArgs, '--', ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(
    `[env] ${error instanceof Error ? error.message : 'Unknown wrapper error'}`
  );
  process.exit(1);
}
