import { defaultLocale } from '@/config/locale';
import { getSafeInternalCallback } from '@/shared/lib/auth-redirect';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidPassword(value: string) {
  return (
    value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH
  );
}

export function getLocaleLessCallback(
  callbackUrl: string | undefined,
  locale: string
) {
  const safeCallback = getSafeInternalCallback(callbackUrl, '/learn');

  if (safeCallback === `/${locale}`) return '/learn';
  if (safeCallback.startsWith(`/${locale}/`)) {
    const stripped = safeCallback.slice(locale.length + 1) || '/learn';
    return getSafeInternalCallback(stripped, '/learn');
  }

  return getSafeInternalCallback(safeCallback, '/learn');
}

export function getLocalizedCallback(
  callbackUrl: string | undefined,
  locale: string
) {
  const safeCallback = getLocaleLessCallback(callbackUrl, locale);

  if (locale === defaultLocale) return safeCallback;
  return `/${locale}${safeCallback === '/' ? '' : safeCallback}`;
}

export function getOAuthErrorCallback(
  callbackUrl: string | undefined,
  locale: string
) {
  const safeCallback = getLocaleLessCallback(callbackUrl, locale);
  const pathname =
    locale === defaultLocale ? '/auth-error' : `/${locale}/auth-error`;
  const query = new URLSearchParams({ callbackUrl: safeCallback });
  return `${pathname}?${query.toString()}`;
}

export function buildAuthHref(
  pathname: '/sign-in' | '/sign-up',
  callbackUrl: string | undefined,
  locale: string,
  extra?: Record<string, string>
) {
  const query = new URLSearchParams(extra);
  query.set('callbackUrl', getLocaleLessCallback(callbackUrl, locale));
  return `${pathname}?${query.toString()}`;
}

export function getAuthErrorCode(error: unknown) {
  const candidate = error as {
    code?: string;
    error?: { code?: string; status?: number; message?: string };
  };

  return String(candidate?.error?.code || candidate?.code || '').toUpperCase();
}
