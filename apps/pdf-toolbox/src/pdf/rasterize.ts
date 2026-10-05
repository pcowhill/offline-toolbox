import type { PageRasterizer } from '../core/buildPdf';
import type { DecodedImage } from '../core/pdfImages';
import { normalizeRotation } from '../core/types';
import { blobBytes, canvasToBlob, openPdf, renderPageImage } from './pdfjs';

const REDACTION_DPI = 200;

/** Renders pages of the annotated export to images (used for irreversible redaction). */
export const rasterizeForRedaction: PageRasterizer = async (pdfBytes, targets) => {
  const doc = await openPdf(pdfBytes, 'export');
  const out = new Map<number, { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' }>();
  try {
    for (const target of targets) {
      const page = await doc.getPage(target.index + 1);
      const rotation = normalizeRotation(page.rotate);
      let blob = await renderPageImage(page, {
        dpi: REDACTION_DPI,
        rotation,
        type: 'image/png',
        redactions: target.redactions,
      });
      if (blob.size > 3_000_000) {
        blob = await renderPageImage(page, {
          dpi: REDACTION_DPI,
          rotation,
          type: 'image/jpeg',
          quality: 0.9,
          redactions: target.redactions,
        });
        out.set(target.index, { bytes: await blobBytes(blob), mime: 'image/jpeg' });
      } else {
        out.set(target.index, { bytes: await blobBytes(blob), mime: 'image/png' });
      }
      page.cleanup();
    }
  } finally {
    await doc.loadingTask.destroy();
  }
  return out;
};

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function toBitmap(image: DecodedImage): Promise<ImageBitmap> {
  if (image.kind === 'jpeg')
    return createImageBitmap(new Blob([image.bytes as BlobPart], { type: 'image/jpeg' }));
  return createImageBitmap(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
  );
}

/** Canvas-based JPEG encoder used by "Reduce file size". */
export async function encodeJpeg(
  image: DecodedImage,
  width: number,
  height: number,
  quality: number,
): Promise<Uint8Array> {
  const bitmap = await toBitmap(image);
  const canvas = makeCanvas(width, height);
  try {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await blobBytes(await canvasToBlob(canvas, 'image/jpeg', quality));
  } finally {
    bitmap.close();
    canvas.width = 0;
  }
}

/** Encodes a decoded PDF image as a downloadable file (JPEG passthrough, otherwise PNG). */
export async function decodedImageToFile(
  image: DecodedImage,
): Promise<{ bytes: Uint8Array; extension: 'jpg' | 'png' }> {
  if (image.kind === 'jpeg') return { bytes: image.bytes, extension: 'jpg' };
  const canvas = makeCanvas(image.width, image.height);
  try {
    canvas
      .getContext('2d')!
      .putImageData(
        new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
        0,
        0,
      );
    return { bytes: await blobBytes(await canvasToBlob(canvas, 'image/png')), extension: 'png' };
  } finally {
    canvas.width = 0;
  }
}

/**
 * Converts any browser-readable image to PNG or keeps PNG/JPEG as-is. JPEGs with an EXIF
 * rotation are re-encoded upright (PDF viewers ignore EXIF).
 */
export async function normalizeImageFile(
  bytes: Uint8Array,
  mime: string,
  orientation: number,
): Promise<{ bytes: Uint8Array; mime: 'image/png' | 'image/jpeg'; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), {
    imageOrientation: 'from-image',
  });
  try {
    const { width, height } = bitmap;
    if (mime === 'image/png' || (mime === 'image/jpeg' && orientation === 1)) {
      return { bytes, mime: mime as 'image/png' | 'image/jpeg', width, height };
    }
    const canvas = makeCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const outMime = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const out = await blobBytes(await canvasToBlob(canvas, outMime, 0.92));
    canvas.width = 0;
    return { bytes: out, mime: outMime, width, height };
  } finally {
    bitmap.close();
  }
}
