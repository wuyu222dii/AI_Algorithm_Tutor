import { MetadataRoute } from 'next';

import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';

const MARKETING_ROUTES = [
  '',
  '/about',
  '/for-interview-prep',
  '/for-students',
  '/how-it-works',
  '/learn',
  '/problems',
  '/assessment',
  '/review',
  '/progress',
  '/support',
  '/privacy-policy',
  '/terms-of-service',
] as const;

function localizedPath(locale: string, path: string) {
  if (path === '') {
    return locale === defaultLocale ? '/' : `/${locale}`;
  }

  return locale === defaultLocale ? path : `/${locale}${path}`;
}

function routePriority(path: string) {
  if (path === '') return 1;
  if (path === '/learn' || path === '/for-interview-prep') return 0.9;
  if (path.startsWith('/for-') || path === '/how-it-works') return 0.8;
  if (path === '/privacy-policy' || path === '/terms-of-service') return 0.3;
  return 0.7;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return MARKETING_ROUTES.flatMap((path) =>
    locales.map((locale) => ({
      url: `${envConfigs.app_url}${localizedPath(locale, path)}`,
      lastModified,
      changeFrequency:
        path === '' || path === '/learn' ? ('weekly' as const) : ('monthly' as const),
      priority: routePriority(path),
    }))
  );
}
