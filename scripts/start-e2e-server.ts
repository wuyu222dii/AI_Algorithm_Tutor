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
  AUTH_SOCIAL_SIGN_IN_RATE_WINDOW_MS: '60000',
  AUTH_SOCIAL_SIGN_IN_RATE_MAX: '20',
  NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
  NEXT_PUBLIC_DEFAULT_LOCALE: 'zh',
  NEXT_PUBLIC_LOCALE_DETECT_ENABLED: 'false',
  AUTH_URL: `http://localhost:${port}`,
  GOOGLE_AUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'algocoach-e2e-google-client-id',
  GOOGLE_CLIENT_SECRET: 'algocoach-e2e-google-client-secret',
  GOOGLE_ONE_TAP_ENABLED: 'false',
  GOOGLE_OAUTH_MOCK_ENABLED: 'true',
  GOOGLE_OAUTH_MOCK_SECRET: 'algocoach-e2e-google-oauth-mock-secret-2026',
  NEXT_PUBLIC_COACH_CLOUD_SYNC_ENABLED: 'false',
  OPENROUTER_API_KEY: '',
  ALGO_COACH_MODEL: 'google/gemini-2.5-flash',
  COACH_DEMO_FALLBACK_ENABLED: 'true',
  COACH_RATE_LIMIT_PER_MINUTE: '20',
  COACH_RATE_LIMIT_PER_10_SECONDS: '5',
  COACH_AUTHENTICATED_DAILY_REQUESTS: '200',
  COACH_GUEST_DAILY_REQUESTS: '40',
  REDIS_URL: '',
  REDIS_TOKEN: '',
  SENTRY_DSN: '',
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: '',
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
