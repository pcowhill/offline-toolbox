import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the *built* site in dist/, served by a plain static server —
 * the same thing a user does on an isolated network. Two hosting layouts are tested:
 *   - "subpath": the site under /offline-toolbox/ (like GitHub Pages project sites)
 *   - "root": the site at / (like `python3 -m http.server` inside dist/)
 * A local mock API (port 4010) stands in for real HTTP services.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/support/servers.mjs',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'subpath',
      use: { baseURL: 'http://127.0.0.1:4174/offline-toolbox/' },
    },
    {
      name: 'root',
      use: { baseURL: 'http://127.0.0.1:4173/' },
      testMatch: /(portal|offline)\.spec\.ts/,
    },
  ],
});
