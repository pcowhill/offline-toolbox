import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { extractImages } from '../extractImages';
import {
  boxPageToView,
  boxViewToPage,
  pageToView,
  viewSize,
  viewToPage,
  translateAnnotation,
  resizeAnnotation,
  annotationBounds,
} from '../geometry';
import { jpegOrientation, sniffImageType } from '../jpeg';
import { optimizePdf, removeUnreachableObjects, targetSize } from '../optimize';
import { unpredict } from '../pdfImages';
import { wrapText } from '../textLayout';
import type { Rotation, InkAnnotation } from '../types';
import { createZip, crc32 } from '../zip';
import { fixture } from './helpers';

describe('geometry', () => {
  it('round-trips points for every rotation', () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const p = { x: 30, y: 70 };
      expect(viewToPage(pageToView(p, 600, 800, rotation), 600, 800, rotation)).toEqual(p);
      const box = { x: 10, y: 20, w: 100, h: 50 };
      expect(boxViewToPage(boxPageToView(box, 600, 800, rotation), 600, 800, rotation)).toEqual(
        box,
      );
    }
  });

  it('maps the top-left corner like a physical rotation', () => {
    expect(pageToView({ x: 0, y: 0 }, 600, 800, 90)).toEqual({ x: 800, y: 0 });
    expect(pageToView({ x: 0, y: 0 }, 600, 800, 180)).toEqual({ x: 600, y: 800 });
    expect(pageToView({ x: 0, y: 0 }, 600, 800, 270)).toEqual({ x: 0, y: 600 });
    expect(viewSize(600, 800, 90)).toEqual({ width: 800, height: 600 });
  });

  it('moves and resizes annotations', () => {
    const ink: InkAnnotation = {
      id: 'i',
      type: 'ink',
      strokes: [[0, 0, 10, 10]],
      stroke: '#000',
      lineWidth: 0,
      opacity: 1,
    };
    expect(translateAnnotation(ink, 5, 2).strokes).toEqual([[5, 2, 15, 12]]);
    const bounds = annotationBounds(ink);
    expect(resizeAnnotation(ink, bounds, { x: 0, y: 0, w: 20, h: 20 }).strokes).toEqual([
      [0, 0, 20, 20],
    ]);
  });
});

describe('text wrapping', () => {
  const measure = (t: string) => t.length * 10;
  it('wraps words and keeps explicit newlines', () => {
    expect(wrapText('aa bb cc', 50, measure)).toEqual(['aa bb', 'cc']);
    expect(wrapText('line1\n\nline3', 100, measure)).toEqual(['line1', '', 'line3']);
    expect(wrapText('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij']);
  });
});

describe('zip writer', () => {
  it('creates a valid stored zip readable by standard tools', () => {
    const zip = createZip([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'a.txt', data: new TextEncoder().encode('world') },
    ]);
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const buf = Buffer.from(zip);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const end = buf.length - 22;
    expect(buf.readUInt32LE(end)).toBe(0x06054b50);
    expect(buf.readUInt16LE(end + 10)).toBe(2);
    expect(buf.toString('latin1')).toContain('a (2).txt');
  });
});

describe('image helpers', () => {
  it('sniffs types and reads EXIF orientation', () => {
    expect(sniffImageType(fixture('sample.png'))).toBe('image/png');
    expect(sniffImageType(fixture('sample.jpg'))).toBe('image/jpeg');
    expect(jpegOrientation(fixture('sample.jpg'))).toBe(1);
    // Minimal JPEG with an EXIF APP1 segment declaring orientation 6.
    const exif = Buffer.from([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00,
      0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
    ]);
    expect(jpegOrientation(new Uint8Array(exif))).toBe(6);
  });

  it('reverses PNG predictors', () => {
    // Two rows, 3 bytes each (1 colour, 8 bit): "Sub" then "Up" filters.
    const data = new Uint8Array([1, 10, 5, 5, 2, 1, 1, 1]);
    expect(Array.from(unpredict(data, 15, 1, 8, 3))).toEqual([10, 15, 20, 11, 16, 21]);
  });
});

describe('embedded images', () => {
  it('extracts the JPEG (passthrough) and the PNG (decoded with alpha)', async () => {
    const doc = await PDFDocument.load(fixture('images.pdf'));
    const { images, unsupported } = extractImages(doc, [{ index: 0, label: 1 }]);
    expect(unsupported).toEqual([]);
    expect(images.map((i) => i.image.kind).sort()).toEqual(['jpeg', 'rgba']);
    const jpeg = images.find((i) => i.image.kind === 'jpeg')!.image;
    expect(jpeg).toMatchObject({ width: 2400, height: 1800 });
    const rgba = images.find((i) => i.image.kind === 'rgba')!.image;
    expect(rgba).toMatchObject({ width: 200, height: 80, hasAlpha: true });
  });

  it('reports scanned pages as images only', async () => {
    const doc = await PDFDocument.load(fixture('scanned.pdf'));
    expect(extractImages(doc, [{ index: 0, label: 1 }]).images).toHaveLength(1);
  });
});

describe('optimisation', () => {
  it('computes target sizes', () => {
    expect(targetSize(2400, 1800, 1200)).toEqual({ width: 1200, height: 900 });
    expect(targetSize(100, 50, 1200)).toEqual({ width: 100, height: 50 });
  });

  it('replaces large images when the re-encoded result is smaller', async () => {
    const input = fixture('images.pdf');
    const calls: Array<[number, number, number]> = [];
    // Stand-in encoder: any small valid JPEG (the browser uses canvas).
    const small = fixture('sample.jpg');
    const result = await optimizePdf(input, {
      preset: 'balanced',
      removeMetadata: true,
      encodeJpeg: async (_image, width, height, quality) => {
        calls.push([width, height, quality]);
        return small;
      },
    });
    expect(calls[0]).toEqual([1700, 1275, 0.72]);
    expect(result.imagesRecompressed).toBeGreaterThanOrEqual(1);
    expect(result.after).toBeLessThan(result.before);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBeUndefined();
  });

  it('removes unreachable objects', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.register(doc.context.flateStream(zlib.deflateSync(Buffer.from('orphan'))));
    expect(removeUnreachableObjects(doc.context)).toBe(1);
  });
});

describe('radio groups with /Opt export values', () => {
  it('maps widget states to option values and fills by option value', async () => {
    const { PDFName, PDFString } = await import('pdf-lib');
    const { readFormFields, applyFormValues } = await import('../forms');
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const group = doc.getForm().createRadioGroup('choice');
    group.addOptionToPage('0', page, { x: 10, y: 10 });
    group.addOptionToPage('1', page, { x: 40, y: 10 });
    group.acroField.dict.set(
      PDFName.of('Opt'),
      doc.context.obj([PDFString.of('Yes'), PDFString.of('No')]),
    );
    const loaded = await PDFDocument.load(await doc.save());
    const [field] = readFormFields(loaded);
    expect(field.options).toEqual(['Yes', 'No']);
    expect(field.stateToOption).toEqual({ '0': 'Yes', '1': 'No' });
    expect(applyFormValues(loaded, { choice: 'No' }, { flatten: false }).warnings).toEqual([]);
    expect(readFormFields(loaded)[0].value).toBe('No');
  });
});
