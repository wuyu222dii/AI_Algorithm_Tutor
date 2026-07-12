import { getTranslations } from 'next-intl/server';

import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { ForgotPassword } from '@/shared/blocks/sign/forgot-password';
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
    title: `${t('sign.forgot_password_title')} - ${t('metadata.title')}`,
    alternates: {
      canonical:
        locale !== defaultLocale
          ? `${envConfigs.app_url}/${locale}/forgot-password`
          : `${envConfigs.app_url}/forgot-password`,
    },
  };
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const configs = await getPublicConfigs();

  return (
    <ForgotPassword
      enabled={configs.password_reset_enabled === 'true'}
      callbackUrl={getSafeInternalCallback(callbackUrl, '/')}
    />
  );
}
