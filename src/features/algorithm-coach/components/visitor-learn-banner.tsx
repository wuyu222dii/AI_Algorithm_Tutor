'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Sparkles, X } from 'lucide-react';

import { useSession } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

import { trackProductEvent } from '../analytics';

export const GUIDED_PROBLEM_SLUG = 'first-unique-position';
export const GUIDED_PROBLEM_PATH = `/practice/${GUIDED_PROBLEM_SLUG}`;
export const VISITOR_EVENT_KEY = 'algocoach:visitor-started:v1';
export const VISITOR_LEARN_BANNER_KEY = 'algocoach:visitor-learn-banner:v1';

const copy = {
  zh: {
    title: '首次来访？从一道引导题开始',
    description:
      '无需注册即可体验完整练习流程。访客进度保存在当前浏览器，登录后可同步到账户。',
    action: '开始引导练习',
    dismiss: '关闭提示',
  },
  en: {
    title: 'First visit? Start with a guided problem',
    description:
      'Try the full practice flow without registering. Guest progress stays in this browser; sign in to sync later.',
    action: 'Start guided practice',
    dismiss: 'Dismiss',
  },
} as const;

export function VisitorLearnBanner({ locale }: { locale: 'zh' | 'en' }) {
  const t = copy[locale];
  const { data: session, isPending } = useSession();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isPending || session?.user?.id) return;

    let dismissed = false;
    try {
      dismissed =
        window.sessionStorage.getItem(VISITOR_LEARN_BANNER_KEY) === 'dismissed';
    } catch {
      // Banner still works when session storage is restricted.
    }

    if (dismissed) return;

    try {
      if (!window.sessionStorage.getItem(VISITOR_EVENT_KEY)) {
        trackProductEvent('visitor_started', {
          properties: { source: 'learn_entry' },
        });
        window.sessionStorage.setItem(VISITOR_EVENT_KEY, 'tracked');
      }
    } catch {
      // Analytics is best-effort when session storage is restricted.
    }

    setVisible(true);
  }, [isPending, session?.user?.id]);

  if (!visible) return null;

  function dismiss() {
    try {
      window.sessionStorage.setItem(VISITOR_LEARN_BANNER_KEY, 'dismissed');
    } catch {
      // Dismiss should not depend on browser storage access.
    }
    setVisible(false);
  }

  return (
    <div className="border-primary/20 bg-primary/5 mb-6 rounded-lg border p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="text-primary flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4" />
            {t.title}
          </div>
          <p className="text-muted-foreground text-sm leading-6">
            {t.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Button asChild size="sm">
            <Link href={GUIDED_PROBLEM_PATH} onClick={dismiss}>
              {t.action}
              <ArrowRight />
            </Link>
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
