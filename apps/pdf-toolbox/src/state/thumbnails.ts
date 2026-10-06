// Lazily rendered, cached page thumbnails (object URLs). The cache is bounded; evicted
// thumbnails release their object URLs so long sessions do not leak memory.
import { AnnotationMode, canvasToBlob, enqueue, renderToCanvas } from '../pdf/pdfjs';
import type { Rotation } from '../core/types';
import { pdfDocument } from './registry';

const MAX_ENTRIES = 400;
const cache = new Map<string, Promise<string>>();

function evict() {
  while (cache.size > MAX_ENTRIES) {
    const [key, value] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(key);
    void value.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
}

export function thumbnailUrl(
  sourceId: string,
  index: number,
  rotation: Rotation,
  widthPx: number,
  priority = 0,
): Promise<string> {
  const key = `${sourceId}:${index}:${rotation}:${widthPx}`;
  const cached = cache.get(key);
  if (cached) {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const promise = enqueue(async () => {
    const doc = await pdfDocument(sourceId);
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1, rotation });
    const canvas = document.createElement('canvas');
    try {
      await renderToCanvas(page, canvas, {
        scale: widthPx / base.width,
        rotation,
        annotationMode: AnnotationMode.ENABLE,
      });
      const blob = await canvasToBlob(canvas, 'image/png');
      return URL.createObjectURL(blob);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  }, priority);
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  evict();
  return promise;
}

export function clearThumbnails() {
  for (const value of cache.values())
    void value.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  cache.clear();
}
