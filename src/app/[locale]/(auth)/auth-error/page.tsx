import { AlertCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/core/i18n/navigation';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { getSafeInternalCallback } from '@/shared/lib/auth-redirect';
import { getOAuthErrorMessageKey } from '@/shared/lib/oauth-error';

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const t = await getTranslations('common.sign');
  const safeCallbackUrl = getSafeInternalCallback(callbackUrl, '/learn');
  const signInQuery = new URLSearchParams({ callbackUrl: safeCallbackUrl });
  const messageKey = getOAuthErrorMessageKey(error);

  return (
    <Card className="mx-auto w-full md:max-w-md">
      <CardHeader className="space-y-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-red-500/10 text-red-600 dark:text-red-400">
          <AlertCircle className="size-5" aria-hidden="true" />
        </div>
        <CardTitle className="text-lg md:text-xl">
          <h1>{t('oauth_error_title')}</h1>
        </CardTitle>
        <CardDescription role="alert">{t(messageKey)}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          {t('oauth_error_privacy_notice')}
        </p>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="w-full sm:flex-1">
          <Link href={`/sign-in?${signInQuery.toString()}`}>
            {t('oauth_try_again')}
          </Link>
        </Button>
        <Button asChild variant="outline" className="w-full sm:flex-1">
          <Link href={safeCallbackUrl}>{t('oauth_return_to_learning')}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
