// Images → PDF. PNG and JPEG are embedded without re-encoding; other formats are converted to
// PNG by the UI (via canvas) before reaching this module.
import { PDFDocument } from 'pdf-lib';
import { PRODUCER } from './buildPdf';

export type PageSizeOption = 'fit' | 'a4' | 'letter';
export type OrientationOption = 'auto' | 'portrait' | 'landscape';

export interface ImagesToPdfOptions {
  pageSize: PageSizeOption;
  orientation: OrientationOption;
  /** Margin in points (ignored for "fit"). */
  margin: number;
}

export interface ImageInput {
  name: string;
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
}

const SIZES: Record<Exclude<PageSizeOption, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Page size and image placement for one image. Pure function (unit tested). */
export function layoutImage(
  imageWidth: number,
  imageHeight: number,
  options: ImagesToPdfOptions,
): { pageWidth: number; pageHeight: number; x: number; y: number; width: number; height: number } {
  if (options.pageSize === 'fit') {
    // 1 image pixel = 1 point (96 dpi images print at 72 dpi… users can scale when printing).
    return {
      pageWidth: imageWidth,
      pageHeight: imageHeight,
      x: 0,
      y: 0,
      width: imageWidth,
      height: imageHeight,
    };
  }
  let [pageWidth, pageHeight] = SIZES[options.pageSize];
  const landscape =
    options.orientation === 'landscape' ||
    (options.orientation === 'auto' && imageWidth > imageHeight);
  if (landscape) [pageWidth, pageHeight] = [pageHeight, pageWidth];
  const margin = Math.max(0, Math.min(options.margin, Math.min(pageWidth, pageHeight) / 3));
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight, 1e6);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}

export async function imagesToPdf(
  images: ImageInput[],
  options: ImagesToPdfOptions,
): Promise<Uint8Array> {
  if (!images.length) throw new Error('No images to convert.');
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const input of images) {
    let image;
    try {
      image =
        input.mime === 'image/png'
          ? await doc.embedPng(input.bytes)
          : await doc.embedJpg(input.bytes);
    } catch (error) {
      throw new Error(
        `"${input.name}" could not be read as ${input.mime === 'image/png' ? 'PNG' : 'JPEG'}: ${(error as Error).message}`,
        { cause: error },
      );
    }
    const layout = layoutImage(image.width, image.height, options);
    const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
    page.drawImage(image, { x: layout.x, y: layout.y, width: layout.width, height: layout.height });
  }
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
  return doc.save({ useObjectStreams: true });
}
