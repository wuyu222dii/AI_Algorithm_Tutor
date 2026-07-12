'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { authClient } from '@/core/auth/client';
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

import { buildAuthHref, isValidPassword } from './auth-form-utils';
import { PasswordInput } from './password-input';

export function ResetPassword({
  token,
  invalid,
  enabled,
  callbackUrl,
}: {
  token?: string;
  invalid?: boolean;
  enabled: boolean;
  callbackUrl: string;
}) {
  const t = useTranslations('common.sign');
  const locale = useLocale();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const signInHref = buildAuthHref('/sign-in', callbackUrl, locale);
  const linkInvalid = invalid || !token;

  const handleSubmit = async () => {
    const nextPasswordError = !password
      ? t('password_required')
      : !isValidPassword(password)
        ? t('password_length')
        : '';
    const nextConfirmError = !confirmPassword
      ? t('confirm_password_required')
      : password !== confirmPassword
        ? t('password_mismatch')
        : '';
    setPasswordError(nextPasswordError);
    setConfirmError(nextConfirmError);
    if (nextPasswordError || nextConfirmError || !token) return;

    setLoading(true);
    setFormError('');
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) {
        setFormError(t('reset_password_failed'));
        return;
      }
      setSuccess(true);
    } catch {
      setFormError(t('reset_password_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto w-full md:max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
          {success ? <CheckCircle2 className="text-emerald-600" /> : null}
          <h1>{t('reset_password_title')}</h1>
        </CardTitle>
        <CardDescription>{t('reset_password_description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {linkInvalid ? (
          <div
            className="flex gap-3 rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-800 dark:text-red-200"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>{t('invalid_reset_link')}</p>
          </div>
        ) : !enabled ? (
          <div
            className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100"
            role="status"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>{t('password_reset_unavailable')}</p>
          </div>
        ) : success ? (
          <div className="grid gap-2 text-sm" role="status">
            <p className="font-medium">{t('reset_password_success')}</p>
            <p className="text-muted-foreground">
              {t('reset_password_success_description')}
            </p>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <PasswordInput
              id="new-password"
              label={t('new_password_title')}
              placeholder={t('new_password_placeholder')}
              autoComplete="new-password"
              value={password}
              error={passwordError}
              hint={t('password_requirements')}
              disabled={loading}
              onChange={(value) => {
                setPassword(value);
                setPasswordError('');
              }}
            />
            <PasswordInput
              id="confirm-new-password"
              label={t('confirm_password_title')}
              placeholder={t('confirm_password_placeholder')}
              autoComplete="new-password"
              value={confirmPassword}
              error={confirmError}
              disabled={loading}
              onChange={(value) => {
                setConfirmPassword(value);
                setConfirmError('');
              }}
            />
            {formError && (
              <p className="text-destructive text-sm" role="alert">
                {formError}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="animate-spin" />
                  <span>{t('resetting_password')}</span>
                </>
              ) : (
                t('reset_password_submit')
              )}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter>
        <Button
          asChild
          className="w-full"
          variant={success ? 'default' : 'ghost'}
        >
          <Link href={signInHref}>{t('back_to_sign_in')}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
