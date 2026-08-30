'use client';

import { useEffect, useMemo, useState } from 'react';
import { CloudUpload, X } from 'lucide-react';

import { useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

import { useCoachStore } from '../store';

const DISMISS_KEY = 'algocoach:guest-sync-prompt:v1';

const copy = {
  zh: {
    title: '保存进度到云端',
    description:
      '你已完成关键学习里程碑。登录后可将练习记录、测评结果和复习卡片同步到个人账户。',
    action: '登录同步',
    dismiss: '稍后再说',
  },
  en: {
    title: 'Save your progress to the cloud',
    description:
      'You reached a key learning milestone. Sign in to sync practice history, assessments, and review cards.',
    action: 'Sign in to sync',
    dismiss: 'Maybe later',
  },
} as const;

export function GuestSyncPrompt({ locale }: { locale: 'zh' | 'en' }) {
  const t = copy[locale];
  const { data: session, isPending } = useSession();
  const { hydrated, state } = useCoachStore();
  const [dismissed, setDismissed] = useState(true);

  const milestoneReached = useMemo(
    () =>
      state.events.some(
        (event) =>
          event.name === 'first_problem_passed' ||
          event.name === 'assessment_completed' ||
          event.name === 'baseline_completed'
      ),
    [state.events]
  );

  useEffect(() => {
    if (isPending || session?.user?.id || !hydrated || !milestoneReached) {
      return;
    }

    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === 'dismissed');
    } catch {
      setDismissed(false);
    }
  }, [hydrated, isPending, milestoneReached, session?.user?.id]);

  if (isPending || session?.user?.id || !hydrated || !milestoneReached || dismissed) {
    return null;
  }

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, 'dismissed');
    } catch {
      // Dismiss should not depend on browser storage access.
    }
    setDismissed(true);
  }

  return (
    <div
      className="border-emerald-500/30 bg-emerald-500/10 mx-4 mt-4 rounded-lg border px-4 py-3 md:mx-6"
      role="status"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-900 dark:text-emerald-200">
            <CloudUpload className="size-4" />
            {t.title}
          </div>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            {t.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm">
            <Link href="/sign-in">{t.action}</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={dismiss}
            aria-label={t.dismiss}
          >
            <X />
            {t.dismiss}
          </Button>
        </div>
      </div>
    </div>
  );
}
