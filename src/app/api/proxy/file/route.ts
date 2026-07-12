import { NextRequest, NextResponse } from 'next/server';

import {
  legacyFeatureDisabledResponse,
  legacyFeaturesEnabled,
} from '@/shared/lib/legacy-features';

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.FILE_PROXY_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function GET(req: NextRequest) {
  if (!legacyFeaturesEnabled()) {
    return legacyFeatureDisabledResponse();
  }

  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  try {
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      !allowedHosts().has(target.hostname.toLowerCase())
    ) {
      return new NextResponse('Proxy target is not allowed', { status: 403 });
    }

    const response = await fetch(target, { redirect: 'error' });

    if (!response.ok) {
      return new NextResponse(`Failed to fetch file: ${response.statusText}`, {
        status: response.status,
      });
    }

    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
