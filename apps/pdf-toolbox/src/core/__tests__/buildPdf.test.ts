import type { PDFDict } from 'pdf-lib';
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { buildPdf, EncryptedPdfError, loadPdfLib } from '../buildPdf';
import { readFormFields } from '../forms';
import { imagesToPdf, layoutImage } from '../imagesToPdf';
import { parsePageRanges, splitPlan, describePages } from '../pageRanges';
import type { Annotation } from '../types';
import { fixture, makePage, pageInfo, pageTexts } from './helpers';

const LETTER = { width: 612, height: 792 };
const A4 = { width: 595.28, height: 841.89 };
const three = fixture('three-pages.pdf');
const second = fixture('second.pdf');
const sources = new Map([
  ['a', { name: 'three-pages.pdf', bytes: three }],
  ['b', { name: 'second.pdf', bytes: second }],
]);

describe('PDF loading', () => {
  it('loads fixtures and reads page count', async () => {
    const doc = await loadPdfLib(three);
    expect(doc.getPageCount()).toBe(3);
    expect(await pageTexts(three)).toEqual([
      expect.stringContaining('Page 1'),
      expect.stringContaining('Page 2'),
      expect.stringContaining('Page 3'),
    ]);
  });

  it('rejects encrypted documents with a clear message', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    // Fake an /Encrypt entry in the trailer (pdf-lib only checks for its presence).
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: 'Standard' });
    const bytes = await doc.save();
    await expect(loadPdfLib(bytes, 'locked.pdf')).rejects.toBeInstanceOf(EncryptedPdfError);
  });

  it('rejects garbage', async () => {
    await expect(loadPdfLib(new TextEncoder().encode('not a pdf'), 'x.pdf')).rejects.toThrow(
      /could not be read/,
    );
  });
});

describe('page operations via export', () => {
  it('merges, reorders, deletes and duplicates pages', async () => {
    const pages = [
      makePage('b', 1, LETTER),
      makePage('a', 0, LETTER),
      makePage('a', 2, { width: 792, height: 612 }, { baseRotation: 90 }),
      makePage('a', 0, LETTER),
      makePage('b', 0, LETTER),
    ];
    const { bytes } = await buildPdf({ pages, sources });
    const texts = await pageTexts(bytes);
    expect(texts.map((t) => t.match(/Page \d|Appendix [AB]/)?.[0])).toEqual([
      'Appendix B',
      'Page 1',
      'Page 3',
      'Page 1',
      'Appendix A',
    ]);
    expect(texts).toHaveLength(5);
  });

  it('extracts a subset without leaking removed pages into the file', async () => {
    const { bytes } = await buildPdf({ pages: [makePage('a', 1, A4)], sources });
    expect(await pageTexts(bytes)).toEqual([expect.stringContaining('Page 2')]);
    const text = await inflateAll(bytes);
    expect(text).not.toContain('Page 1');
    expect(text).not.toContain('Page 3');
  });

  it('applies rotation on top of the original /Rotate', async () => {
    const pages = [
      makePage('a', 0, LETTER, { rotation: 90 }),
      makePage('a', 2, { width: 792, height: 612 }, { baseRotation: 90, rotation: 270 }),
    ];
    const info = await pageInfo((await buildPdf({ pages, sources })).bytes);
    expect(info.map((p) => p.rotate)).toEqual([90, 0]);
  });

  it('splits into groups', async () => {
    const plan = splitPlan(3, { kind: 'every', size: 2 });
    expect(plan).toEqual([[0, 1], [2]]);
    const outputs = [];
    for (const group of plan) {
      const pages = group.map((i) => makePage('a', i, LETTER));
      outputs.push(await pageTexts((await buildPdf({ pages, sources })).bytes));
    }
    expect(outputs.map((o) => o.length)).toEqual([2, 1]);
    expect(outputs[1][0]).toContain('Page 3');
  });
});

describe('page ranges', () => {
  it('parses ranges', () => {
    expect(parsePageRanges('1-3, 5, 7-', 8)).toEqual([[0, 1, 2], [4], [6, 7]]);
    expect(parsePageRanges('3-1', 3)).toEqual([[2, 1, 0]]);
    expect(() => parsePageRanges('0', 3)).toThrow(/outside/);
    expect(() => parsePageRanges('a', 3)).toThrow(/not a page/);
    expect(() => parsePageRanges('  ', 3)).toThrow(/Enter page ranges/);
    expect(splitPlan(3, { kind: 'single' })).toEqual([[0], [1], [2]]);
    expect(describePages([0, 1, 2, 4, 6, 7])).toBe('1-3, 5, 7-8');
  });
});

describe('annotations', () => {
  const annotations: Annotation[] = [
    {
      id: '1',
      type: 'text',
      x: 72,
      y: 300,
      w: 250,
      h: 60,
      rotation: 0,
      text: 'Hello annotation\nSecond line',
      fontSize: 14,
      font: 'Helvetica',
      bold: false,
      color: '#112233',
      align: 'left',
      background: null,
      opacity: 1,
    },
    {
      id: '2',
      type: 'stamp',
      x: 300,
      y: 400,
      w: 160,
      h: 50,
      rotation: 0,
      text: 'Approved',
      color: '#15803d',
      opacity: 1,
    },
    { id: '3', type: 'highlight', x: 50, y: 50, w: 200, h: 20, color: '#ffeb3b', opacity: 0.4 },
    {
      id: '4',
      type: 'rect',
      x: 10,
      y: 10,
      w: 30,
      h: 30,
      stroke: '#ff0000',
      fill: null,
      lineWidth: 2,
      opacity: 1,
    },
    {
      id: '5',
      type: 'ellipse',
      x: 100,
      y: 600,
      w: 60,
      h: 40,
      stroke: '#0000ff',
      fill: '#ccccff',
      lineWidth: 1,
      opacity: 0.8,
    },
    {
      id: '6',
      type: 'arrow',
      x1: 100,
      y1: 100,
      x2: 200,
      y2: 150,
      stroke: '#000000',
      lineWidth: 2,
      opacity: 1,
    },
    {
      id: '7',
      type: 'ink',
      strokes: [[10, 10, 20, 25, 30, 12]],
      stroke: '#333333',
      lineWidth: 3,
      opacity: 1,
    },
    { id: '8', type: 'whiteout', x: 400, y: 700, w: 100, h: 40, color: '#ffffff', opacity: 1 },
    {
      id: '9',
      type: 'text',
      x: 100,
      y: 100,
      w: 40,
      h: 200,
      rotation: 90,
      text: 'Rotated ✓ ok',
      fontSize: 12,
      font: 'Times',
      bold: true,
      color: '#000000',
      align: 'center',
      background: '#ffffff',
      opacity: 1,
    },
  ];

  it('draws text, stamps and shapes into the page content', async () => {
    const page = makePage('a', 0, LETTER, { annotations });
    const { bytes, warnings } = await buildPdf({ pages: [page], sources });
    const [text] = await pageTexts(bytes);
    expect(text).toContain('Hello annotation');
    expect(text).toContain('Second line');
    expect(text).toContain('APPROVED');
    expect(text).toContain('Rotated ? ok');
    expect(warnings.join(' ')).toMatch(/replaced with "\?"/);
  });

  it('serialises annotations as plain JSON (round trip)', () => {
    const json = JSON.stringify(annotations);
    expect(JSON.parse(json)).toEqual(annotations);
  });

  it('embeds image/signature annotations once even when used twice', async () => {
    const png = fixture('signature.png');
    const images = new Map([
      ['sig', { id: 'sig', bytes: png, mime: 'image/png' as const, width: 200, height: 80 }],
    ]);
    const sig: Annotation = {
      id: 's',
      type: 'image',
      imageId: 'sig',
      signature: true,
      x: 300,
      y: 600,
      w: 150,
      h: 60,
      rotation: 0,
      opacity: 1,
    };
    const pages = [
      makePage('a', 0, LETTER, { annotations: [sig] }),
      makePage('a', 1, A4, { annotations: [{ ...sig, id: 't' }] }),
    ];
    const { bytes } = await buildPdf({ pages, sources, images });
    const doc = await PDFDocument.load(bytes);
    const imageCount = doc.context
      .enumerateIndirectObjects()
      .filter(
        ([, o]) =>
          (o as { dict?: PDFDict }).dict?.get(PDFName.of('Subtype')) === PDFName.of('Image'),
      ).length;
    // One image + its soft mask (alpha channel).
    expect(imageCount).toBe(2);
  });
});

describe('forms', () => {
  const form = fixture('form.pdf');
  const formSources = new Map([['f', { name: 'form.pdf', bytes: form }], ...sources]);

  it('detects AcroForm fields', async () => {
    const fields = readFormFields(await loadPdfLib(form));
    expect(fields.map((f) => [f.name, f.type])).toEqual([
      ['fullName', 'text'],
      ['subscribe', 'checkbox'],
      ['color', 'radio'],
      ['country', 'dropdown'],
      ['comments', 'text'],
    ]);
    expect(fields.find((f) => f.name === 'country')?.options).toEqual([
      'Canada',
      'Germany',
      'Japan',
    ]);
  });

  it('fills fields and keeps the form interactive, also after merging', async () => {
    const values = {
      fullName: 'Ada Lovelace',
      subscribe: true,
      color: 'green',
      country: 'Japan',
      comments: 'Line 1\nLine 2',
    };
    const { bytes } = await buildPdf({
      pages: [makePage('a', 0, LETTER), makePage('f', 0, LETTER)],
      sources: formSources,
      formValues: { f: values },
    });
    const fields = readFormFields(await PDFDocument.load(bytes));
    expect(Object.fromEntries(fields.map((f) => [f.name, f.value]))).toEqual(values);
  });

  it('flattens filled fields into page content', async () => {
    const { bytes } = await buildPdf({
      pages: [makePage('f', 0, LETTER)],
      sources: formSources,
      formValues: { f: { fullName: 'Grace Hopper' } },
      flattenForms: true,
    });
    expect(readFormFields(await PDFDocument.load(bytes))).toEqual([]);
    expect((await pageTexts(bytes))[0]).toContain('Grace Hopper');
  });

  it('renames fields on duplicated pages so they stay independent', async () => {
    const { bytes, warnings } = await buildPdf({
      pages: [makePage('f', 0, LETTER), makePage('f', 0, LETTER)],
      sources: formSources,
    });
    const names = readFormFields(await PDFDocument.load(bytes)).map((f) => f.name);
    expect(names).toContain('fullName');
    expect(names).toContain('fullName (2)');
    expect(warnings.join(' ')).toMatch(/renamed/);
  });
});

describe('redaction', () => {
  it('rasterises redacted pages so the original text is gone', async () => {
    const secret = new Map([['s', { name: 'secret.pdf', bytes: fixture('secret.pdf') }]]);
    const redact: Annotation = { id: 'r', type: 'redact', x: 60, y: 70, w: 250, h: 40, opacity: 1 };
    const calls: Array<{ index: number; redactions: unknown[] }> = [];
    const png = fixture('sample.png');
    const { bytes, redactedPages } = await buildPdf({
      pages: [makePage('s', 0, LETTER, { annotations: [redact] }), makePage('s', 1, LETTER)],
      sources: secret,
      // Stand-in rasterizer (the browser uses pdf.js); the e2e test covers real rendering.
      rasterize: async (_bytes, targets) => {
        calls.push(...targets);
        return new Map(targets.map((t) => [t.index, { bytes: png, mime: 'image/png' as const }]));
      },
    });
    expect(redactedPages).toBe(1);
    expect(calls).toEqual([{ index: 0, redactions: [{ x: 60, y: 70, w: 250, h: 40 }] }]);
    const texts = await pageTexts(bytes);
    expect(texts[0]).toBe('');
    expect(texts[1]).toContain('Second page');
    const all = await inflateAll(bytes);
    expect(all).not.toContain('SECRET');
    expect(all).not.toContain('Public information');
  });

  it('refuses to redact without a rasterizer', async () => {
    const redact: Annotation = { id: 'r', type: 'redact', x: 0, y: 0, w: 10, h: 10, opacity: 1 };
    await expect(
      buildPdf({ pages: [makePage('a', 0, LETTER, { annotations: [redact] })], sources }),
    ).rejects.toThrow(/rasterizer/);
  });
});

describe('images to PDF', () => {
  it('lays out images on fixed page sizes', () => {
    expect(
      layoutImage(400, 200, { pageSize: 'fit', orientation: 'auto', margin: 0 }),
    ).toMatchObject({ pageWidth: 400, pageHeight: 200 });
    const a4 = layoutImage(1000, 500, { pageSize: 'a4', orientation: 'auto', margin: 36 });
    expect(a4.pageWidth).toBeCloseTo(841.89);
    expect(a4.width).toBeCloseTo(841.89 - 72);
    const portrait = layoutImage(1000, 500, {
      pageSize: 'letter',
      orientation: 'portrait',
      margin: 0,
    });
    expect(portrait).toMatchObject({ pageWidth: 612, pageHeight: 792, width: 612, height: 306 });
  });

  it('combines PNG and JPEG files into one PDF', async () => {
    const bytes = await imagesToPdf(
      [
        { name: 'a.png', bytes: fixture('sample.png'), mime: 'image/png' },
        { name: 'b.jpg', bytes: fixture('sample.jpg'), mime: 'image/jpeg' },
      ],
      { pageSize: 'a4', orientation: 'auto', margin: 20 },
    );
    const info = await pageInfo(bytes);
    expect(info).toHaveLength(2);
    expect(info[0].width).toBeCloseTo(841.89); // landscape image → landscape page
  });

  it('reports unreadable images', async () => {
    await expect(
      imagesToPdf([{ name: 'bad.png', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }], {
        pageSize: 'fit',
        orientation: 'auto',
        margin: 0,
      }),
    ).rejects.toThrow(/bad.png/);
  });
});

/** Concatenation of all (decompressed) streams and the raw file, for "is this text gone" checks. */
async function inflateAll(bytes: Uint8Array): Promise<string> {
  const raw = Buffer.from(bytes).toString('latin1');
  const parts = [raw];
  const doc = await PDFDocument.load(bytes);
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const contents = (object as { contents?: Uint8Array }).contents;
    if (!contents) continue;
    try {
      parts.push(zlib.inflateSync(Buffer.from(contents)).toString('latin1'));
    } catch {
      parts.push(Buffer.from(contents).toString('latin1'));
    }
  }
  return parts.join('\n');
}
