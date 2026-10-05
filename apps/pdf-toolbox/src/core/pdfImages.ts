// Decoding of PDF image XObjects for image extraction and optimisation. Supports the common
// cases: JPEG (DCTDecode, passed through) and Flate/LZW/RunLength images with 8 bits per
// component in DeviceGray, DeviceRGB, ICCBased (1 or 3 components) or Indexed colour spaces,
// including PNG predictors. Anything else (JPEG 2000, JBIG2, CCITT, CMYK, 16-bit, image masks)
// is reported as unsupported rather than guessed.
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';

export type DecodedImage =
  | { kind: 'jpeg'; bytes: Uint8Array; width: number; height: number; components: number }
  | { kind: 'rgba'; data: Uint8ClampedArray; width: number; height: number; hasAlpha: boolean };

export interface ImageXObject {
  ref: PDFRef;
  stream: PDFRawStream;
  width: number;
  height: number;
}

function filters(dict: PDFDict): string[] {
  const filter = dict.get(PDFName.of('Filter'));
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray)
    return filter.asArray().map((f) => (f instanceof PDFName ? f.decodeText() : ''));
  return [];
}

function num(context: PDFContext, value: PDFObject | undefined): number | undefined {
  const resolved = value ? context.lookup(value) : undefined;
  return resolved instanceof PDFNumber ? resolved.asNumber() : undefined;
}

/** All image XObjects in a document. */
export function findImageXObjects(context: PDFContext): ImageXObject[] {
  const out: ImageXObject[] = [];
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const width = num(context, dict.get(PDFName.of('Width')));
    const height = num(context, dict.get(PDFName.of('Height')));
    if (!width || !height) continue;
    out.push({ ref, stream: object, width, height });
  }
  return out;
}

/** Image XObject refs used (directly or via form XObjects) by a page's resources. */
export function pageImageRefs(
  context: PDFContext,
  resources: PDFDict | undefined,
  seen = new Set<string>(),
): PDFRef[] {
  const refs: PDFRef[] = [];
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) return refs;
  for (const [, value] of xobjects.entries()) {
    if (!(value instanceof PDFRef) || seen.has(value.toString())) continue;
    seen.add(value.toString());
    const object = context.lookup(value);
    if (!(object instanceof PDFStream)) continue;
    const subtype = object.dict.get(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Image')) refs.push(value);
    else if (subtype === PDFName.of('Form')) {
      refs.push(
        ...pageImageRefs(context, object.dict.lookupMaybe(PDFName.of('Resources'), PDFDict), seen),
      );
    }
  }
  return refs;
}

interface ColorInfo {
  components: number;
  /** For Indexed: RGB palette and base component count. */
  palette?: Uint8Array;
  paletteComponents?: number;
}

function colorInfo(context: PDFContext, value: PDFObject | undefined): ColorInfo | null {
  const cs = value ? context.lookup(value) : undefined;
  if (cs instanceof PDFName) {
    const name = cs.decodeText();
    if (name === 'DeviceGray' || name === 'CalGray') return { components: 1 };
    if (name === 'DeviceRGB' || name === 'CalRGB') return { components: 3 };
    return null;
  }
  if (cs instanceof PDFArray) {
    const kind = cs.lookup(0);
    if (!(kind instanceof PDFName)) return null;
    const name = kind.decodeText();
    if (name === 'ICCBased') {
      const stream = cs.lookup(1);
      const n =
        stream instanceof PDFStream ? num(context, stream.dict.get(PDFName.of('N'))) : undefined;
      return n === 1 || n === 3 ? { components: n } : null;
    }
    if (name === 'CalRGB') return { components: 3 };
    if (name === 'CalGray') return { components: 1 };
    if (name === 'Indexed') {
      const base = colorInfo(context, cs.get(1));
      if (!base || base.palette) return null;
      const lookup = cs.lookup(3);
      let palette: Uint8Array | null = null;
      if (lookup instanceof PDFString || lookup instanceof PDFHexString) palette = lookup.asBytes();
      else if (lookup instanceof PDFRawStream) palette = decodePDFRawStream(lookup).decode();
      if (!palette) return null;
      return { components: 1, palette, paletteComponents: base.components };
    }
  }
  return null;
}

/** Reverses PNG predictors (DecodeParms /Predictor ≥ 10) or TIFF predictor 2. */
export function unpredict(
  data: Uint8Array,
  predictor: number,
  colors: number,
  bpc: number,
  columns: number,
): Uint8Array {
  if (predictor < 2) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLength = Math.ceil((colors * bpc * columns) / 8);
  if (predictor === 2) {
    if (bpc !== 8) throw new Error('TIFF predictor with this bit depth is not supported');
    const out = new Uint8Array(data);
    for (let row = 0; row * rowLength < out.length; row++) {
      const start = row * rowLength;
      for (let i = bpp; i < rowLength && start + i < out.length; i++)
        out[start + i] = (out[start + i] + out[start + i - bpp]) & 0xff;
    }
    return out;
  }
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let previous = new Uint8Array(rowLength);
  for (let row = 0; row < rows; row++) {
    const type = data[row * (rowLength + 1)];
    const line = data.subarray(row * (rowLength + 1) + 1, (row + 1) * (rowLength + 1));
    const current = out.subarray(row * rowLength, (row + 1) * rowLength);
    for (let i = 0; i < rowLength; i++) {
      const left = i >= bpp ? current[i - bpp] : 0;
      const up = previous[i];
      const upLeft = i >= bpp ? previous[i - bpp] : 0;
      let value = line[i];
      switch (type) {
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
      }
      current[i] = value & 0xff;
    }
    previous = current;
  }
  return out;
}

export type DecodeResult = { ok: true; image: DecodedImage } | { ok: false; reason: string };

/** Decodes an image XObject into JPEG bytes (passthrough) or RGBA pixels. */
export function decodeImageXObject(context: PDFContext, stream: PDFRawStream): DecodeResult {
  const dict = stream.dict;
  const width = num(context, dict.get(PDFName.of('Width'))) ?? 0;
  const height = num(context, dict.get(PDFName.of('Height'))) ?? 0;
  if (dict.get(PDFName.of('ImageMask'))?.toString() === 'true')
    return { ok: false, reason: 'image mask' };
  const decode = dict.lookupMaybe(PDFName.of('Decode'), PDFArray);
  if (decode) {
    // Only the default mapping ([0 1 0 1 …]) is supported; inverted samples are reported.
    const values = decode.asArray().map((v) => num(context, v));
    if (!values.every((v, i) => v === (i % 2 === 0 ? 0 : 1)))
      return { ok: false, reason: 'custom decode array' };
  }
  const list = filters(dict);
  const last = list[list.length - 1];
  if (['JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode'].includes(last))
    return { ok: false, reason: last };
  const color = colorInfo(context, dict.get(PDFName.of('ColorSpace')));

  if (last === 'DCTDecode') {
    if (list.length > 1) return { ok: false, reason: 'chained JPEG filters' };
    if (color && (color.components === 1 || color.components === 3) && !color.palette) {
      return {
        ok: true,
        image: {
          kind: 'jpeg',
          bytes: stream.contents,
          width,
          height,
          components: color.components,
        },
      };
    }
    return { ok: false, reason: 'CMYK or unusual JPEG colour space' };
  }
  if (!color) return { ok: false, reason: 'unsupported colour space' };
  const bpc = num(context, dict.get(PDFName.of('BitsPerComponent'))) ?? 8;
  if (bpc !== 8 && !(color.palette && (bpc === 1 || bpc === 2 || bpc === 4)))
    return { ok: false, reason: `${bpc}-bit samples` };

  let data: Uint8Array;
  try {
    data = list.length ? decodePDFRawStream(stream).decode() : stream.contents;
  } catch (error) {
    return { ok: false, reason: `cannot decode (${(error as Error).message})` };
  }
  const parms = dict.lookupMaybe(PDFName.of('DecodeParms'), PDFDict);
  const predictor = parms ? (num(context, parms.get(PDFName.of('Predictor'))) ?? 1) : 1;
  if (predictor > 1) {
    try {
      data = unpredict(data, predictor, color.components, bpc, width);
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (color.palette) {
    const pc = color.paletteComponents ?? 3;
    const rowBytes = Math.ceil((width * bpc) / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bitOffset = x * bpc;
        const byte = data[y * rowBytes + (bitOffset >> 3)] ?? 0;
        const index = bpc === 8 ? byte : (byte >> (8 - bpc - (bitOffset & 7))) & ((1 << bpc) - 1);
        const o = (y * width + x) * 4;
        if (pc === 3) {
          rgba[o] = color.palette[index * 3] ?? 0;
          rgba[o + 1] = color.palette[index * 3 + 1] ?? 0;
          rgba[o + 2] = color.palette[index * 3 + 2] ?? 0;
        } else {
          rgba[o] = rgba[o + 1] = rgba[o + 2] = color.palette[index] ?? 0;
        }
        rgba[o + 3] = 255;
      }
    }
  } else {
    const n = color.components;
    if (data.length < width * height * n) return { ok: false, reason: 'truncated image data' };
    for (let i = 0, p = 0; i < width * height; i++, p += n) {
      const o = i * 4;
      if (n === 3) {
        rgba[o] = data[p];
        rgba[o + 1] = data[p + 1];
        rgba[o + 2] = data[p + 2];
      } else {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = data[p];
      }
      rgba[o + 3] = 255;
    }
  }
  // Soft mask (alpha channel), if it is a plain 8-bit gray image of the same size.
  let hasAlpha = false;
  const smask = dict.lookupMaybe(PDFName.of('SMask'), PDFStream);
  if (smask instanceof PDFRawStream) {
    const mask = decodeImageXObject(context, smask);
    if (
      mask.ok &&
      mask.image.kind === 'rgba' &&
      mask.image.width === width &&
      mask.image.height === height
    ) {
      for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = mask.image.data[i * 4];
      hasAlpha = true;
    }
  }
  return { ok: true, image: { kind: 'rgba', data: rgba, width, height, hasAlpha } };
}
