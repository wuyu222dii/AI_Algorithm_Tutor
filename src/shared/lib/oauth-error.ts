import { getSafeInternalCallback } from './auth-redirect';

const AUTH_ERROR_PATH = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?auth-error$/;

export type OAuthErrorMessageKey =
  | 'oauth_cancelled'
  | 'oauth_account_conflict'
  | 'oauth_provider_failed'
  | 'oauth_restart_required'
  | 'oauth_sign_in_failed';

export function normalizeOAuthErrorCode(value: unknown) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_'-]/g, '_')
    .slice(0, 64);

  return normalized || 'oauth_error';
}

export function getOAuthErrorMessageKey(error: unknown): OAuthErrorMessageKey {
  const code = normalizeOAuthErrorCode(error);

  if (['access_denied', 'cancelled', 'popup_closed'].includes(code)) {
    return 'oauth_cancelled';
  }
  if (
    [
      'account_not_linked',
      'unable_to_link_account',
      "email_doesn't_match",
      'email_doesn_t_match',
      'account_already_linked_to_different_user',
    ].includes(code)
  ) {
    return 'oauth_account_conflict';
  }
  if (
    [
      'invalid_code',
      'oauth_provider_not_found',
      'unable_to_get_user_info',
      'email_not_found',
    ].includes(code)
  ) {
    return 'oauth_provider_failed';
  }
  if (
    [
      'please_restart_the_process',
      'state_not_found',
      'invalid_callback_request',
      'no_code',
    ].includes(code)
  ) {
    return 'oauth_restart_required';
  }

  return 'oauth_sign_in_failed';
}

export function getSafeOAuthErrorCallback(
  value: unknown,
  fallback = '/auth-error?callbackUrl=%2Flearn'
) {
  const safeValue = getSafeInternalCallback(
    typeof value === 'string' ? value : undefined,
    fallback
  );
  const url = new URL(safeValue, 'https://algocoach.invalid');

  if (!AUTH_ERROR_PATH.test(url.pathname)) return fallback;

  const callbackUrl = getSafeInternalCallback(
    url.searchParams.get('callbackUrl') || undefined,
    '/learn'
  );
  const query = new URLSearchParams({ callbackUrl });
  return `${url.pathname}?${query.toString()}`;
}
