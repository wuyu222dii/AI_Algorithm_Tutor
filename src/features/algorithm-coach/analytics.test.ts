import { beforeEach, describe, expect, it } from 'vitest';

import {
  loadProductAnalytics,
  setProductAnalyticsScope,
  trackProductEvent,
} from './analytics';

describe('product analytics persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setProductAnalyticsScope('guest');
  });

  it('restores visitor events so learning-state sync can claim them', () => {
    const event = trackProductEvent('visitor_started', {
      properties: { source: 'about_welcome' },
    });

    expect(loadProductAnalytics('guest')).toContainEqual(event);
  });
});
