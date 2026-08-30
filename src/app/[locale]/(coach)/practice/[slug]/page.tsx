import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { envConfigs } from '@/config';
import { getRuntimeProblem } from '@/features/algorithm-coach/catalog-runtime.server';
import { PracticeWorkspace } from '@/features/algorithm-coach/components/practice-workspace';
import { isImportedDraftSlug } from '@/features/algorithm-coach/imported-drafts';
import { getHreflangAlternates } from '@/shared/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  if (isImportedDraftSlug(slug)) {
    const t = await getTranslations({ locale, namespace: 'coach.practice' });
    return {
      title: t('draftTitle'),
      description: t('draftDescription'),
      robots: { index: false, follow: false },
    };
  }

  const problem = await getRuntimeProblem(slug);
  const path = `/practice/${slug}`;
  const coachLocale = locale === 'zh' ? 'zh' : 'en';
  const canonical =
    locale === envConfigs.locale
      ? `${envConfigs.app_url}${path}`
      : `${envConfigs.app_url}/${locale}${path}`;

  if (!problem) {
    const t = await getTranslations({ locale, namespace: 'coach.practice' });
    return {
      title: t('missingTitle'),
      description: t('missingDescription'),
      alternates: {
        canonical,
        languages: getHreflangAlternates(path),
      },
      robots: { index: false, follow: false },
    };
  }

  const topics = problem.topics?.slice(0, 3).join(', ') ?? '';
  const t = await getTranslations({ locale, namespace: 'coach.practice' });
  const problemTitle = problem.title[coachLocale];
  const title = t('problemTitle', { title: problemTitle });
  const description = t('problemDescription', {
    title: problemTitle,
    difficulty: problem.difficulty,
    topics,
  });

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: getHreflangAlternates(path),
    },
    openGraph: {
      type: 'website',
      locale,
      url: canonical,
      title,
      description,
      siteName: envConfigs.app_name,
    },
  };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const rawVersion = Array.isArray(query.version)
    ? query.version[0]
    : query.version;
  const parsedVersion =
    rawVersion === undefined ? undefined : Number(rawVersion);
  const requestedContentVersion =
    Number.isInteger(parsedVersion) && Number(parsedVersion) > 0
      ? Number(parsedVersion)
      : undefined;
  const invalidVersion = rawVersion !== undefined && !requestedContentVersion;
  const initialProblem =
    !invalidVersion && !isImportedDraftSlug(slug)
      ? await getRuntimeProblem(slug, requestedContentVersion)
      : undefined;

  return (
    <PracticeWorkspace
      slug={slug}
      initialProblem={initialProblem}
      requestedContentVersion={requestedContentVersion}
      versionUnavailable={
        invalidVersion || (!isImportedDraftSlug(slug) && !initialProblem)
      }
    />
  );
}
