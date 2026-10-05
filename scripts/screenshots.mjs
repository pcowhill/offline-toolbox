#!/usr/bin/env node
// Regenerates the README screenshots in docs/screenshots/ from the built site (npm run build first).
//   node scripts/screenshots.mjs [outputDir]
import path from 'node:path';
import { chromium } from '@playwright/test';
import { startServer } from './serve.mjs';
import { startMockApi } from '../tests/e2e/support/mock-api.mjs';
import { repoRoot } from './lib/registry.mjs';

const out = path.resolve(process.argv[2] ?? path.join(repoRoot, 'docs/screenshots'));
const fixtures = path.join(repoRoot, 'tests/fixtures');
const server = await startServer({ root: path.join(repoRoot, 'dist'), port: 4181 });
const api = await startMockApi(4010);
const browser = await chromium.launch();

async function shoot(name, { theme = 'light', width = 1280, height = 800 } = {}, run) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await run(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await context.close();
  console.log(`  ${name}.png`);
}

const base = 'http://127.0.0.1:4181/';
async function openPdf(page, files) {
  await page.goto(`${base}pdf-toolbox/`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('welcome-open').click()]);
  await chooser.setFiles(files.map((f) => path.join(fixtures, 'pdf', f)));
  await page.getByTestId('page-card').first().locator('img').waitFor();
  await page.locator('[data-testid=toast] button').first().click().catch(() => undefined);
}

await shoot('portal', {}, (page) => page.goto(base));
await shoot('portal-dark', { theme: 'dark' }, (page) => page.goto(base));

await shoot('api-workbench', {}, async (page) => {
  await page.goto(`${base}api-workbench/`);
  await page.getByTestId('url-input').fill('http://127.0.0.1:4010/api/books?author=Austen');
  await page.getByTestId('tab-headers').click();
  await page.getByTestId('headers-editor-new-key').fill('Accept');
  await page.getByTestId('headers-editor').getByLabel('Header value', { exact: true }).last().fill('application/json');
  await page.getByTestId('send-button').click();
  await page.getByTestId('response-status').waitFor();
  await page.getByTestId('view-tree').click();
});

await shoot('api-workbench-openapi-dark', { theme: 'dark' }, async (page) => {
  await page.goto(`${base}api-workbench/`);
  await page.getByTestId('sidebar-specs').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-spec').click()]);
  await chooser.setFiles(path.join(fixtures, 'openapi/library-api.yaml'));
  await page.getByTestId('operation-row').filter({ hasText: 'Add a book' }).click();
  await page.locator('[data-testid=toast] button').first().click().catch(() => undefined);
});

await shoot('pdf-organize', {}, async (page) => {
  await openPdf(page, ['three-pages.pdf', 'form.pdf', 'second.pdf']);
  await page.getByTestId('page-card').nth(1).click();
  await page.getByTestId('page-card').nth(2).click({ modifiers: ['Control'] });
});

await shoot('pdf-edit', {}, async (page) => {
  await openPdf(page, ['three-pages.pdf']);
  await page.getByTestId('page-card').first().dblclick();
  const layer = page.getByTestId('annotation-layer');
  await page.getByTestId('tool-highlight').click();
  let box = await layer.boundingBox();
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.2, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.32);
  await page.keyboard.type('Checked and approved — see notes.');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-stamp').click();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.42);
  await page.getByTestId('tool-arrow').click();
  box = await layer.boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.44, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('tool-select').click();
});

await shoot('pdf-form-dark', { theme: 'dark' }, async (page) => {
  await openPdf(page, ['form.pdf']);
  await page.getByTestId('page-card').first().dblclick();
  const layer = page.getByTestId('form-layer');
  await layer.locator('[data-field="fullName"]').fill('Ada Lovelace');
  await layer.getByRole('checkbox').check();
  await page.getByTestId('panel-form').click();
});

await shoot('mobile-api-workbench', { width: 390, height: 800 }, (page) => page.goto(`${base}api-workbench/`));

await browser.close();
server.close();
api.close();
