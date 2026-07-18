import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 3100);
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: isCI ? 1 : 2,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: /a11y\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      testIgnore: [/a11y\.spec\.ts/, /catalog-admin\.spec\.ts/],
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'desktop-chromium-a11y',
      testMatch: /a11y\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-webkit-a11y',
      testMatch: /a11y\.spec\.ts/,
      use: {
        ...devices['iPhone SE'],
        browserName: 'webkit',
        viewport: { width: 375, height: 667 },
      },
    },
    {
      name: 'mobile-webkit-core',
      testMatch: /coach\.spec\.ts/,
      grep: /mobile practice tabs and assessment remain usable/,
      use: {
        ...devices['iPhone SE'],
        browserName: 'webkit',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: `tsx scripts/start-e2e-server.ts --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
