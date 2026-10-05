import { expect, test } from './fixtures';

// The fixture already aborts and fails on any non-local request. These tests additionally
// assert what each page loads and that a Content-Security-Policy is in force.
for (const path of ['./', 'api-workbench/', 'pdf-toolbox/']) {
  test(`${path} loads only same-origin resources and enforces a CSP`, async ({
    page,
    baseURL,
    network,
  }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const origin = new URL(baseURL!).origin;
    const loaded = network.requests.filter((u) => u.startsWith('http'));
    expect(loaded.length).toBeGreaterThan(0);
    for (const url of loaded) expect(new URL(url).origin, url).toBe(origin);
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toContain("default-src 'self'");
    // A deliberate attempt to load an external script is blocked by the policy.
    const blocked = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener(
            'securitypolicyviolation',
            (e) => resolve(e.violatedDirective),
            { once: true },
          );
          const s = document.createElement('script');
          s.src = 'https://cdn.example.invalid/x.js';
          document.head.appendChild(s);
          setTimeout(() => resolve('not blocked'), 2000);
        }),
    );
    expect(blocked).toMatch(/script-src/);
    network.allowConsoleError(/Content Security Policy|cdn\.example\.invalid/);
  });
}
