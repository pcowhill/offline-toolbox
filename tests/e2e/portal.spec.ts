import { expect, test } from './fixtures';

test.describe('Offline Toolbox portal', () => {
  test('lists every tool and launches them with relative links', async ({
    page,
    baseURL,
    network,
  }) => {
    await page.goto('./');
    await expect(page).toHaveTitle('Offline Toolbox');
    const cards = page.getByTestId('tool-grid').locator('.tool-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('API Workbench');
    await expect(cards.nth(1)).toContainText('PDF Toolbox');
    await expect(cards.locator('img.tool-card__icon').first()).toHaveJSProperty('complete', true);

    await page.getByRole('link', { name: /API Workbench/ }).click();
    await expect(page).toHaveURL(`${baseURL}api-workbench/`);
    await expect(page.getByRole('heading', { name: 'API Workbench' })).toBeVisible();
    await page.getByTestId('home-link').click();
    await expect(page).toHaveURL(baseURL!);

    await page.getByRole('link', { name: /PDF Toolbox/ }).click();
    await expect(page).toHaveURL(`${baseURL}pdf-toolbox/`);
    await expect(page.getByTestId('welcome')).toBeVisible();
    await page.getByTestId('home-link').click();
    await expect(page).toHaveURL(baseURL!);

    // Every request stayed under the site's own base path (no root-absolute asset URLs).
    const prefix = new URL(baseURL!);
    for (const url of network.requests.filter((u) => u.startsWith('http'))) {
      expect(url.startsWith(prefix.origin + prefix.pathname), url).toBe(true);
    }
  });

  test('theme preference is shared between the portal and the tools', async ({ page }) => {
    await page.goto('./');
    const html = page.locator('html');
    await page.locator('#theme-toggle').click(); // system → light
    await page.locator('#theme-toggle').click(); // light → dark
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.goto('pdf-toolbox/');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.goto('api-workbench/');
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('tool folders without a trailing slash redirect correctly', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}pdf-toolbox`);
    await expect(page).toHaveURL(`${baseURL}pdf-toolbox/`);
    await expect(page.getByTestId('welcome')).toBeVisible();
  });
});
