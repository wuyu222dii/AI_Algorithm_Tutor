#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : '3100';
const databaseDirectory = path.resolve(process.cwd(), '.test');
const databasePath = path.join(databaseDirectory, 'algocoach-e2e.db');

mkdirSync(databaseDirectory, { recursive: true });
rmSync(databasePath, { force: true });
rmSync(`${databasePath}-shm`, { force: true });
rmSync(`${databasePath}-wal`, { force: true });

const env = {
  ...process.env,
  NODE_ENV: 'development' as const,
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${databasePath}`,
  DB_SCHEMA_FILE: './src/config/db/schema.sqlite.ts',
  DB_AUTO_MIGRATE: 'false',
  AUTH_SECRET: 'algocoach-e2e-only-auth-secret-2026',
  NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
  AUTH_URL: `http://localhost:${port}`,
  NEXT_PUBLIC_COACH_CLOUD_SYNC_ENABLED: 'false',
  OPENROUTER_API_KEY: '',
};

const push = spawnSync(
  'drizzle-kit',
  ['push', '--force', '--config=src/core/db/config.ts'],
  { cwd: process.cwd(), env, stdio: 'inherit' }
);
if (push.error) throw push.error;
if (push.status !== 0) process.exit(push.status ?? 1);

const child = spawn('next', ['dev', '--turbopack', '--port', port], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

const forwardSignal = (signal: NodeJS.Signals) => {
  if (!child.killed) child.kill(signal);
};
process.on('SIGINT', forwardSignal);
process.on('SIGTERM', forwardSignal);

child.on('error', (error) => {
  console.error(`[e2e] failed to launch Next.js: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.off('SIGINT', forwardSignal);
  process.off('SIGTERM', forwardSignal);
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
