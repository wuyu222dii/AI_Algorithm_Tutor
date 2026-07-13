import type { BetterAuthOptions } from 'better-auth';

/**
 * OAuth accounts may only merge through a provider-verified email match.
 * Keeping trustedProviders empty is intentional: listing Google there would
 * bypass Better Auth's emailVerified check.
 */
export const AUTH_ACCOUNT_SECURITY = {
  updateAccountOnSignIn: true,
  encryptOAuthTokens: true,
  accountLinking: {
    enabled: true,
    trustedProviders: [],
    allowDifferentEmails: false,
    allowUnlinkingAll: false,
    updateUserInfoOnLink: false,
  },
} satisfies NonNullable<BetterAuthOptions['account']>;
