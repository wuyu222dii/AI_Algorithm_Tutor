'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh">
      <body className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
        <main className="bg-card w-full max-w-md rounded-lg border p-6 text-center">
          <h1 className="text-lg font-semibold">页面暂时无法加载</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            错误已记录，请重试当前操作。
          </p>
          <button
            type="button"
            className="bg-primary text-primary-foreground mt-5 rounded-md px-4 py-2 text-sm font-medium"
            onClick={reset}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
