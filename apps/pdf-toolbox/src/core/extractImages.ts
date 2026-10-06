// Extraction of embedded raster images from selected pages.
import type { PDFDocument } from 'pdf-lib';
import { PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import { decodeImageXObject, pageImageRefs, type DecodedImage } from './pdfImages';

export interface ExtractedImage {
  pageNumber: number;
  index: number;
  image: DecodedImage;
}

export interface ExtractImagesResult {
  images: ExtractedImage[];
  unsupported: Array<{ pageNumber: number; reason: string }>;
}

/** `pages` are 0-based indices into `doc`; the reported page numbers are 1-based labels. */
export function extractImages(
  doc: PDFDocument,
  pages: Array<{ index: number; label: number }>,
): ExtractImagesResult {
  const images: ExtractedImage[] = [];
  const unsupported: ExtractImagesResult['unsupported'] = [];
  const seen = new Set<string>();
  for (const { index, label } of pages) {
    const page = doc.getPage(index);
    const resources =
      page.node.Resources() ?? page.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
    let count = 0;
    for (const ref of pageImageRefs(doc.context, resources)) {
      if (seen.has(ref.toString())) continue;
      seen.add(ref.toString());
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const decoded = decodeImageXObject(doc.context, stream);
      if (decoded.ok) images.push({ pageNumber: label, index: ++count, image: decoded.image });
      else unsupported.push({ pageNumber: label, reason: decoded.reason });
    }
  }
  return { images, unsupported };
}
