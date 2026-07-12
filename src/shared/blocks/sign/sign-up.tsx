'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { authClient, signUp } from '@/core/auth/client';
import { Link, useRouter } from '@/core/i18n/navigation';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import {
  buildAuthHref,
  getAuthErrorCode,
  getLocaleLessCallback,
  getLocalizedCallback,
  isValidEmail,
  isValidPassword,
} from './auth-form-utils';
import { PasswordInput } from './password-input';
import { SocialProviders } from './social-providers';

type SignUpErrors = {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
};

export function SignUp({
  configs,
  callbackUrl = '/',
}: {
  configs: Record<string, string>;
  callbackUrl: string;
}) {
  const router = useRouter();
  const t = useTranslations('common.sign');
  const locale = useLocale();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<SignUpErrors>({});
  const [formError, setFormError] = useState('');

  const isGoogleAuthEnabled = configs.google_auth_enabled === 'true';
  const isGithubAuthEnabled = configs.github_auth_enabled === 'true';
  const isEmailAuthEnabled = configs.email_auth_enabled !== 'false';
  const emailVerificationEnabled =
    configs.email_verification_enabled === 'true';
  const hasAuthMethod =
    isEmailAuthEnabled || isGoogleAuthEnabled || isGithubAuthEnabled;
  const safeCallbackUrl = getLocaleLessCallback(callbackUrl, locale);
  const localizedCallbackUrl = getLocalizedCallback(callbackUrl, locale);
  const signInHref = buildAuthHref('/sign-in', callbackUrl, locale);

  const reportAffiliate = ({ userEmail }: { userEmail: string }) => {
    if (typeof window === 'undefined') return;
    const windowObject = window as any;

    if (configs.affonso_enabled === 'true' && windowObject.Affonso) {
      windowObject.Affonso.signup(userEmail);
    }
    if (configs.promotekit_enabled === 'true' && windowObject.promotekit) {
      windowObject.promotekit.refer(userEmail);
    }
  };

  const validate = () => {
    const nextErrors: SignUpErrors = {};
    const normalizedEmail = email.trim();

    if (!name.trim()) nextErrors.name = t('name_required');
    if (!normalizedEmail) nextErrors.email = t('email_required');
    else if (!isValidEmail(normalizedEmail)) {
      nextErrors.email = t('email_invalid');
    }
    if (!password) nextErrors.password = t('password_required');
    else if (!isValidPassword(password)) {
      nextErrors.password = t('password_length');
    }
    if (!confirmPassword) {
      nextErrors.confirmPassword = t('confirm_password_required');
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = t('password_mismatch');
    }
    if (!acceptedTerms) nextErrors.terms = t('terms_required');

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSignUp = async () => {
    if (loading || !validate()) return;

    setLoading(true);
    setFormError('');
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await signUp.email(
        {
          email: normalizedEmail,
          password,
          name: name.trim(),
        },
        {
          onSuccess: async () => {
            reportAffiliate({ userEmail: normalizedEmail });

            if (emailVerificationEnabled) {
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
                router.push(verifyPath);
              } catch {
                setFormError(t('send_verification_failed'));
                setLoading(false);
              }
              return;
            }

            router.push(safeCallbackUrl);
          },
          onError: (event: any) => {
            const code = getAuthErrorCode(event);
            setFormError(
              code.includes('USER_ALREADY_EXISTS') ||
                code.includes('EMAIL_ALREADY_EXISTS')
                ? t('account_exists')
                : code.includes('PASSWORD_TOO_SHORT') ||
                    code.includes('PASSWORD_TOO_LONG')
                  ? t('password_length')
                  : t('sign_up_failed')
            );
            setLoading(false);
          },
        }
      );
    } catch {
      setFormError(t('sign_up_failed'));
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto w-full md:max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">
          <h1>{t('sign_up_title')}</h1>
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">
          <h2>{t('sign_up_description')}</h2>
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                void handleSignUp();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="name">{t('name_title')}</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder={t('name_placeholder')}
                  required
                  disabled={loading}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'name-error' : undefined}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setErrors((current) => ({ ...current, name: undefined }));
                  }}
                />
                {errors.name && (
                  <p
                    id="name-error"
                    className="text-destructive text-xs"
                    role="alert"
                  >
                    {errors.name}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="email">{t('email_title')}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={t('email_placeholder')}
                  required
                  disabled={loading}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setErrors((current) => ({ ...current, email: undefined }));
                  }}
                />
                {errors.email ? (
                  <p
                    id="email-error"
                    className="text-destructive text-xs"
                    role="alert"
                  >
                    {errors.email}
                  </p>
                ) : emailVerificationEnabled ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('email_verification_hint')}
                  </p>
                ) : null}
              </div>

              <PasswordInput
                id="password"
                label={t('password_title')}
                placeholder={t('password_placeholder')}
                autoComplete="new-password"
                value={password}
                error={errors.password}
                hint={t('password_requirements')}
                disabled={loading}
                onChange={(value) => {
                  setPassword(value);
                  setErrors((current) => ({
                    ...current,
                    password: undefined,
                  }));
                }}
              />

              <PasswordInput
                id="confirm-password"
                label={t('confirm_password_title')}
                placeholder={t('confirm_password_placeholder')}
                autoComplete="new-password"
                value={confirmPassword}
                error={errors.confirmPassword}
                disabled={loading}
                onChange={(value) => {
                  setConfirmPassword(value);
                  setErrors((current) => ({
                    ...current,
                    confirmPassword: undefined,
                  }));
                }}
              />

              <div className="grid gap-2">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="accept-terms"
                    checked={acceptedTerms}
                    disabled={loading}
                    aria-invalid={Boolean(errors.terms)}
                    aria-describedby={errors.terms ? 'terms-error' : undefined}
                    onCheckedChange={(checked) => {
                      setAcceptedTerms(checked === true);
                      setErrors((current) => ({
                        ...current,
                        terms: undefined,
                      }));
                    }}
                  />
                  <Label
                    htmlFor="accept-terms"
                    className="text-muted-foreground block text-xs leading-5 font-normal"
                  >
                    {t('terms_prefix')}{' '}
                    <Link
                      href="/terms-of-service"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-4"
                    >
                      {t('terms_of_service')}
                    </Link>{' '}
                    {t('terms_and')}{' '}
                    <Link
                      href="/privacy-policy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-4"
                    >
                      {t('privacy_policy')}
                    </Link>
                  </Label>
                </div>
                {errors.terms && (
                  <p
                    id="terms-error"
                    className="text-destructive text-xs"
                    role="alert"
                  >
                    {errors.terms}
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
                    <span>{t('signing_up')}</span>
                  </>
                ) : (
                  t('sign_up_title')
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
      </CardContent>
      {hasAuthMethod && (
        <CardFooter>
          <p className="w-full border-t pt-4 text-center text-xs text-neutral-500">
            {t('already_have_account')}{' '}
            <Link href={signInHref} className="underline underline-offset-4">
              {t('sign_in_title')}
            </Link>
          </p>
        </CardFooter>
      )}
    </Card>
  );
}
