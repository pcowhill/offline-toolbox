import type { PDFRef } from 'pdf-lib';
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../buildPdf';
import type { Annotation } from '../types';
import { fixture, makePage, pageTexts } from './helpers';

const LETTER = { width: 612, height: 792 };

/** Page 1 has a table-of-contents link to page 2; page 2 contains a secret. */
async function linkedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  p1.drawText('Contents: see page 2', { x: 72, y: 700, size: 14, font });
  p2.drawText('TOPSECRET', { x: 72, y: 700, size: 14, font });
  const link = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [72, 690, 300, 720],
      Border: [0, 0, 0],
      Dest: [p2.ref, 'Fit'],
    }),
  );
  p1.node.set(PDFName.of('Annots'), doc.context.obj([link]));
  return doc.save({ useObjectStreams: false });
}

async function inspect(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  let pageObjects = 0;
  const streams: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Page'))
      pageObjects++;
    const contents = (object as { contents?: Uint8Array }).contents;
    if (contents) {
      try {
        streams.push(zlib.inflateSync(Buffer.from(contents)).toString('latin1'));
      } catch {
        streams.push(Buffer.from(contents).toString('latin1'));
      }
    }
  }
  const secretHex = Buffer.from('TOPSECRET').toString('hex').toUpperCase();
  const all = Buffer.from(bytes).toString('latin1') + streams.join('\n');
  return {
    doc,
    pageObjects,
    leaks: all.includes('TOPSECRET') || all.toUpperCase().includes(secretHex),
  };
}

describe('exports contain only kept pages', () => {
  it('deleting a linked-to page removes its content and the dangling link', async () => {
    const sources = new Map([['l', { name: 'linked.pdf', bytes: await linkedPdf() }]]);
    const { bytes } = await buildPdf({ pages: [makePage('l', 0, LETTER)], sources });
    const result = await inspect(bytes);
    expect(result.leaks).toBe(false);
    expect(result.pageObjects).toBe(1);
    expect(
      result.doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0,
    ).toBe(0);
  });

  it('keeps links between kept pages, pointing at the exported page', async () => {
    const sources = new Map([['l', { name: 'linked.pdf', bytes: await linkedPdf() }]]);
    const { bytes } = await buildPdf({
      pages: [makePage('l', 0, LETTER), makePage('l', 1, LETTER)],
      sources,
    });
    const { doc, pageObjects } = await inspect(bytes);
    expect(pageObjects).toBe(2);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const link = doc.context.lookup(annots.get(0), PDFDict);
    expect((link.lookup(PDFName.of('Dest'), PDFArray).get(0) as PDFRef).toString()).toBe(
      doc.getPage(1).ref.toString(),
    );
  });

  it('redacting a linked-to page leaves no trace of its original content', async () => {
    const sources = new Map([['l', { name: 'linked.pdf', bytes: await linkedPdf() }]]);
    const redact: Annotation = { id: 'r', type: 'redact', x: 60, y: 70, w: 200, h: 40, opacity: 1 };
    const png = fixture('sample.png');
    const { bytes } = await buildPdf({
      pages: [makePage('l', 0, LETTER), makePage('l', 1, LETTER, { annotations: [redact] })],
      sources,
      rasterize: async (_b, targets) =>
        new Map(targets.map((t) => [t.index, { bytes: png, mime: 'image/png' as const }])),
    });
    const result = await inspect(bytes);
    expect(result.leaks).toBe(false);
    expect(result.pageObjects).toBe(2);
    expect((await pageTexts(bytes))[0]).toContain('Contents');
  });

  it('form exports carry no orphan page copies', async () => {
    const sources = new Map([['f', { name: 'form.pdf', bytes: fixture('form.pdf') }]]);
    const { bytes } = await buildPdf({ pages: [makePage('f', 0, LETTER)], sources });
    const { doc, pageObjects } = await inspect(bytes);
    expect(pageObjects).toBe(1);
    expect(doc.getForm().getFields()).toHaveLength(5);
  });
});
