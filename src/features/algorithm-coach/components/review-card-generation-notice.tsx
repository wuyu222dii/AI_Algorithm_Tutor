'use client';

import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

const copy = {
  zh: {
    pending: '正在生成复习卡',
    pendingDetail: '本地测试已完成，你可以继续练习或离开此页。',
    failed: '复习卡尚未生成',
    failedDetail: '完成记录已保存，AI 服务恢复后可单独重试。',
    retry: '重试生成',
    ready: '复习卡已保存',
    readyDetail: '可前往复习中心进行主动回忆。',
  },
  en: {
    pending: 'Generating review card',
    pendingDetail:
      'The local tests are complete. You can keep practicing or leave this page.',
    failed: 'Review card not generated yet',
    failedDetail:
      'Your completion is saved. Retry this step when the AI service recovers.',
    retry: 'Retry generation',
    ready: 'Review card saved',
    readyDetail: 'Open the review center when you are ready for active recall.',
  },
} as const;

export type ReviewCardGenerationStatus =
  | 'idle'
  | 'pending'
  | 'failed'
  | 'ready';

export function ReviewCardGenerationNotice({
  locale,
  status,
  onRetry,
}: {
  locale: 'zh' | 'en';
  status: ReviewCardGenerationStatus;
  onRetry: () => void;
}) {
  if (status === 'idle') return null;
  const t = copy[locale];
  const failed = status === 'failed';
  const pending = status === 'pending';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-md border p-3',
        failed
          ? 'border-amber-500/35 bg-amber-500/8'
          : status === 'ready'
            ? 'border-emerald-500/30 bg-emerald-500/8'
            : 'border-primary/25 bg-primary/5'
      )}
    >
      <div className="flex items-start gap-2">
        {pending ? (
          <LoaderCircle className="text-primary mt-0.5 size-4 shrink-0 animate-spin" />
        ) : failed ? (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
        ) : (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            {pending ? t.pending : failed ? t.failed : t.ready}
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {pending
              ? t.pendingDetail
              : failed
                ? t.failedDetail
                : t.readyDetail}
          </p>
          {failed ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-7 bg-transparent text-xs"
              onClick={onRetry}
            >
              <RotateCcw />
              {t.retry}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
