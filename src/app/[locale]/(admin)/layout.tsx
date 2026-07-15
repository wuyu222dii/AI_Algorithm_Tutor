import type { ReactNode } from 'react';

import { redirect } from '@/core/i18n/navigation';
import { PERMISSIONS } from '@/core/rbac/permission';
import { DashboardLayout } from '@/shared/blocks/dashboard';
import { getSignUser } from '@/shared/models/user';
import { hasAnyPermission } from '@/shared/services/rbac';
import type { Sidebar } from '@/shared/types/blocks/dashboard';

export const dynamic = 'force-dynamic';

export default async function CatalogAdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getSignUser();
  if (!user) {
    redirect({
      href: '/sign-in?callbackUrl=/admin/catalog/candidates',
      locale,
    });
  }
  const allowed = await hasAnyPermission(user!.id, [PERMISSIONS.CATALOG_READ]);
  if (!allowed) redirect({ href: '/no-permission', locale });

  const zh = locale === 'zh';
  const sidebar: Sidebar = {
    variant: 'sidebar',
    collapsible: 'icon',
    header: {
      brand: {
        title: zh ? 'AI 算法教练' : 'AlgoCoach',
        logo: { src: '/logo.png', alt: 'AlgoCoach' },
        url: '/admin/catalog/candidates',
      },
      show_trigger: false,
    },
    main_navs: [
      {
        title: zh ? '题库运营' : 'Catalog operations',
        items: [
          {
            title: zh ? '候选审核' : 'Candidate review',
            url: '/admin/catalog/candidates',
            icon: 'ListChecks',
          },
        ],
      },
    ],
    bottom_nav: {
      items: [
        {
          title: zh ? '返回学习区' : 'Back to learning',
          url: '/learn',
          icon: 'ArrowLeft',
        },
      ],
    },
    user: {
      show_email: true,
      show_signout: true,
      signout_callback: '/about',
    },
    footer: { show_theme: true, show_locale: true },
  };

  return <DashboardLayout sidebar={sidebar}>{children}</DashboardLayout>;
}
