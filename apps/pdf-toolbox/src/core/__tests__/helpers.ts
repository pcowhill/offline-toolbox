import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createId } from '@shared/lib/id';
import type { Annotation, Rotation, WorkspacePage } from '../types';

export const fixturesDir = path.resolve(import.meta.dirname, '../../../../../tests/fixtures');

export function fixture(name: string): Uint8Array {
  const sub = name.endsWith('.pdf') ? 'pdf' : 'images';
  return new Uint8Array(fs.readFileSync(path.join(fixturesDir, sub, name)));
}

/** Text of every page (via pdf.js, as a viewer would see it). */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return texts;
}

export async function pageInfo(
  bytes: Uint8Array,
): Promise<Array<{ rotate: number; width: number; height: number }>> {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const [x1, y1, x2, y2] = page.view;
    out.push({ rotate: page.rotate, width: x2 - x1, height: y2 - y1 });
  }
  await task.destroy();
  return out;
}

export function makePage(
  sourceId: string,
  sourceIndex: number,
  size: { width: number; height: number },
  extra: { rotation?: Rotation; baseRotation?: Rotation; annotations?: Annotation[] } = {},
): WorkspacePage {
  return {
    id: createId(),
    sourceId,
    sourceIndex,
    baseRotation: extra.baseRotation ?? 0,
    rotation: extra.rotation ?? 0,
    size,
    annotations: extra.annotations ?? [],
  };
}
