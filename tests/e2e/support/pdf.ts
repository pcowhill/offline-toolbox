// Node-side inspection of PDFs downloaded during e2e tests.
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function pdfPages(
  bytes: Uint8Array,
): Promise<Array<{ text: string; rotate: number; width: number; height: number }>> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const [x1, y1, x2, y2] = page.view;
    pages.push({
      text: content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      rotate: page.rotate,
      width: Math.round(x2 - x1),
      height: Math.round(y2 - y1),
    });
  }
  await task.destroy();
  return pages;
}

/** Raw file plus every inflated stream, to prove that text is really gone. */
export async function allStreamText(bytes: Uint8Array): Promise<string> {
  const parts = [Buffer.from(bytes).toString('latin1')];
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

export function zipEntryNames(zip: Uint8Array): string[] {
  const buf = Buffer.from(zip);
  const end = buf.length - 22;
  const count = buf.readUInt16LE(end + 10);
  let offset = buf.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = buf.readUInt16LE(offset + 28);
    const extra = buf.readUInt16LE(offset + 30);
    const comment = buf.readUInt16LE(offset + 32);
    names.push(buf.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extra + comment;
  }
  return names;
}

export { PDFDocument };
