import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { proxy } from './proxy';

vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null),
}));

describe('application proxy routing', () => {
  it('sends an anonymous catalog administrator to sign in', async () => {
    const response = await proxy(
      new NextRequest(
        'http://localhost:3000/admin/catalog/candidates?status=quarantined'
      )
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(response.status).toBe(307);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('callbackUrl')).toBe(
      '/admin/catalog/candidates?status=quarantined'
    );
  });

  it('continues to redirect disabled ShipAny pages to the coach', async () => {
    const response = await proxy(
      new NextRequest('http://localhost:3000/ai-image-generator')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/learn'
    );
  });
});
