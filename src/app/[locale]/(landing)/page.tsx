import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getThemePage } from '@/core/theme';
import { envConfigs } from '@/config';
import { HomeJsonLd } from '@/shared/blocks/common/home-json-ld';
import { getHreflangAlternates } from '@/shared/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.index' });
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}/`
      : `${envConfigs.app_url}/${locale}`;

  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: {
      canonical,
      languages: getHreflangAlternates('/'),
    },
  };
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.index' });
  const Page = await getThemePage('dynamic-page');

  return (
    <>
      <HomeJsonLd locale={locale} />
      <Page locale={locale} page={t.raw('page')} />
    </>
  );
}
