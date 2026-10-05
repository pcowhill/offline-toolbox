import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Download, type Page } from '@playwright/test';

export const FIXTURES = path.resolve(import.meta.dirname, '../fixtures');
export const fixture = (...parts: string[]) => path.join(FIXTURES, ...parts);

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Every test runs "as if the Internet did not exist": requests to any non-local host are
 * aborted and recorded, and the test fails if any were attempted. Console errors (including
 * Content-Security-Policy violations) also fail the test unless explicitly expected.
 */
export const test = base.extend<{
  network: {
    external: string[];
    requests: string[];
    consoleErrors: string[];
    allowConsoleError: (re: RegExp) => void;
  };
}>({
  network: [
    async ({ context, page }, use) => {
      const external: string[] = [];
      const requests: string[] = [];
      const consoleErrors: string[] = [];
      const allowed: RegExp[] = [];
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          !LOCAL_HOSTS.has(url.hostname)
        ) {
          external.push(url.href);
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });
      page.on('request', (request) => requests.push(request.url()));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(`Uncaught: ${error.message}`));
      await use({ external, requests, consoleErrors, allowConsoleError: (re) => allowed.push(re) });
      expect(external, 'no request may leave this computer').toEqual([]);
      const unexpected = consoleErrors.filter((text) => !allowed.some((re) => re.test(text)));
      expect(unexpected, 'unexpected console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function saveDownload(download: Download): Promise<Uint8Array> {
  const file = await download.path();
  return new Uint8Array(fs.readFileSync(file));
}

/** Clicks something that triggers a download and returns the downloaded bytes and name. */
export async function downloadFrom(
  page: Page,
  trigger: () => Promise<unknown>,
): Promise<{ bytes: Uint8Array; name: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { bytes: await saveDownload(download), name: download.suggestedFilename() };
}

export async function chooseFiles(page: Page, trigger: () => Promise<unknown>, files: string[]) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(files);
}
