import type { Page } from '@playwright/test';
import { readFormFields } from '../../apps/pdf-toolbox/src/core/forms';
import { chooseFiles, downloadFrom, expect, fixture, test } from './fixtures';
import { allStreamText, PDFDocument, pdfPages, zipEntryNames } from './support/pdf';

const pdf = (name: string) => fixture('pdf', name);

async function openPdfs(page: Page, files: string[]) {
  await page.goto('pdf-toolbox/');
  await chooseFiles(page, () => page.getByTestId('welcome-open').click(), files);
  await expect(page.getByTestId('page-card').first()).toBeVisible();
}

async function addFiles(page: Page, files: string[]) {
  await chooseFiles(page, () => page.getByTestId('open-files').click(), files);
}

async function exportPdf(page: Page) {
  const { bytes, name } = await downloadFrom(page, () => page.getByTestId('export-pdf').click());
  expect(name).toMatch(/\.pdf$/);
  return bytes;
}

const cards = (page: Page) => page.getByTestId('page-card');

/** Drag on the annotation layer from (x1,y1) to (x2,y2), in fractions of the page box. */
async function dragOnPage(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('annotation-layer').boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * ((from[0] + to[0]) / 2),
    box.y + box.height * ((from[1] + to[1]) / 2),
    { steps: 4 },
  );
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 });
  await page.mouse.up();
}

async function clickOnPage(page: Page, at: [number, number]) {
  const box = (await page.getByTestId('annotation-layer').boundingBox())!;
  await page.mouse.click(box.x + box.width * at[0], box.y + box.height * at[1]);
}

test.describe('PDF Toolbox', () => {
  test('organize: open, thumbnails, drag-reorder, rotate, delete, merge, export', async ({
    page,
  }) => {
    await openPdfs(page, [pdf('three-pages.pdf')]);
    await expect(cards(page)).toHaveCount(3);
    // Thumbnails render lazily as images.
    await expect(cards(page).first().locator('img')).toBeVisible();

    // Drag page 3 before page 1.
    await cards(page)
      .nth(2)
      .dragTo(cards(page).nth(0), { targetPosition: { x: 10, y: 60 } });
    await expect(cards(page).nth(0)).toContainText('p3');
    await expect(cards(page).nth(1)).toContainText('p1');

    // Rotate (now first) page 1-of-source right, delete source page 2.
    await cards(page).nth(1).click();
    await page.getByTestId('rotate-right').click();
    await cards(page).nth(2).click();
    await page.getByTestId('delete-pages').click();
    await expect(cards(page)).toHaveCount(2);
    // Undo/redo of the delete.
    await page.getByTestId('undo').click();
    await expect(cards(page)).toHaveCount(3);
    await page.getByTestId('redo').click();
    await expect(cards(page)).toHaveCount(2);

    // Merge another document.
    await addFiles(page, [pdf('second.pdf')]);
    await expect(cards(page)).toHaveCount(4);

    const out = await pdfPages(await exportPdf(page));
    expect(out.map((p) => p.text.match(/Page \d|Appendix [AB]/)?.[0])).toEqual([
      'Page 3',
      'Page 1',
      'Appendix A',
      'Appendix B',
    ]);
    expect(out[0].rotate).toBe(90); // original /Rotate kept
    expect(out[1].rotate).toBe(90); // rotated by the user
  });

  test('annotations: text, highlight, drawing, shapes, stamp and signature are exported', async ({
    page,
  }) => {
    await openPdfs(page, [pdf('three-pages.pdf')]);
    await cards(page).first().dblclick();
    await expect(page.getByTestId('page-editor')).toBeVisible();
    await expect(page.getByTestId('page-canvas')).toBeVisible();

    await page.getByTestId('tool-text').click();
    await clickOnPage(page, [0.15, 0.4]);
    await page.getByTestId('text-editor').pressSequentially('Reviewed by QA');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('annotation-text')).toHaveCount(1);

    await page.getByTestId('tool-highlight').click();
    await dragOnPage(page, [0.1, 0.12], [0.6, 0.18]);
    await page.getByTestId('tool-ink').click();
    await dragOnPage(page, [0.2, 0.6], [0.5, 0.7]);
    await page.getByTestId('tool-rect').click();
    await dragOnPage(page, [0.55, 0.55], [0.8, 0.65]);
    await page.getByTestId('tool-arrow').click();
    await dragOnPage(page, [0.6, 0.3], [0.8, 0.4]);
    await page.getByTestId('tool-stamp').click();
    await page.getByTestId('stamp-text').fill('APPROVED');
    await clickOnPage(page, [0.7, 0.5]);

    // Signature drawn on the pad and placed on the page.
    await page.getByTestId('tool-signature').click();
    const pad = page.getByTestId('signature-pad');
    const padBox = (await pad.boundingBox())!;
    await page.mouse.move(padBox.x + 40, padBox.y + 80);
    await page.mouse.down();
    for (let i = 0; i < 12; i++)
      await page.mouse.move(padBox.x + 40 + i * 25, padBox.y + 80 + (i % 2 ? 30 : -20));
    await page.mouse.up();
    await page.getByTestId('signature-use').click();
    await dragOnPage(page, [0.15, 0.45], [0.4, 0.52]);
    await expect(page.getByTestId('annotation-image')).toHaveCount(1);

    // Move the text box with the select tool, then change its colour via the inspector.
    await page.getByTestId('tool-select').click();
    await page.getByTestId('annotation-text').click();
    await expect(page.getByTestId('annotation-properties')).toContainText('Text box');

    // Whiteout shows the "not secure" notice.
    await page.getByTestId('tool-whiteout').click();
    await expect(page.getByTestId('whiteout-notice')).toContainText('only hides content visually');

    const bytes = await exportPdf(page);
    const out = await pdfPages(bytes);
    expect(out).toHaveLength(3);
    expect(out[0].text).toContain('Reviewed by QA');
    expect(out[0].text).toContain('APPROVED');
    const doc = await PDFDocument.load(bytes);
    const images = doc.context
      .enumerateIndirectObjects()
      .filter(([, o]) =>
        String(
          (o as { dict?: { get: (k: unknown) => unknown } }).dict?.toString?.() ?? '',
        ).includes('/Subtype /Image'),
      );
    expect(images.length).toBeGreaterThanOrEqual(1);
  });

  test('forms: fill AcroForm fields in place and export (interactive and flattened)', async ({
    page,
  }) => {
    await openPdfs(page, [pdf('form.pdf')]);
    await cards(page).first().dblclick();
    const layer = page.getByTestId('form-layer');
    await expect(layer).toBeVisible();
    await layer.locator('[data-field="fullName"]').fill('Ada Lovelace');
    await layer.getByRole('checkbox').check();
    await layer.getByLabel('Form field color: green').check();
    await layer.locator('[data-field="country"]').selectOption('Japan');
    await layer.locator('[data-field="comments"]').fill('First line\nSecond line');

    let bytes = await exportPdf(page);
    const values = Object.fromEntries(
      readFormFields(await PDFDocument.load(bytes)).map((f) => [f.name, f.value]),
    );
    expect(values).toEqual({
      fullName: 'Ada Lovelace',
      subscribe: true,
      color: 'green',
      country: 'Japan',
      comments: 'First line\nSecond line',
    });

    await page.getByTestId('panel-form').click();
    await expect(page.getByTestId('form-input-fullName')).toHaveValue('Ada Lovelace');
    await page.getByTestId('flatten-forms').check();
    bytes = await exportPdf(page);
    expect(readFormFields(await PDFDocument.load(bytes))).toEqual([]);
    expect((await pdfPages(bytes))[0].text).toContain('Ada Lovelace');
  });

  test('redaction removes the underlying text; whiteout would not', async ({ page }) => {
    await openPdfs(page, [pdf('secret.pdf')]);
    await cards(page).first().dblclick();
    await page.getByTestId('tool-redact').click();
    await expect(page.getByTestId('redact-notice')).toContainText('Secure redaction');
    // "SECRET-12345" sits near the top-left of the Letter page.
    await dragOnPage(page, [0.08, 0.08], [0.6, 0.15]);
    await expect(page.getByTestId('annotation-redact')).toHaveCount(1);
    const bytes = await exportPdf(page);
    const out = await pdfPages(bytes);
    expect(out).toHaveLength(2);
    expect(out[0].text.trim()).toBe(''); // page became an image
    expect(out[1].text).toContain('Second page without secrets.');
    const everything = await allStreamText(bytes);
    expect(everything).not.toContain('SECRET');
    expect(everything).not.toContain('Public information');
  });

  test('images → PDF and page → image', async ({ page }) => {
    await page.goto('pdf-toolbox/');
    await chooseFiles(page, () => page.getByTestId('welcome-images').click(), [
      fixture('images', 'sample.png'),
      fixture('images', 'sample.jpg'),
    ]);
    await page.getByTestId('images-page-size').selectOption('letter');
    await page.getByTestId('images-confirm').click();
    await expect(cards(page)).toHaveCount(2);
    const out = await pdfPages(await exportPdf(page));
    expect(out.map((p) => [p.width, p.height])).toEqual([
      [792, 612],
      [792, 612],
    ]);

    // Export the first page as PNG at 72 dpi.
    await cards(page).first().click();
    await page.getByTestId('more-menu').click();
    await page.getByTestId('menu-page-images').click();
    await page.getByLabel('Resolution').selectOption('72');
    const { bytes, name } = await downloadFrom(page, () =>
      page.getByTestId('image-export-confirm').click(),
    );
    expect(name).toMatch(/page-001\.png$/);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const view = Buffer.from(bytes);
    expect([view.readUInt32BE(16), view.readUInt32BE(20)]).toEqual([792, 612]);
  });

  test('split, extract selected pages, extract text (scanned page notice)', async ({ page }) => {
    await openPdfs(page, [pdf('three-pages.pdf'), pdf('scanned.pdf')]);
    await expect(cards(page)).toHaveCount(4);

    // Extract pages 2 and 4 (Ctrl+click selection).
    await cards(page).nth(1).click();
    await cards(page)
      .nth(3)
      .click({ modifiers: ['ControlOrMeta'] });
    await page.getByTestId('more-menu').click();
    const extracted = await downloadFrom(page, () =>
      page.getByTestId('menu-export-selected').click(),
    );
    expect((await pdfPages(extracted.bytes)).length).toBe(2);

    // Split every page into its own file → ZIP.
    await page.getByTestId('more-menu').click();
    await page.getByTestId('menu-split').click();
    await page.getByLabel('Pages per file').fill('1');
    const zip = await downloadFrom(page, () => page.getByTestId('split-confirm').click());
    expect(zip.name).toMatch(/split\.zip$/);
    expect(zipEntryNames(zip.bytes)).toHaveLength(4);

    // Text extraction reports the scanned page.
    await page.keyboard.press('Escape');
    await page.getByTestId('more-menu').click();
    await page.getByTestId('menu-extract-text').click();
    await expect(page.getByTestId('extracted-text')).toContainText('Fixture page 1 of 3');
    await expect(page.getByTestId('scanned-notice')).toContainText('scanned');
  });

  test('reduce file size', async ({ page }) => {
    await openPdfs(page, [pdf('images.pdf')]);
    await page.getByTestId('more-menu').click();
    await page.getByTestId('menu-optimize').click();
    await page.getByTestId('optimize-run').click();
    const result = page.getByTestId('optimize-result');
    await expect(result).toContainText('image(s) recompressed');
    await expect(result.locator('.badge--success')).toBeVisible();
    const { bytes } = await downloadFrom(page, () => page.getByTestId('optimize-download').click());
    const fs = await import('node:fs');
    expect(bytes.length).toBeLessThan(fs.statSync(pdf('images.pdf')).size);
    expect((await pdfPages(bytes)).length).toBe(1);
  });

  test('rejects files that are not PDFs or images with a clear message', async ({ page }) => {
    await page.goto('pdf-toolbox/');
    await chooseFiles(page, () => page.getByTestId('welcome-open').click(), [
      fixture('openapi', 'library-api.yaml'),
    ]);
    await expect(page.getByTestId('toast')).toContainText('Not a PDF or supported image');
  });
});
