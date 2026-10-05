// "Reduce file size": image downsampling/recompression plus structural clean-up. Browser-based
// optimisation is simpler than Acrobat's optimiser; results depend heavily on the document.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';
import { decodeImageXObject, findImageXObjects, type DecodedImage } from './pdfImages';
import { loadPdfLib, PRODUCER } from './buildPdf';

export type OptimizePreset = 'high' | 'balanced' | 'small';

export const PRESETS: Record<
  OptimizePreset,
  {
    label: string;
    maxDimension: number;
    quality: number;
    recompressLossless: boolean;
    description: string;
  }
> = {
  high: {
    label: 'High quality',
    maxDimension: 2600,
    quality: 0.85,
    recompressLossless: false,
    description: 'Only very large photos are downsampled; lossless images are kept.',
  },
  balanced: {
    label: 'Balanced',
    maxDimension: 1700,
    quality: 0.72,
    recompressLossless: true,
    description: 'Good for on-screen reading and normal printing.',
  },
  small: {
    label: 'Smaller file',
    maxDimension: 1100,
    quality: 0.55,
    recompressLossless: true,
    description: 'Strong compression; fine detail in images may be lost.',
  },
};

/** Re-encodes a decoded image as JPEG at the given size. Implemented with canvas in the browser. */
export type JpegEncoder = (
  image: DecodedImage,
  width: number,
  height: number,
  quality: number,
) => Promise<Uint8Array>;

export interface OptimizeOptions {
  preset: OptimizePreset;
  removeMetadata: boolean;
  encodeJpeg: JpegEncoder;
  onProgress?: (done: number, total: number) => void;
}

export interface OptimizeResult {
  bytes: Uint8Array;
  before: number;
  after: number;
  imagesRecompressed: number;
  imagesKept: number;
  imagesUnsupported: number;
  objectsRemoved: number;
  streamsCompressed: number;
}

/** Deletes objects that cannot be reached from the document trailer (orphans, old revisions). */
export function removeUnreachableObjects(context: PDFContext): number {
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const entry of [Root, Info, Encrypt]) if (entry) stack.push(entry);
  while (stack.length) {
    const object = stack.pop()!;
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(object);
      if (target) stack.push(target);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) stack.push(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) stack.push(value);
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    }
  }
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      context.delete(ref);
      removed++;
    }
  }
  return removed;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Flate-compresses streams that are stored without any filter. */
async function compressPlainStreams(context: PDFContext): Promise<number> {
  let count = 0;
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.has(PDFName.of('Filter'))) continue;
    if (object.contents.length < 256) continue;
    const compressed = await deflate(object.contents);
    if (!compressed || compressed.length >= object.contents.length * 0.9) continue;
    const dict = object.dict.clone(context);
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
    context.assign(ref, PDFRawStream.of(dict, compressed));
    count++;
  }
  return count;
}

export function targetSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function optimizePdf(
  input: Uint8Array,
  options: OptimizeOptions,
): Promise<OptimizeResult> {
  const preset = PRESETS[options.preset];
  const doc = await loadPdfLib(input);
  const context = doc.context;
  let recompressed = 0;
  let kept = 0;
  let unsupported = 0;

  const images = findImageXObjects(context);
  for (let i = 0; i < images.length; i++) {
    options.onProgress?.(i, images.length);
    const { ref, stream, width, height } = images[i];
    // Skip soft masks themselves (they are referenced via /SMask from colour images).
    const isMask = images.some((other) => other.stream.dict.get(PDFName.of('SMask')) === ref);
    if (isMask) {
      kept++;
      continue;
    }
    const decoded = decodeImageXObject(context, stream);
    if (!decoded.ok) {
      unsupported++;
      continue;
    }
    const image = decoded.image;
    const target = targetSize(width, height, preset.maxDimension);
    const downscale = target.width < width;
    if (image.kind === 'rgba' && !preset.recompressLossless && !downscale) {
      kept++;
      continue;
    }
    if (width * height < 64 * 64) {
      kept++;
      continue;
    }
    let jpeg: Uint8Array;
    try {
      // JPEG has no alpha: the soft mask (if any) stays attached to the image dictionary.
      const opaque: DecodedImage =
        image.kind === 'rgba'
          ? {
              ...image,
              data: image.data.map((v, idx) => (idx % 4 === 3 ? 255 : v)) as Uint8ClampedArray,
              hasAlpha: false,
            }
          : image;
      jpeg = await options.encodeJpeg(opaque, target.width, target.height, preset.quality);
    } catch {
      unsupported++;
      continue;
    }
    if (jpeg.length >= stream.contents.length * 0.9) {
      kept++;
      continue;
    }
    const dict = stream.dict.clone(context);
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    dict.delete(PDFName.of('DecodeParms'));
    dict.set(PDFName.of('Width'), PDFNumber.of(target.width));
    dict.set(PDFName.of('Height'), PDFNumber.of(target.height));
    dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
    dict.set(
      PDFName.of('ColorSpace'),
      PDFName.of(image.kind === 'jpeg' && image.components === 1 ? 'DeviceGray' : 'DeviceRGB'),
    );
    dict.set(PDFName.of('Length'), PDFNumber.of(jpeg.length));
    context.assign(ref, PDFRawStream.of(dict, jpeg));
    recompressed++;
  }
  options.onProgress?.(images.length, images.length);

  if (options.removeMetadata) stripMetadata(doc);
  const objectsRemoved = removeUnreachableObjects(context);
  const streamsCompressed = await compressPlainStreams(context);
  doc.setProducer(PRODUCER);
  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  return {
    bytes,
    before: input.length,
    after: bytes.length,
    imagesRecompressed: recompressed,
    imagesKept: kept,
    imagesUnsupported: unsupported,
    objectsRemoved,
    streamsCompressed,
  };
}

/** Removes XMP metadata and document information (title, author, …). */
export function stripMetadata(doc: PDFDocument) {
  doc.catalog.delete(PDFName.of('Metadata'));
  const info = doc.context.trailerInfo.Info;
  const dict = info ? doc.context.lookup(info) : undefined;
  if (dict instanceof PDFDict) {
    for (const key of dict.keys()) dict.delete(key);
  }
  doc.catalog.delete(PDFName.of('PieceInfo'));
}

export { PDFDocument };
