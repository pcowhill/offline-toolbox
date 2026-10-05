// Browser-side pdf.js integration: document loading, rendering (with a small concurrency-limited
// queue), text extraction and rasterisation. Uses the "legacy" build for wider browser support,
// which matters on isolated networks that may run older browser versions.
import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  OPS,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { Box, Rotation } from '../core/types';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Runtime data shipped next to the app by tool.vite.mjs (never fetched from a CDN). */
function assetUrl(dir: string): string {
  return new URL(`./pdfjs/${dir}/`, document.baseURI).href;
}

export { AnnotationMode };
export type { PDFDocumentProxy, PDFPageProxy };

export class PasswordRequiredError extends Error {
  constructor(name: string) {
    super(`"${name}" is password-protected. PDF Toolbox cannot edit encrypted PDFs.`);
    this.name = 'PasswordRequiredError';
  }
}

export async function openPdf(bytes: Uint8Array, name: string): Promise<PDFDocumentProxy> {
  const task = getDocument({
    // pdf.js transfers the buffer to its worker: give it a copy, we keep the original.
    data: bytes.slice(),
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    // Never execute JavaScript embedded in PDFs and never follow external links automatically.
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  } as Parameters<typeof getDocument>[0]);
  task.onPassword = () => {
    task.destroy();
  };
  try {
    return await task.promise;
  } catch (error) {
    const err = error as { name?: string; message?: string };
    if (err?.name === 'PasswordException' || /password/i.test(err?.message ?? ''))
      throw new PasswordRequiredError(name);
    if (err?.name === 'InvalidPDFException')
      throw new Error(`"${name}" is not a valid PDF file or is damaged.`, { cause: error });
    throw new Error(`"${name}" could not be opened: ${err?.message ?? String(error)}`, {
      cause: error,
    });
  }
}

// ------------------------------------------------------------------------------------------
// Render queue: limits simultaneous renders so large documents do not exhaust memory.

type Job = () => Promise<void>;
const queue: Array<{ job: Job; priority: number }> = [];
let running = 0;
const MAX_CONCURRENT = 2;

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    queue.sort((a, b) => b.priority - a.priority);
    const { job } = queue.shift()!;
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
}

export function enqueue<T>(work: () => Promise<T>, priority = 0): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push({ priority, job: () => work().then(resolve, reject) });
    pump();
  });
}

export interface RenderOptions {
  /** CSS pixels per PDF point. */
  scale: number;
  /** Total rotation (page /Rotate plus user rotation). */
  rotation: Rotation;
  annotationMode?: number;
  background?: string;
}

/** Maximum canvas area; very large pages are rendered at reduced resolution instead of failing. */
const MAX_CANVAS_PIXELS = 16_000_000;

export async function renderToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  options: RenderOptions,
  signal?: AbortSignal,
) {
  let viewport = page.getViewport({ scale: options.scale, rotation: options.rotation });
  const area = viewport.width * viewport.height;
  if (area > MAX_CANVAS_PIXELS) {
    viewport = page.getViewport({
      scale: options.scale * Math.sqrt(MAX_CANVAS_PIXELS / area),
      rotation: options.rotation,
    });
  }
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({
    canvas,
    viewport,
    annotationMode: options.annotationMode ?? AnnotationMode.ENABLE,
    background: options.background ?? 'white',
  });
  const abort = () => task.cancel();
  signal?.addEventListener('abort', abort);
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('The browser could not encode the image (out of memory?).')),
      type,
      quality,
    );
  });
}

// ------------------------------------------------------------------------------------------
// Text

export interface PageText {
  text: string;
  hasImages: boolean;
}

export async function extractPageText(page: PDFPageProxy): Promise<PageText> {
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
    else if (item.str && !item.str.endsWith(' ')) text += ' ';
  }
  text = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  let hasImages = false;
  if (!text) {
    const ops = await page.getOperatorList();
    hasImages = ops.fnArray.some(
      (fn) =>
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageMaskXObject,
    );
  }
  return { text, hasImages };
}

// ------------------------------------------------------------------------------------------
// Rasterisation (secure redaction and page → image export)

export async function renderPageImage(
  page: PDFPageProxy,
  options: {
    dpi: number;
    rotation: Rotation;
    type: 'image/png' | 'image/jpeg';
    quality?: number;
    redactions?: Box[];
  },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    await renderToCanvas(page, canvas, {
      scale: options.dpi / 72,
      rotation: options.rotation,
      annotationMode: AnnotationMode.ENABLE,
    });
    if (options.redactions?.length) {
      // Belt and braces: the redaction boxes are already drawn black in the content.
      const ctx = canvas.getContext('2d')!;
      const viewport = page.getViewport({ scale: 1, rotation: options.rotation });
      const sx = canvas.width / viewport.width;
      const sy = canvas.height / viewport.height;
      ctx.fillStyle = '#000';
      for (const box of options.redactions)
        ctx.fillRect(box.x * sx - 1, box.y * sy - 1, box.w * sx + 2, box.h * sy + 2);
    }
    return await canvasToBlob(canvas, options.type, options.quality);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
