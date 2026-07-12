'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { authClient } from '@/core/auth/client';
import { Link } from '@/core/i18n/navigation';
import { defaultLocale } from '@/config/locale';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import {
  buildAuthHref,
  getLocaleLessCallback,
  isValidEmail,
} from './auth-form-utils';

export function ForgotPassword({
  enabled,
  callbackUrl,
}: {
  enabled: boolean;
  callbackUrl: string;
}) {
  const t = useTranslations('common.sign');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const signInHref = buildAuthHref('/sign-in', callbackUrl, locale);
  const safeCallbackUrl = getLocaleLessCallback(callbackUrl, locale);

  const handleSubmit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setEmailError(t('email_required'));
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setEmailError(t('email_invalid'));
      return;
    }

    setLoading(true);
    setFormError('');
    const base = locale === defaultLocale ? '' : `/${locale}`;
    const resetQuery = new URLSearchParams({
      callbackUrl: safeCallbackUrl,
    });

    try {
      const result = await authClient.requestPasswordReset({
        email: normalizedEmail,
        redirectTo: `${base}/reset-password?${resetQuery.toString()}`,
      });
      // Keep the response identical whether or not the account exists.
      // Server-side capability checks already cover missing email configuration.
      void result;
      setSubmitted(true);
    } catch {
      setFormError(t('password_reset_request_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto w-full md:max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
          {submitted ? <CheckCircle2 className="text-emerald-600" /> : null}
          <h1>{t('forgot_password_title')}</h1>
        </CardTitle>
        <CardDescription>{t('forgot_password_description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!enabled ? (
          <div
            className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100"
            role="status"
          >
            <MailWarning className="mt-0.5 size-4 shrink-0" />
            <p>{t('password_reset_unavailable')}</p>
          </div>
        ) : submitted ? (
          <div className="grid gap-2 text-sm" role="status">
            <p className="font-medium">
              {t('password_reset_email_sent_title')}
            </p>
            <p className="text-muted-foreground">
              {t('password_reset_email_sent_description')}
            </p>
          </div>
        ) : (
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="reset-email">{t('email_title')}</Label>
              <Input
                id="reset-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={t('email_placeholder')}
                required
                disabled={loading}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? 'reset-email-error' : undefined}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError('');
                }}
              />
              {emailError && (
                <p
                  id="reset-email-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  {emailError}
                </p>
              )}
            </div>
            {formError && (
              <p className="text-destructive text-sm" role="alert">
                {formError}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="animate-spin" />
                  <span>{t('sending_reset_link')}</span>
                </>
              ) : (
                t('send_reset_link')
              )}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild variant="ghost" className="w-full">
          <Link href={signInHref}>{t('back_to_sign_in')}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
