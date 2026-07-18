import bundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import { createMDX } from 'fumadocs-mdx/next';
import createNextIntlPlugin from 'next-intl/plugin';

const withMDX = createMDX();

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const withNextIntl = createNextIntlPlugin({
  requestConfig: './src/core/i18n/request.ts',
});

const configuredImageHosts = (process.env.NEXT_PUBLIC_IMAGE_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const imageHosts = [
  'picsum.photos',
  'lh3.googleusercontent.com',
  'avatars.githubusercontent.com',
  'models.dev',
  ...configuredImageHosts,
];

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://accounts.google.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://picsum.photos https://fastly.picsum.photos https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://models.dev",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com https://openrouter.ai https://*.sentry.io",
  "frame-src 'self' https://accounts.google.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  process.env.NODE_ENV === 'production' ? 'upgrade-insecure-requests' : '',
]
  .filter(Boolean)
  .join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['next-mdx-remote'],
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: process.env.VERCEL ? undefined : 'standalone',
  reactStrictMode: false,
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  images: {
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    qualities: [60, 70, 75],
    remotePatterns: imageHosts.map((hostname) => ({
      protocol: 'https',
      hostname,
    })),
  },
  async redirects() {
    return [];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
        ],
      },
      {
        source: '/:asset(imgs|monaco|pyodide)/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      // fs: {
      //   browser: './empty.ts', // We recommend to fix code imports before using this method
      // },
    },
  },
  experimental: {
    turbopackFileSystemCacheForDev: true,
    // Disable mdxRs for Vercel deployment compatibility with fumadocs-mdx
    ...(process.env.VERCEL ? {} : { mdxRs: true }),
  },
  reactCompiler: true,
};

export default withSentryConfig(
  withBundleAnalyzer(withNextIntl(withMDX(nextConfig))),
  {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    release: {
      name:
        process.env.SENTRY_RELEASE ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.GITHUB_SHA,
    },
    silent: !process.env.CI,
    telemetry: false,
    widenClientFileUpload: true,
    webpack: { treeshake: { removeDebugLogging: true } },
    sourcemaps: {
      disable: !process.env.SENTRY_AUTH_TOKEN,
      deleteSourcemapsAfterUpload: true,
    },
  }
);
