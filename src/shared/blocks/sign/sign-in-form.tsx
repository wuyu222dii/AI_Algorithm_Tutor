'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { authClient, signIn } from '@/core/auth/client';
import { Link, useRouter } from '@/core/i18n/navigation';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useAppContext } from '@/shared/contexts/app';
import { cn } from '@/shared/lib/utils';

import {
  buildAuthHref,
  getAuthErrorCode,
  getLocaleLessCallback,
  getLocalizedCallback,
  isValidEmail,
} from './auth-form-utils';
import { PasswordInput } from './password-input';
import { SocialProviders } from './social-providers';

export function SignInForm({
  callbackUrl = '/',
  className,
}: {
  callbackUrl: string;
  className?: string;
}) {
  const t = useTranslations('common.sign');
  const router = useRouter();
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formError, setFormError] = useState('');
  const { configs, setIsShowSignModal } = useAppContext();

  const isGoogleAuthEnabled = configs.google_auth_enabled === 'true';
  const isGithubAuthEnabled = configs.github_auth_enabled === 'true';
  const isEmailAuthEnabled = configs.email_auth_enabled !== 'false';
  const hasAuthMethod =
    isEmailAuthEnabled || isGoogleAuthEnabled || isGithubAuthEnabled;
  const safeCallbackUrl = getLocaleLessCallback(callbackUrl, locale);
  const localizedCallbackUrl = getLocalizedCallback(callbackUrl, locale);
  const signUpHref = buildAuthHref('/sign-up', callbackUrl, locale);
  const forgotPasswordHref = `/forgot-password?callbackUrl=${encodeURIComponent(
    safeCallbackUrl
  )}`;

  const validate = () => {
    const normalizedEmail = email.trim();
    const nextEmailError = !normalizedEmail
      ? t('email_required')
      : !isValidEmail(normalizedEmail)
        ? t('email_invalid')
        : '';
    const nextPasswordError = password ? '' : t('password_required');
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    return !nextEmailError && !nextPasswordError;
  };

  const handleSignIn = async () => {
    if (loading || !validate()) return;

    setLoading(true);
    setFormError('');
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await signIn.email(
        {
          email: normalizedEmail,
          password,
          callbackURL: localizedCallbackUrl,
        },
        {
          onError: async (event: any) => {
            const status = event?.error?.status;
            const code = getAuthErrorCode(event);
            if (status === 403 || code.includes('EMAIL_NOT_VERIFIED')) {
              const verifyPath = `/verify-email?sent=1&email=${encodeURIComponent(
                normalizedEmail
              )}&callbackUrl=${encodeURIComponent(safeCallbackUrl)}`;

              try {
                const result = await authClient.sendVerificationEmail({
                  email: normalizedEmail,
                  callbackURL: localizedCallbackUrl,
                });
                if (result.error) {
                  setFormError(t('send_verification_failed'));
                  setLoading(false);
                  return;
                }
                setIsShowSignModal(false);
                router.push(verifyPath);
              } catch {
                setFormError(t('send_verification_failed'));
                setLoading(false);
              }
              return;
            }

            setFormError(
              code.includes('INVALID_EMAIL_OR_PASSWORD') ||
                code.includes('INVALID_PASSWORD') ||
                code.includes('USER_NOT_FOUND')
                ? t('invalid_credentials')
                : t('sign_in_failed')
            );
            setLoading(false);
          },
        }
      );
    } catch {
      setFormError(t('sign_in_failed'));
      setLoading(false);
    }
  };

  return (
    <div className={cn('w-full md:max-w-md', className)}>
      <div className="grid gap-4">
        {!hasAuthMethod && (
          <p
            className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
            role="status"
          >
            {t('auth_unavailable')}
          </p>
        )}

        {isEmailAuthEnabled && (
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleSignIn();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="modal-email">{t('email_title')}</Label>
              <Input
                id="modal-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={t('email_placeholder')}
                required
                disabled={loading}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? 'modal-email-error' : undefined}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError('');
                }}
              />
              {emailError && (
                <p
                  id="modal-email-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  {emailError}
                </p>
              )}
            </div>

            <PasswordInput
              id="modal-password"
              label={t('password_title')}
              placeholder={t('password_placeholder')}
              autoComplete="current-password"
              value={password}
              error={passwordError}
              disabled={loading}
              labelAction={
                <Link
                  href={forgotPasswordHref}
                  className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
                  onClick={() => setIsShowSignModal(false)}
                >
                  {t('forgot_password')}
                </Link>
              }
              onChange={(value) => {
                setPassword(value);
                setPasswordError('');
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
                  <span>{t('signing_in')}</span>
                </>
              ) : (
                t('sign_in_title')
              )}
            </Button>
          </form>
        )}

        <SocialProviders
          configs={configs}
          callbackUrl={callbackUrl}
          loading={loading}
          setLoading={setLoading}
        />
      </div>
      {hasAuthMethod && (
        <p className="mt-4 border-t pt-4 text-center text-xs text-neutral-500">
          {t('no_account')}{' '}
          <Link
            href={signUpHref}
            className="underline underline-offset-4"
            onClick={() => setIsShowSignModal(false)}
          >
            {t('sign_up_title')}
          </Link>
        </p>
      )}
    </div>
  );
}
