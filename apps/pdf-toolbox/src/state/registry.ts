// Non-reactive registry for large binary data (source PDF bytes, pdf.js documents, inserted
// images). Kept outside the React store so state snapshots (undo history) stay small.
// Everything lives in memory only: nothing is written to disk or browser storage.
import type { EmbeddedImage } from '../core/types';
import { openPdf, type PDFDocumentProxy } from '../pdf/pdfjs';

interface SourceEntry {
  name: string;
  bytes: Uint8Array;
  pdf: Promise<PDFDocumentProxy>;
}

const sources = new Map<string, SourceEntry>();
export const images = new Map<string, EmbeddedImage>();

export function registerSource(
  id: string,
  name: string,
  bytes: Uint8Array,
  pdf: Promise<PDFDocumentProxy>,
) {
  sources.set(id, { name, bytes, pdf });
}

export function sourceBytes(id: string): Uint8Array {
  const entry = sources.get(id);
  if (!entry) throw new Error('Document is no longer open.');
  return entry.bytes;
}

export function sourceMap(): Map<string, { name: string; bytes: Uint8Array }> {
  return new Map([...sources].map(([id, s]) => [id, { name: s.name, bytes: s.bytes }]));
}

export function pdfDocument(id: string): Promise<PDFDocumentProxy> {
  const entry = sources.get(id);
  if (!entry) return Promise.reject(new Error('Document is no longer open.'));
  return entry.pdf;
}

export function openPdfFor(id: string, name: string, bytes: Uint8Array) {
  const pdf = openPdf(bytes, name);
  registerSource(id, name, bytes, pdf);
  return pdf;
}

/** Frees memory of sources no longer referenced by any page. */
export async function releaseSources(keep: Set<string>) {
  for (const [id, entry] of sources) {
    if (keep.has(id)) continue;
    sources.delete(id);
    try {
      const pdf = await entry.pdf;
      await pdf.loadingTask.destroy();
    } catch {
      /* already failed */
    }
  }
}

export function clearAll() {
  void releaseSources(new Set());
  images.clear();
}
