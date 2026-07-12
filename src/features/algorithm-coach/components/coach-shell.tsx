'use client';

import { ReactNode, useMemo } from 'react';
import { useLocale } from 'next-intl';

import { Link, usePathname } from '@/core/i18n/navigation';
import { DashboardLayout } from '@/shared/blocks/dashboard';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { SidebarTrigger } from '@/shared/components/ui/sidebar';
import { Sidebar as SidebarType } from '@/shared/types/blocks/dashboard';

import { CoachProvider } from '../store';

const pageNames = {
  zh: {
    learn: '学习中心',
    problems: '题库',
    assessment: '能力测评',
    review: '复习',
    progress: '学习进度',
    about: '关于产品',
    practice: '代码演练',
    workspace: '学习工作台',
    demo: '演示模式',
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
    demo: 'Demo mode',
  },
} as const;

export function CoachShell({ children }: { children: ReactNode }) {
  const locale = useLocale() === 'zh' ? 'zh' : 'en';
  const pathname = usePathname();
  const copy = pageNames[locale];

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
    <CoachProvider>
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
              <Badge
                variant="outline"
                className="hidden rounded-md border-amber-500/40 bg-amber-500/10 text-amber-700 sm:inline-flex dark:text-amber-300"
              >
                {copy.demo}
              </Badge>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="hidden sm:inline-flex"
              >
                <Link href="/progress">{copy.progress}</Link>
              </Button>
            </div>
          </header>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </DashboardLayout>
    </CoachProvider>
  );
}
