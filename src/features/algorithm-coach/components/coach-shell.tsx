'use client';

import { ReactNode, useMemo } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useLocale } from 'next-intl';

import { useSession } from '@/core/auth/client';
import { Link, usePathname } from '@/core/i18n/navigation';
import { DashboardLayout } from '@/shared/blocks/dashboard';
import { SignUser } from '@/shared/blocks/sign/sign-user';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { SidebarTrigger } from '@/shared/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';
import { UserNav } from '@/shared/types/blocks/common';
import { Sidebar as SidebarType } from '@/shared/types/blocks/dashboard';

import { createCoachStorageScope } from '../storage';
import { CoachProvider, useCoachStore } from '../store';

export const pageNames = {
  zh: {
    learn: '学习中心',
    problems: '题库',
    assessment: '能力测评',
    review: '复习',
    progress: '学习进度',
    about: '关于产品',
    practice: '代码演练',
    workspace: '学习工作台',
    sync: '云端已同步',
    syncing: '同步中',
    syncError: '同步失败',
    retrySync: '重试同步',
    syncErrors: {
      conflict: {
        label: '数据冲突',
        description: '云端数据冲突未能自动合并，请手动重试同步。',
      },
      network: {
        label: '网络中断',
        description: '当前无法连接同步服务，请检查网络后重试。',
      },
      auth: {
        label: '登录失效',
        description: '登录状态已失效，请重新登录后重试同步。',
      },
      server: {
        label: '服务异常',
        description: '同步服务暂时不可用，你的本地学习数据仍已保留。',
      },
    },
    guest: '访客本地',
    profile: '个人资料',
    security: '安全设置',
  },
  en: {
    learn: 'Learning Hub',
    problems: 'Problems',
    assessment: 'Assessment',
    review: 'Review',
    progress: 'Progress',
    about: 'About',
    practice: 'Practice',
    workspace: 'Learning workspace',
    sync: 'Cloud synced',
    syncing: 'Syncing',
    syncError: 'Sync failed',
    retrySync: 'Retry sync',
    syncErrors: {
      conflict: {
        label: 'Data conflict',
        description:
          'Cloud changes could not be merged automatically. Retry the sync.',
      },
      network: {
        label: 'Network offline',
        description:
          'The sync service cannot be reached. Check your connection and retry.',
      },
      auth: {
        label: 'Sign-in expired',
        description:
          'Your session has expired. Sign in again, then retry the sync.',
      },
      server: {
        label: 'Service unavailable',
        description:
          'The sync service is temporarily unavailable. Your local learning data is preserved.',
      },
    },
    guest: 'Guest local',
    profile: 'Profile',
    security: 'Security',
  },
} as const;

export function CoachShell({ children }: { children: ReactNode }) {
  const locale = useLocale() === 'zh' ? 'zh' : 'en';
  const pathname = usePathname();
  const copy = pageNames[locale];
  const { data: session, isPending: isSessionPending } = useSession();
  const storageScope = isSessionPending
    ? null
    : createCoachStorageScope(session?.user?.id);

  const sidebar = useMemo<SidebarType>(
    () => ({
      variant: 'inset',
      collapsible: 'icon',
      header: {
        show_trigger: true,
        brand: {
          title: locale === 'zh' ? 'AI 算法教练' : 'AlgoCoach',
          url: '/learn',
        },
      },
      main_navs: [
        {
          items: [
            { title: copy.learn, url: '/learn', icon: 'House' },
            { title: copy.problems, url: '/problems', icon: 'LibraryBig' },
            {
              title: copy.assessment,
              url: '/assessment',
              icon: 'ClipboardCheck',
            },
            { title: copy.review, url: '/review', icon: 'NotebookTabs' },
            {
              title: copy.progress,
              url: '/progress',
              icon: 'ChartNoAxesColumn',
            },
          ],
        },
      ],
      bottom_nav: {
        items: [{ title: copy.about, url: '/about', icon: 'CircleHelp' }],
      },
      footer: {
        show_locale: true,
        show_theme: true,
      },
    }),
    [copy, locale]
  );

  const userNav = useMemo<UserNav>(
    () => ({
      show_name: true,
      show_credits: false,
      show_sign_out: true,
      items: [
        { title: copy.profile, url: '/settings/profile', icon: 'UserRound' },
        {
          title: copy.security,
          url: '/settings/security',
          icon: 'ShieldCheck',
        },
      ],
    }),
    [copy]
  );

  const currentPage = pathname.startsWith('/practice')
    ? copy.practice
    : pathname.startsWith('/problems')
      ? copy.problems
      : pathname.startsWith('/assessment')
        ? copy.assessment
        : pathname.startsWith('/review')
          ? copy.review
          : pathname.startsWith('/progress')
            ? copy.progress
            : copy.learn;

  return (
    <CoachProvider
      key={storageScope ?? 'auth-pending'}
      storageScope={storageScope}
    >
      <DashboardLayout sidebar={sidebar}>
        <div className="bg-background flex min-h-svh min-w-0 flex-col">
          <header className="bg-background/95 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur md:px-6">
            <SidebarTrigger
              aria-label={locale === 'zh' ? '切换侧栏' : 'Toggle sidebar'}
            />
            <div className="bg-border h-4 w-px" />
            <span className="min-w-0 truncate text-sm font-medium">
              {currentPage}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <CoachSyncBadge
                signedIn={Boolean(session?.user?.id)}
                copy={copy}
              />
              <Button
                asChild
                size="sm"
                variant="outline"
                className="hidden sm:inline-flex"
              >
                <Link href="/progress">{copy.progress}</Link>
              </Button>
              <SignUser userNav={userNav} callbackUrl={pathname} />
            </div>
          </header>
          <main className="min-w-0 flex-1">
            <HydratedCoachContent>{children}</HydratedCoachContent>
          </main>
        </div>
      </DashboardLayout>
    </CoachProvider>
  );
}

function HydratedCoachContent({ children }: { children: ReactNode }) {
  const { hydrated } = useCoachStore();
  if (!hydrated) {
    return (
      <div
        className="text-muted-foreground flex min-h-[70svh] items-center justify-center"
        role="status"
        aria-label="Loading learning data"
      >
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }
  return children;
}

export function CoachSyncBadge({
  signedIn,
  copy,
}: {
  signedIn: boolean;
  copy: (typeof pageNames)[keyof typeof pageNames];
}) {
  const { retrySync, syncError, syncStatus } = useCoachStore();
  const status = signedIn ? syncStatus : 'local';
  const label = !signedIn
    ? copy.guest
    : status === 'syncing'
      ? copy.syncing
      : status === 'error'
        ? copy.syncError
        : copy.sync;

  if (signedIn && status === 'error') {
    const errorCopy = copy.syncErrors[syncError ?? 'server'];
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="border-red-500/40 bg-red-500/10 text-red-700 sm:h-8 sm:w-auto sm:px-2.5 dark:text-red-300"
            onClick={retrySync}
            title={errorCopy.description}
            aria-label={`${errorCopy.label}. ${errorCopy.description} ${copy.retrySync}`}
          >
            <RefreshCw />
            <span className="hidden sm:inline">{errorCopy.label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-72">
          {errorCopy.description} {copy.retrySync}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        'hidden rounded-md sm:inline-flex',
        status === 'local' &&
          'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        status === 'syncing' &&
          'border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
        status === 'synced' &&
          'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        status === 'error' &&
          'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
      )}
    >
      {label}
    </Badge>
  );
}
