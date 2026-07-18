import * as Sentry from '@sentry/nextjs';

import { sanitizeSentryEvent } from '@/shared/lib/sentry-privacy';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.02 : 0,
  sendDefaultPii: false,
  beforeSend: sanitizeSentryEvent,
});
