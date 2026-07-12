import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { oneTap } from 'better-auth/plugins';
import { getLocale } from 'next-intl/server';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import * as schema from '@/config/db/schema';
import { ResetPasswordEmail } from '@/shared/blocks/email/reset-password';
import { VerifyEmail } from '@/shared/blocks/email/verify-email';
import {
  getCookieFromCtx,
  getHeaderValue,
  guessLocaleFromAcceptLanguage,
} from '@/shared/lib/cookie';
import { getUuid } from '@/shared/lib/hash';
import { getClientIp } from '@/shared/lib/ip';
import { grantCreditsForNewUser } from '@/shared/models/credit';
import { getEmailService } from '@/shared/services/email';
import { grantRoleForNewUser } from '@/shared/services/rbac';

// Best-effort dedupe to prevent sending verification emails too frequently.
// This is especially helpful in dev/hot reload, transient network conditions,
// and to add a server-side throttle beyond any client-side cooldown.
const recentVerificationEmailSentAt = new Map<string, number>();
const VERIFICATION_EMAIL_MIN_INTERVAL_MS = 60_000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function getEmailLocale(user: any, request?: Request): 'zh' | 'en' {
  const userLocale = String(user?.locale || '').toLowerCase();
  const acceptedLocale = String(
    request?.headers.get('accept-language') || ''
  ).toLowerCase();
  return userLocale.startsWith('zh') || acceptedLocale.startsWith('zh')
    ? 'zh'
    : 'en';
}

function getBrandLogoUrl() {
  if (!envConfigs.app_logo) return undefined;
  if (envConfigs.app_logo.startsWith('http')) return envConfigs.app_logo;

  try {
    return new URL(envConfigs.app_logo, envConfigs.app_url).toString();
  } catch {
    return undefined;
  }
}

function assertEmailSent(
  result: { success: boolean; error?: string },
  purpose: 'verification' | 'password reset'
) {
  if (!result.success) {
    throw new Error(
      `${purpose} email delivery failed${result.error ? `: ${result.error}` : ''}`
    );
  }
}

// Static auth options - NO database connection
// This ensures zero database calls during build time
const authOptions = {
  appName: envConfigs.app_name,
  baseURL: envConfigs.auth_url,
  secret: envConfigs.auth_secret,
  trustedOrigins: envConfigs.app_url ? [envConfigs.app_url] : [],
  user: {
    // Allow persisting custom columns on user table.
    // Without this, better-auth may ignore extra properties during create/update.
    additionalFields: {
      utmSource: {
        type: 'string',
        // Not user-editable input; we set it internally.
        input: false,
        required: false,
        defaultValue: '',
      },
      ip: {
        type: 'string',
        input: false,
        required: false,
        defaultValue: '',
      },
      locale: {
        type: 'string',
        input: false,
        required: false,
        defaultValue: '',
      },
    },
  },
  advanced: {
    database: {
      generateId: () => getUuid(),
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
  },
  logger: {
    verboseLogging: false,
    // Disable all logs during build and production
    disabled: true,
  },
};

// get auth options with configs
export async function getAuthOptions(configs: Record<string, string>) {
  const emailAuthEnabled = configs.email_auth_enabled !== 'false';
  const resendConfigured = Boolean(
    configs.resend_api_key?.trim() && configs.resend_sender_email?.trim()
  );
  const emailVerificationEnabled =
    emailAuthEnabled &&
    configs.email_verification_enabled === 'true' &&
    resendConfigured;
  const passwordResetEnabled = emailAuthEnabled && resendConfigured;

  return {
    ...authOptions,
    // Add database connection only when actually needed (runtime)
    database: envConfigs.database_url
      ? drizzleAdapter(db(), {
          provider: getDatabaseProvider(envConfigs.database_provider),
          schema: schema,
        })
      : null,
    databaseHooks: {
      user: {
        create: {
          before: async (user: any, ctx: any) => {
            try {
              const ip = await getClientIp();
              if (ip) {
                user.ip = ip;
              }

              // Prefer NEXT_LOCALE cookie (next-intl). Fallback to accept-language.
              const localeFromCookie = getCookieFromCtx(ctx, 'NEXT_LOCALE');

              const localeFromHeader = guessLocaleFromAcceptLanguage(
                getHeaderValue(ctx, 'accept-language')
              );

              const locale =
                (localeFromCookie || localeFromHeader || (await getLocale())) ??
                '';

              if (locale && typeof locale === 'string') {
                user.locale = locale.slice(0, 20);
              }

              // Only set on first creation; never overwrite later.
              if (user?.utmSource) return user;

              const raw = getCookieFromCtx(ctx, 'utm_source');
              if (!raw || typeof raw !== 'string') return user;

              // Keep it small & safe.
              const decoded = decodeURIComponent(raw).trim();
              const sanitized = decoded
                .replace(/[^\w\-.:]/g, '') // allow a-zA-Z0-9_ - . :
                .slice(0, 100);

              if (sanitized) {
                user.utmSource = sanitized;
              }
            } catch {
              // best-effort only
            }
            return user;
          },
          after: async (user: any) => {
            try {
              if (!user.id) {
                throw new Error('user id is required');
              }

              // grant credits for new user
              await grantCreditsForNewUser(user);

              // grant role for new user
              await grantRoleForNewUser(user);
            } catch (e) {
              console.log('grant credits or role for new user failed', e);
            }
          },
        },
      },
    },
    emailAndPassword: {
      enabled: emailAuthEnabled,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      requireEmailVerification: emailVerificationEnabled,
      // Avoid creating a session immediately after sign up when verification is required.
      autoSignIn: emailVerificationEnabled ? false : true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      ...(passwordResetEnabled
        ? {
            sendResetPassword: async (
              { user, url }: { user: any; url: string; token: string },
              request?: Request
            ) => {
              const locale = getEmailLocale(user, request);
              const emailService = await getEmailService(configs as any);
              const result = await emailService.sendEmail({
                to: user.email,
                subject:
                  locale === 'zh'
                    ? `重置你的 ${envConfigs.app_name} 密码`
                    : `Reset your ${envConfigs.app_name} password`,
                react: ResetPasswordEmail({
                  appName: envConfigs.app_name,
                  logoUrl: getBrandLogoUrl(),
                  url,
                  locale,
                }),
              });

              assertEmailSent(result, 'password reset');
            },
          }
        : {}),
    },
    ...(emailVerificationEnabled
      ? {
          emailVerification: {
            // We explicitly send verification emails from the UI with a callbackURL
            // (redirecting to /verify-email). Disabling automatic sends avoids duplicates.
            sendOnSignUp: false,
            sendOnSignIn: false,
            // After user clicks the verification link, create session automatically.
            autoSignInAfterVerification: true,
            // 24 hours
            expiresIn: 60 * 60 * 24,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: any;
              url: string;
              token: string;
            }) => {
              try {
                const key = String(user?.email || '').toLowerCase();
                const now = Date.now();
                const last = recentVerificationEmailSentAt.get(key) || 0;
                if (key && now - last < VERIFICATION_EMAIL_MIN_INTERVAL_MS) {
                  return;
                }
                const emailService = await getEmailService(configs as any);
                const result = await emailService.sendEmail({
                  to: user.email,
                  subject: `Verify your email - ${envConfigs.app_name}`,
                  react: VerifyEmail({
                    appName: envConfigs.app_name,
                    logoUrl: getBrandLogoUrl(),
                    url,
                  }),
                });

                assertEmailSent(result, 'verification');
                if (key) {
                  recentVerificationEmailSentAt.set(key, now);
                }
              } catch (e) {
                console.log('send verification email failed:', e);
                throw e;
              }
            },
          },
        }
      : {}),
    socialProviders: await getSocialProviders(configs),
    plugins:
      configs.google_auth_enabled === 'true' &&
      configs.google_client_id &&
      configs.google_one_tap_enabled === 'true'
        ? [oneTap()]
        : [],
  };
}

// get social providers with configs
export async function getSocialProviders(configs: Record<string, string>) {
  const providers: any = {};

  // google auth
  if (
    configs.google_auth_enabled === 'true' &&
    configs.google_client_id &&
    configs.google_client_secret
  ) {
    providers.google = {
      clientId: configs.google_client_id,
      clientSecret: configs.google_client_secret,
    };
  }

  // github auth
  if (
    configs.github_auth_enabled === 'true' &&
    configs.github_client_id &&
    configs.github_client_secret
  ) {
    providers.github = {
      clientId: configs.github_client_id,
      clientSecret: configs.github_client_secret,
    };
  }

  return providers;
}

// convert database provider to better-auth database provider
export function getDatabaseProvider(
  provider: string
): 'sqlite' | 'pg' | 'mysql' {
  switch (provider) {
    case 'sqlite':
      return 'sqlite';
    case 'turso':
      return 'sqlite';
    case 'postgresql':
      return 'pg';
    case 'mysql':
      return 'mysql';
    default:
      throw new Error(
        `Unsupported database provider for auth: ${envConfigs.database_provider}`
      );
  }
}
