import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCoachCallbackUrl,
  CoachSyncBadge,
  pageNames,
} from './coach-shell';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const mocks = vi.hoisted(() => ({
  retrySync: vi.fn(),
  useCoachStore: vi.fn(),
}));

vi.mock('../store', () => ({
  CoachProvider: ({ children }: { children: React.ReactNode }) => children,
  useCoachStore: mocks.useCoachStore,
}));

vi.mock('next-intl', () => ({ useLocale: () => 'en' }));

vi.mock('@/core/auth/client', () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

vi.mock('@/core/i18n/navigation', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  usePathname: () => '/learn',
}));

vi.mock('@/shared/blocks/dashboard', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/shared/blocks/sign/sign-user', () => ({
  SignUser: () => null,
}));

describe('CoachSyncBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['conflict', 'Data conflict'],
    ['network', 'Network offline'],
    ['auth', 'Sign-in expired'],
    ['server', 'Service unavailable'],
  ] as const)('renders the %s explanation and retries', (syncError, label) => {
    mocks.useCoachStore.mockReturnValue({
      retrySync: mocks.retrySync,
      syncError,
      syncStatus: 'error',
    });

    render(<CoachSyncBadge signedIn copy={pageNames.en} />);

    const button = screen.getByRole('button', { name: new RegExp(label) });
    expect(button).toHaveAttribute(
      'title',
      pageNames.en.syncErrors[syncError].description
    );
    expect(button.className.split(/\s+/)).not.toContain('hidden');
    expect(button.className).toContain('sm:w-auto');
    fireEvent.click(button);
    expect(mocks.retrySync).toHaveBeenCalledTimes(1);
  });

  it('provides the localized Chinese authentication explanation', () => {
    mocks.useCoachStore.mockReturnValue({
      retrySync: mocks.retrySync,
      syncError: 'auth',
      syncStatus: 'error',
    });

    render(<CoachSyncBadge signedIn copy={pageNames.zh} />);

    expect(
      screen.getByRole('button', { name: /登录状态已失效/ })
    ).toHaveAttribute('title', pageNames.zh.syncErrors.auth.description);
  });
});

describe('buildCoachCallbackUrl', () => {
  it('keeps the full versioned assessment or practice query', () => {
    expect(
      buildCoachCallbackUrl(
        '/assessment',
        new URLSearchParams('kind=checkpoint&baseline=baseline-1')
      )
    ).toBe('/assessment?kind=checkpoint&baseline=baseline-1');
    expect(
      buildCoachCallbackUrl(
        '/practice/two-sum',
        new URLSearchParams('version=3')
      )
    ).toBe('/practice/two-sum?version=3');
  });
});
