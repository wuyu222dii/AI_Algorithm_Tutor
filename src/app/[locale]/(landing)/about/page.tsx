import type { Metadata } from 'next';
import { VisitorWelcomeDialog } from '@/features/algorithm-coach/components/visitor-welcome-dialog';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getThemePage } from '@/core/theme';
import { envConfigs } from '@/config';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.about' });
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/about`
      : `${envConfigs.app_url}/${locale}/about`;

  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: { canonical },
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.about' });
  const Page = await getThemePage('dynamic-page');

  return (
    <>
      <Page locale={locale} page={t.raw('page')} />
      <VisitorWelcomeDialog locale={locale === 'zh' ? 'zh' : 'en'} />
    </>
  );
}
