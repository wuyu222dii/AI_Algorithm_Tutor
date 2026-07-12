import { getTranslations } from 'next-intl/server';

import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { ResetPassword } from '@/shared/blocks/sign/reset-password';
import { getSafeInternalCallback } from '@/shared/lib/auth-redirect';
import { getPublicConfigs } from '@/shared/models/config';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('common');

  return {
    title: `${t('sign.reset_password_title')} - ${t('metadata.title')}`,
    alternates: {
      canonical:
        locale !== defaultLocale
          ? `${envConfigs.app_url}/${locale}/reset-password`
          : `${envConfigs.app_url}/reset-password`,
    },
  };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string;
    error?: string;
    callbackUrl?: string;
  }>;
}) {
  const { token, error, callbackUrl } = await searchParams;
  const configs = await getPublicConfigs();

  return (
    <ResetPassword
      token={token}
      invalid={Boolean(error)}
      enabled={configs.password_reset_enabled === 'true'}
      callbackUrl={getSafeInternalCallback(callbackUrl, '/')}
    />
  );
}
