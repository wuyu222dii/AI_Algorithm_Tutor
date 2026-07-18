import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  flushAnonymousProductEventOutbox,
  loadProductAnalytics,
  setProductAnalyticsScope,
  trackProductEvent,
} from './analytics';

describe('product analytics persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    setProductAnalyticsScope('guest');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restores visitor events so learning-state sync can claim them', async () => {
    const event = trackProductEvent('visitor_started', {
      properties: { source: 'about_welcome' },
    });

    expect(loadProductAnalytics('guest')).toContainEqual(event);
    await vi.advanceTimersByTimeAsync(250);
  });

  it('batches a strict anonymous payload and removes it after ACK', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    trackProductEvent('visitor_started', {
      properties: { source: 'about', code: 'must-not-leave-browser' },
    });
    trackProductEvent('first_code_run', {
      problemSlug: 'two-value-target',
      properties: { code: 'return privateSolution' },
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      events: Array<Record<string, unknown>>;
    };
    expect(payload.events).toHaveLength(2);
    expect(payload.events[1]).toMatchObject({
      name: 'first_code_run',
      problemSlug: 'two-value-target',
    });
    expect(JSON.stringify(payload)).not.toContain('privateSolution');
    expect(JSON.stringify(payload)).not.toContain('must-not-leave-browser');
  });

  it('drops expired or malformed outbox entries before sending newer events', async () => {
    const now = new Date('2026-07-18T00:00:00.000Z');
    vi.setSystemTime(now);
    window.localStorage.setItem(
      'algocoach:anonymous-event-outbox:v1',
      JSON.stringify([
        {
          id: 'event_expired_123',
          name: 'code_run',
          timestamp: new Date(
            now.getTime() - 25 * 60 * 60 * 1000
          ).toISOString(),
        },
        {
          id: 'bad',
          name: 'not_allowed',
          timestamp: now.toISOString(),
        },
      ])
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    trackProductEvent('visitor_started');
    await vi.advanceTimersByTimeAsync(250);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      events: Array<{ name: string }>;
    };
    expect(payload.events).toEqual([
      expect.objectContaining({ name: 'visitor_started' }),
    ]);
  });

  it('drains more than one server-sized batch with monotonic checkpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    for (let index = 0; index < 51; index += 1) {
      trackProductEvent('code_run', { problemSlug: 'two-value-target' });
    }

    await expect(
      flushAnonymousProductEventOutbox({ drain: true })
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    ) as { events: unknown[]; checkpoint: Record<string, number> };
    const second = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)
    ) as { events: unknown[]; checkpoint: Record<string, number> };
    expect(first.events).toHaveLength(50);
    expect(first.checkpoint).toEqual({
      sequence: 1,
      generatedTotal: 51,
      deliveredTotal: 50,
    });
    expect(second.events).toHaveLength(1);
    expect(second.checkpoint).toEqual({
      sequence: 2,
      generatedTotal: 51,
      deliveredTotal: 51,
    });
  });

  it('keeps an unacknowledged batch durable for a later retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    for (let index = 0; index < 51; index += 1) {
      trackProductEvent('code_run', { problemSlug: 'two-value-target' });
    }

    await expect(
      flushAnonymousProductEventOutbox({ drain: true })
    ).resolves.toBe(false);
    expect(
      JSON.parse(
        window.localStorage.getItem('algocoach:anonymous-event-outbox:v1') ??
          '[]'
      )
    ).toHaveLength(1);

    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await expect(
      flushAnonymousProductEventOutbox({ drain: true })
    ).resolves.toBe(true);
    expect(
      window.localStorage.getItem('algocoach:anonymous-event-outbox:v1')
    ).toBeNull();
  });
});
