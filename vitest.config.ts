import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      'server-only': path.resolve(rootDir, 'vitest.server-only.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/features/algorithm-coach/{assessment.server,assessment-draft,analytics,daily-plan,learning-evidence,learning-progress,metrics,model-circuit.server,model,relay-config,relay-preflight,review-grading,server,storage,sync-error,sync,rate-limit.server,problem-contracts}.ts',
        'src/features/algorithm-coach/catalog/pipeline.ts',
        'src/app/api/assessment/session/route.ts',
        'src/app/api/coach/route.ts',
        'src/app/api/coach/chat/route.ts',
        'src/app/api/coach/events/route.ts',
        'src/app/api/coach/events/batch/route.ts',
        'src/app/api/coach/state/claim/route.ts',
        'src/core/db/readiness.ts',
        'src/shared/lib/{auth-redirect,deployment-health,oauth-error,redis-url,telemetry-sanitize}.ts',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/fixtures/**',
        '**/data/**',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
        'src/features/algorithm-coach/sync.ts': { lines: 90 },
        'src/features/algorithm-coach/catalog/pipeline.ts': { lines: 90 },
        'src/app/api/assessment/session/route.ts': { lines: 90 },
        'src/app/api/coach/state/claim/route.ts': { lines: 90 },
        'src/shared/lib/auth-redirect.ts': { lines: 90 },
      },
    },
  },
});
