#!/usr/bin/env node
import { spawn } from 'node:child_process';

import { migrateDatabase } from './migrate-database';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'dev' && command !== 'start') {
    throw new Error('Expected Next command "dev" or "start"');
  }

  await migrateDatabase();

  const child = spawn('next', [command, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  child.on('error', (error) => {
    console.error(`[start] failed to launch Next.js: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    process.off('SIGINT', forwardSignal);
    process.off('SIGTERM', forwardSignal);
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(
    `[start] ${error instanceof Error ? error.message : 'Unknown startup error'}`
  );
  process.exit(1);
});
