import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { chooseFiles, downloadFrom, expect, fixture, test } from './fixtures';

const API = 'http://127.0.0.1:4010';

async function open(page: Page) {
  await page.goto('api-workbench/');
  await expect(page.getByTestId('url-input')).toBeVisible();
}

async function send(page: Page) {
  await page.getByTestId('send-button').click();
}

/** Text of the CodeMirror response body. */
async function responseBody(page: Page) {
  return (await page.getByTestId('response-body').locator('.cm-content').innerText()).replace(
    /\u00a0/g,
    ' ',
  );
}

async function createEnvironment(page: Page, name: string, vars: Array<[string, string]>) {
  await page.getByTestId('manage-envs').click();
  const dialog = page.getByTestId('env-dialog');
  await dialog.getByTestId('env-new').click();
  await dialog.getByTestId('env-name').fill(name);
  for (const [key, value] of vars) {
    await dialog.getByTestId('env-add-var').click();
    await dialog.getByTestId('env-var-key').last().fill(key);
    await dialog.getByTestId('env-var-value').last().fill(value);
  }
  await dialog.getByTestId('env-activate').click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe('API Workbench', () => {
  test('GET with params and headers: status, timing, headers, formatted body', async ({ page }) => {
    await open(page);
    await page.getByTestId('url-input').fill(`${API}/api/books`);
    // Query parameter via the table: the URL bar updates.
    // Typed key by key (like a user) into the blank row: focus moves into the new row.
    await page.getByTestId('params-editor-new-key').pressSequentially('author');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Austen');
    await expect(page.getByTestId('url-input')).toHaveValue(`${API}/api/books?author=Austen`);
    // Header
    await page.getByTestId('tab-headers').click();
    await page.getByTestId('headers-editor-new-key').pressSequentially('X-Request-Id');
    await page
      .getByTestId('headers-editor')
      .getByLabel('Header value', { exact: true })
      .last()
      .fill('trace-123');
    await send(page);

    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    await expect(page.getByTestId('response-time')).toHaveText(/\d+ ms|\d+\.\d+ s/);
    await expect(page.getByTestId('response-size')).toHaveText(/\d+(\.\d)? (B|KB)/);
    // Pretty JSON keeps 64-bit integers exactly.
    const body = await responseBody(page);
    expect(body).toContain('"isbn": 9007199254740993');
    expect(body).toContain('"title": "Emma"');
    // Raw view, tree view with search, headers tab.
    await page.getByTestId('view-raw').click();
    expect(await responseBody(page)).toContain('[{"id":1,"title":"Emma"');
    await page.getByTestId('view-tree').click();
    await page.getByTestId('tree-search').fill('Persuasion');
    await expect(page.getByTestId('json-tree').locator('mark')).toHaveText('Persuasion');
    await page.getByTestId('response-tab-headers').click();
    await expect(page.getByTestId('response-headers')).toContainText('x-request-echo');
    await expect(page.getByTestId('response-headers')).toContainText('trace-123');
    await page.getByTestId('response-tab-request').click();
    await expect(page.getByTestId('sent-headers')).toContainText('X-Request-Id');

    // Copy & save response
    const { bytes, name } = await downloadFrom(page, () =>
      page.getByTestId('response-download').click(),
    );
    expect(name).toBe('books.json');
    expect(new TextDecoder().decode(bytes)).toContain('Persuasion');

    // History records it.
    await page.getByTestId('sidebar-history').click();
    await expect(page.getByTestId('history-item').first()).toContainText(
      '/api/books?author=Austen',
    );
    await expect(page.getByTestId('history-item').first()).toContainText('200');
  });

  test('POST JSON with formatting, validation and auth', async ({ page }) => {
    await open(page);
    await page.getByTestId('method-select').selectOption('POST');
    await page.getByTestId('url-input').fill(`${API}/api/echo`);
    await page.getByTestId('tab-body').click();
    await page.getByLabel('JSON').check();
    const editor = page.getByTestId('json-body-editor').locator('.cm-content');
    await editor.click();
    await page.keyboard.insertText('{"name":"Ada","tags":[1,2]}');
    await expect(page.getByTestId('json-status')).toHaveText('Valid JSON');
    await page.getByTestId('json-format').click();
    await expect(editor).toContainText('"name": "Ada"');
    await page.getByTestId('tab-auth').click();
    await page.getByLabel('Type').selectOption('bearer');
    await page.getByTestId('auth-token').fill('secret-token');
    await send(page);
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    const body = await responseBody(page);
    expect(body).toContain('"method": "POST"');
    expect(body).toContain('"authorization": "Bearer secret-token"');
    expect(body).toContain('"content-type": "application/json"');
    expect(body).toContain('\\"name\\": \\"Ada\\"');

    // Invalid JSON is reported with a position.
    await page.getByTestId('tab-body').click();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('{"a": }');
    await expect(page.getByTestId('json-status')).toContainText('line 1');
  });

  test('explains CORS failures clearly', async ({ page, network }) => {
    network.allowConsoleError(/CORS|Failed to load resource/);
    await open(page);
    await page.getByTestId('url-input').fill(`${API}/no-cors/data`);
    await send(page);
    const panel = page.getByTestId('error-panel');
    await expect(panel).toHaveAttribute('data-error-kind', 'cors-or-network');
    await expect(page.getByTestId('cors-explanation')).toContainText(
      'does not allow cross-origin browser requests',
    );
    await expect(page.getByTestId('cors-explanation')).toContainText('curl');
    await page.getByTestId('cors-help').click();
    await expect(page.getByTestId('help-dialog')).toContainText('Access-Control-Allow-Origin');
  });

  test('collections: save, rename, duplicate, export, delete, import, reopen and send', async ({
    page,
  }) => {
    await open(page);
    await page.getByTestId('url-input').fill(`${API}/api/books?author=Austen`);
    await page.keyboard.press('ControlOrMeta+s');
    const save = page.getByTestId('save-dialog');
    await save.getByTestId('save-name').fill('List Austen books');
    await save.getByTestId('save-new-collection').fill('Library');
    await save.getByTestId('save-confirm').click();
    await expect(page.getByTestId('saved-request')).toHaveText(/List Austen books/);

    // Rename and duplicate via the row menu.
    const row = page.getByTestId('saved-request').first();
    await row.hover();
    await row.getByTestId('row-menu').click();
    await page.getByTestId('menu-rename').click();
    await page.getByTestId('prompt-input').fill('Austen books');
    await page.getByTestId('prompt-confirm').click();
    await expect(page.getByTestId('saved-request').first()).toContainText('Austen books');
    await page.getByTestId('saved-request').first().hover();
    await page.getByTestId('saved-request').first().getByTestId('row-menu').click();
    await page.getByTestId('menu-duplicate').click();
    await expect(page.getByTestId('saved-request')).toHaveCount(2);

    // Export
    await page.getByTestId('export-collections').click();
    const exported = await downloadFrom(page, () => page.getByTestId('export-confirm').click());
    expect(exported.name).toMatch(/^api-workbench-export-\d{4}-\d{2}-\d{2}\.json$/);
    const json = JSON.parse(new TextDecoder().decode(exported.bytes));
    expect(json.format).toBe('offline-toolbox.api-workbench');
    expect(json.collections[0].name).toBe('Library');
    const exportPath = test.info().outputPath('export.json');
    fs.writeFileSync(exportPath, exported.bytes);

    // Delete the collection, then import the file again.
    await page.getByTestId('collection-row').hover();
    await page.getByTestId('collection-row').getByTestId('row-menu').click();
    await page.getByTestId('menu-delete').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('collections-empty')).toBeVisible();
    await chooseFiles(page, () => page.getByTestId('import-collections').click(), [exportPath]);
    await expect(page.getByTestId('saved-request')).toHaveCount(2);

    // Persisted in IndexedDB across reloads.
    await page.reload();
    await expect(page.getByTestId('saved-request')).toHaveCount(2);
    await page.getByTestId('saved-request').first().click();
    await expect(page.getByTestId('url-input')).toHaveValue(`${API}/api/books?author=Austen`);
    await send(page);
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
  });

  test('environments: {{baseUrl}} substitution, switching, unresolved warnings', async ({
    page,
  }) => {
    await open(page);
    await page.getByTestId('url-input').fill('{{baseUrl}}/api/echo?env={{envName}}');
    await expect(page.getByTestId('request-warnings')).toContainText(
      'Unresolved variables: {{baseUrl}}, {{envName}}',
    );

    await createEnvironment(page, 'Local', [
      ['baseUrl', API],
      ['envName', 'local'],
    ]);
    await expect(page.getByTestId('request-warnings')).toBeHidden();
    await expect(page.getByTestId('url-preview')).toHaveText(`${API}/api/echo?env=local`);
    await send(page);
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    expect(await responseBody(page)).toContain('"env": "local"');

    await createEnvironment(page, 'Testing', [
      ['baseUrl', API],
      ['envName', 'testing'],
    ]);
    await expect(page.getByTestId('url-preview')).toHaveText(`${API}/api/echo?env=testing`);
    await page.getByTestId('env-select').selectOption({ label: 'Local' });
    await expect(page.getByTestId('url-preview')).toHaveText(`${API}/api/echo?env=local`);
  });

  test('sensitive variables are kept in memory only unless saved explicitly', async ({ page }) => {
    await open(page);
    await createEnvironment(page, 'Secrets', [
      ['apiToken', 'super-secret'],
      ['baseUrl', API],
    ]);
    // The token variable defaulted to "secret" and "not saved".
    await page.getByTestId('manage-envs').click();
    const dialog = page.getByTestId('env-dialog');
    await expect(dialog.getByTestId('env-var-persist').first()).not.toBeChecked();
    await expect(dialog.getByTestId('env-var-value').first()).toHaveAttribute('type', 'password');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.getByTestId('manage-envs').click();
    await expect(page.getByTestId('env-var-value').first()).toHaveValue('');
    await expect(page.getByTestId('env-var-value').nth(1)).toHaveValue(API);
  });

  test('imports an OpenAPI spec and turns an operation into a request', async ({ page }) => {
    await open(page);
    await page.getByTestId('sidebar-specs').click();
    await chooseFiles(page, () => page.getByTestId('import-spec').click(), [
      fixture('openapi', 'library-api.yaml'),
    ]);
    const spec = page.getByTestId('spec');
    await expect(spec).toContainText('Library API');
    await expect(spec).toContainText('1.2.0');
    await expect(page.getByTestId('operation-row')).toHaveCount(6);
    await page.getByTestId('operation-row').filter({ hasText: 'List books' }).click();
    const view = page.getByTestId('operation-view');
    await expect(view).toContainText('/books');
    await expect(view.getByTestId('operation-parameters')).toContainText('author');
    await expect(view).toContainText('Responses');
    await view.getByTestId('apply-base-url').click();
    await view.getByTestId('create-request').click();
    await expect(page.getByTestId('url-input')).toHaveValue('{{baseUrl}}/books');
    await expect(page.getByTestId('url-preview')).toHaveText(`${API}/api/books`);
    // Enable the optional "author" parameter generated from the spec, then send.
    await page.getByTestId('params-editor').getByLabel('Enable author').check();
    await expect(page.getByTestId('url-input')).toHaveValue('{{baseUrl}}/books?author=Austen');
    // The spec requires bearer auth; the generated request references {{token}}.
    await expect(page.getByTestId('request-warnings')).toContainText('{{token}}');
    await send(page);
    await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    expect(await responseBody(page)).toContain('Persuasion');

    // Request body generation from a schema.
    await page.getByTestId('operation-row').filter({ hasText: 'Add a book' }).click();
    await page.getByTestId('operation-view').getByTestId('create-request').click();
    await page.getByTestId('tab-body').click();
    await expect(page.getByTestId('json-body-editor')).toContainText('"title": "Emma"');
  });

  test('history: reopen, delete one, clear all', async ({ page }) => {
    await open(page);
    for (const path of ['/api/echo?n=1', '/api/echo?n=2']) {
      await page.getByTestId('url-input').fill(`${API}${path}`);
      await send(page);
      await expect(page.getByTestId('response-status')).toHaveText('200 OK');
    }
    await page.getByTestId('sidebar-history').click();
    await expect(page.getByTestId('history-item')).toHaveCount(2);
    await page.getByTestId('history-item').last().getByRole('button').first().click();
    await expect(page.getByTestId('url-input')).toHaveValue(`${API}/api/echo?n=1`);
    await page.getByTestId('history-item').first().hover();
    await page.getByTestId('history-item').first().getByLabel('Delete history entry').click();
    await expect(page.getByTestId('history-item')).toHaveCount(1);
    await page.getByTestId('clear-history').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
  });

  test('curl import and other response types (image, HTML preview is sandboxed)', async ({
    page,
    network,
  }) => {
    // The sandbox and CSP *must* block the response's script and external image; those blocks are logged.
    network.allowConsoleError(
      /Blocked script execution in 'about:srcdoc'|Refused to load the image 'https:\/\/example\.invalid/,
    );
    await open(page);
    await page.getByTestId('request-more').click();
    await page.getByTestId('import-curl').click();
    await page
      .getByTestId('curl-input')
      .fill(`curl -X PUT '${API}/api/echo?x=1' -H 'X-Test: yes' -d 'name=a+b&id=7'`);
    await page.getByTestId('curl-import-confirm').click();
    await expect(page.getByTestId('method-select')).toHaveValue('PUT');
    await send(page);
    const body = await responseBody(page);
    expect(body).toContain('"x-test": "yes"');
    expect(body).toContain('name=a+b&id=7');

    await page.getByTestId('method-select').selectOption('GET');
    await page.getByTestId('url-input').fill(`${API}/api/image.png`);
    await send(page);
    await expect(page.getByTestId('response-image')).toBeVisible();

    await page.getByTestId('url-input').fill(`${API}/api/page.html`);
    await send(page);
    await page.getByTestId('view-preview').click();
    const frame = page.frameLocator('iframe[title="HTML preview"]');
    await expect(frame.locator('h1')).toHaveText('Hello from HTML');
    // Scripts did not run: the page title was not changed by the response's script.
    expect(await page.title()).toBe('API Workbench — Offline Toolbox');
  });

  test('cancel a slow request', async ({ page }) => {
    await open(page);
    await page.getByTestId('url-input').fill(`${API}/api/slow`);
    await send(page);
    await expect(page.getByTestId('response-loading')).toBeVisible();
    await page.getByTestId('cancel-button').click();
    await expect(page.getByTestId('error-panel')).toContainText('cancelled');
  });
});
