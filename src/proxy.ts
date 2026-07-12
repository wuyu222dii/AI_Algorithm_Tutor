import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import createIntlMiddleware from 'next-intl/middleware';

import { routing } from '@/core/i18n/config';
import { getSafeInternalCallback } from '@/shared/lib/auth-redirect';
import { legacyFeaturesEnabled } from '@/shared/lib/legacy-features';

const intlMiddleware = createIntlMiddleware(routing);
const legacyPagePrefixes = [
  '/ai-image-generator',
  '/ai-music-generator',
  '/ai-video-generator',
  '/chat',
  '/pricing',
];
const authFlowPagePrefixes = [
  '/auth',
  '/sign-in',
  '/sign-up',
  '/sign-out',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
];

function matchesPagePrefix(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Handle internationalization first
  const intlResponse = intlMiddleware(request);

  // Extract locale from pathname
  const locale = pathname.split('/')[1];
  const isValidLocale = routing.locales.includes(locale as any);
  const pathWithoutLocale = isValidLocale
    ? pathname.slice(locale.length + 1)
    : pathname;

  if (
    !legacyFeaturesEnabled() &&
    legacyPagePrefixes.some(
      (prefix) =>
        pathWithoutLocale === prefix ||
        pathWithoutLocale.startsWith(`${prefix}/`)
    )
  ) {
    const learnUrl = new URL(
      isValidLocale ? `/${locale}/learn` : '/learn',
      request.url
    );
    return NextResponse.redirect(learnUrl);
  }

  // Only check authentication for admin routes
  if (
    pathWithoutLocale.startsWith('/admin') ||
    pathWithoutLocale.startsWith('/settings') ||
    pathWithoutLocale.startsWith('/activity')
  ) {
    // Check if session cookie exists
    const sessionCookie = getSessionCookie(request);

    // If no session token found, redirect to sign-in
    if (!sessionCookie) {
      const signInUrl = new URL(
        isValidLocale ? `/${locale}/sign-in` : '/sign-in',
        request.url
      );
      // Add the current path (including search params) as callback - use relative path for multi-language support
      const callbackPath = getSafeInternalCallback(
        pathWithoutLocale + request.nextUrl.search
      );
      signInUrl.searchParams.set('callbackUrl', callbackPath);
      return NextResponse.redirect(signInUrl);
    }

    // For admin routes, we need to check RBAC permissions
    // Note: Full permission check happens in the page/API route level
    // This is a lightweight session check to prevent unauthorized access
    // The detailed permission check (admin.access and specific permissions)
    // will be done in the layout or individual pages using requirePermission()
  }

  intlResponse.headers.set('x-pathname', request.nextUrl.pathname);
  intlResponse.headers.set('x-url', request.url);

  const isAuthFlowPage = matchesPagePrefix(
    pathWithoutLocale,
    authFlowPagePrefixes
  );

  if (isAuthFlowPage) {
    intlResponse.headers.set(
      'Cache-Control',
      'private, no-store, no-cache, max-age=0, must-revalidate'
    );
    intlResponse.headers.set('CDN-Cache-Control', 'no-store');
    intlResponse.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    intlResponse.headers.set('Pragma', 'no-cache');
    intlResponse.headers.set('Expires', '0');
  }

  // Remove Set-Cookie from public pages to allow caching
  // We exclude admin, settings, activity, and auth pages from this behavior
  if (
    !pathWithoutLocale.startsWith('/admin') &&
    !pathWithoutLocale.startsWith('/settings') &&
    !pathWithoutLocale.startsWith('/activity') &&
    !pathWithoutLocale.startsWith('/sign-') &&
    !isAuthFlowPage
  ) {
    intlResponse.headers.delete('Set-Cookie');

    // Cache-Control header for public pages
    const cacheControl = 'public, s-maxage=3600, stale-while-revalidate=14400';

    intlResponse.headers.set('Cache-Control', cacheControl);
    intlResponse.headers.set('CDN-Cache-Control', cacheControl);
    intlResponse.headers.set('Cloudflare-CDN-Cache-Control', cacheControl);
  }

  // For all other routes (including /, /sign-in, /sign-up, /sign-out), just return the intl response
  return intlResponse;
}

export const config = {
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
