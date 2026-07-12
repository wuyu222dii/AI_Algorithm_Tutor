import { getTranslations } from 'next-intl/server';

import { redirect } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { SignIn } from '@/shared/blocks/sign/sign-in';
import { getSafeInternalCallback } from '@/shared/lib/auth-redirect';
import { getPublicConfigs } from '@/shared/models/config';
import { getSignUser } from '@/shared/models/user';

function stripLocalePrefix(path: string, locale: string) {
  let stripped = path;
  if (path === `/${locale}`) stripped = '/';
  else if (path.startsWith(`/${locale}/`)) {
    stripped = path.slice(locale.length + 1) || '/';
  }
  return getSafeInternalCallback(stripped, '/');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const t = await getTranslations('common');

  return {
    title: `${t('sign.sign_in_title')} - ${t('metadata.title')}`,
    alternates: {
      canonical:
        locale !== defaultLocale
          ? `${envConfigs.app_url}/${locale}/sign-in`
          : `${envConfigs.app_url}/sign-in`,
    },
  };
}

export default async function SignInPage({
  searchParams,
  params,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    email?: string;
    verified?: string;
  }>;
  params: Promise<{ locale: string }>;
}) {
  const { callbackUrl, email } = await searchParams;
  const { locale } = await params;

  // If user is already signed in, don't show sign-in form again.
  const sessionUser = await getSignUser();
  const safeCallbackUrl = getSafeInternalCallback(callbackUrl, '/');
  if (sessionUser) {
    const target = stripLocalePrefix(safeCallbackUrl, locale);
    redirect({ href: target || '/', locale });
  }

  const configs = await getPublicConfigs();

  return (
    <SignIn
      configs={configs}
      callbackUrl={safeCallbackUrl}
      defaultEmail={email || ''}
    />
  );
}
