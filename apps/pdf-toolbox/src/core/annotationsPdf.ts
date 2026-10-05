// Draws workspace annotations permanently into PDF page content with pdf-lib.
import {
  BlendMode,
  concatTransformationMatrix,
  LineCapStyle,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { uprightSize } from './geometry';
import { LINE_HEIGHT, TEXT_PADDING, wrapText } from './textLayout';
import type {
  Annotation,
  EmbeddedImage,
  FontFamily,
  Rotation,
  StampAnnotation,
  TextAnnotation,
} from './types';

export function hexToRgb(hex: string): RGB {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return rgb(0, 0, 0);
  let value = match[1];
  if (value.length === 3)
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(value, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const FONT_MAP: Record<FontFamily, [StandardFonts, StandardFonts]> = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};

/** Per-document caches so fonts and images are embedded only once. */
export class DrawContext {
  readonly doc: PDFDocument;
  readonly images: Map<string, EmbeddedImage>;
  readonly warnings = new Set<string>();
  private fonts = new Map<string, PDFFont>();
  private embedded = new Map<string, PDFImage>();

  constructor(doc: PDFDocument, images: Map<string, EmbeddedImage>) {
    this.doc = doc;
    this.images = images;
  }

  async font(family: FontFamily, bold: boolean): Promise<PDFFont> {
    const name = FONT_MAP[family][bold ? 1 : 0];
    let font = this.fonts.get(name);
    if (!font) {
      font = await this.doc.embedFont(name);
      this.fonts.set(name, font);
    }
    return font;
  }

  async image(id: string): Promise<PDFImage | null> {
    const cached = this.embedded.get(id);
    if (cached) return cached;
    const source = this.images.get(id);
    if (!source) return null;
    const image =
      source.mime === 'image/png'
        ? await this.doc.embedPng(source.bytes)
        : await this.doc.embedJpg(source.bytes);
    this.embedded.set(id, image);
    return image;
  }

  /** Standard PDF fonts only cover Windows-1252 characters; replace anything else. */
  sanitize(font: PDFFont, text: string): string {
    const supported = new Set(font.getCharacterSet());
    let replaced = false;
    const out = Array.from(text)
      .map((ch) => {
        if (ch === '\n' || supported.has(ch.codePointAt(0)!)) return ch;
        replaced = true;
        return '?';
      })
      .join('');
    if (replaced) {
      this.warnings.add(
        'Some characters in text annotations are not available in the standard PDF fonts and were replaced with "?".',
      );
    }
    return out;
  }
}

interface Frame {
  /** Crop box origin and height, to convert page space (y-down) to PDF user space (y-up). */
  cropX: number;
  cropY: number;
  cropHeight: number;
}

const toPdf = (frame: Frame, x: number, y: number): [number, number] => [
  frame.cropX + x,
  frame.cropY + frame.cropHeight - y,
];

/**
 * Runs `draw` in a local coordinate system for a rotated box: origin at the bottom-left of the
 * box as seen upright (when the page is viewed at `rotation`), y up, units in points.
 */
function withUprightBox(
  page: PDFPage,
  frame: Frame,
  box: { x: number; y: number; w: number; h: number },
  rotation: Rotation,
  draw: (width: number, height: number) => void,
) {
  const { width, height } = uprightSize(box, rotation);
  const [cx, cy] = toPdf(frame, box.x + box.w / 2, box.y + box.h / 2);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // CTM = T(center) · R(rotation, counter-clockwise) · T(-width/2, -height/2)
  const e = cx + (-width / 2) * cos - (-height / 2) * sin;
  const f = cy + (-width / 2) * sin + (-height / 2) * cos;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, e, f));
  draw(width, height);
  page.pushOperators(popGraphicsState());
}

async function drawText(page: PDFPage, frame: Frame, ctx: DrawContext, a: TextAnnotation) {
  const font = await ctx.font(a.font, a.bold);
  const text = ctx.sanitize(font, a.text);
  withUprightBox(page, frame, a, a.rotation, (width, height) => {
    if (a.background) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: hexToRgb(a.background),
        opacity: a.opacity,
      });
    }
    const lines = wrapText(text, width - TEXT_PADDING * 2, (t) =>
      font.widthOfTextAtSize(t, a.fontSize),
    );
    lines.forEach((line, i) => {
      if (!line) return;
      const lineWidth = font.widthOfTextAtSize(line, a.fontSize);
      const x =
        a.align === 'center'
          ? (width - lineWidth) / 2
          : a.align === 'right'
            ? width - TEXT_PADDING - lineWidth
            : TEXT_PADDING;
      const y = height - TEXT_PADDING - a.fontSize * 0.8 - i * a.fontSize * LINE_HEIGHT;
      page.drawText(line, {
        x,
        y,
        size: a.fontSize,
        font,
        color: hexToRgb(a.color),
        opacity: a.opacity,
      });
    });
  });
}

export function stampFontSize(
  text: string,
  width: number,
  height: number,
  measureAt1: (t: string) => number,
): number {
  const byHeight = height * 0.5;
  const byWidth = (width - 16) / Math.max(1, measureAt1(text));
  return Math.max(4, Math.min(byHeight, byWidth));
}

async function drawStamp(page: PDFPage, frame: Frame, ctx: DrawContext, a: StampAnnotation) {
  const font = await ctx.font('Helvetica', true);
  const text = ctx.sanitize(font, a.text.toUpperCase());
  const color = hexToRgb(a.color);
  withUprightBox(page, frame, a, a.rotation, (width, height) => {
    const border = Math.max(1.5, Math.min(width, height) * 0.06);
    page.drawRectangle({
      x: border / 2,
      y: border / 2,
      width: width - border,
      height: height - border,
      borderColor: color,
      borderWidth: border,
      borderOpacity: a.opacity,
    });
    const size = stampFontSize(text, width, height, (t) => font.widthOfTextAtSize(t, 1));
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: height / 2 - size * 0.35,
      size,
      font,
      color,
      opacity: a.opacity,
    });
  });
}

function strokePath(points: number[]): string {
  let d = '';
  for (let i = 0; i < points.length; i += 2)
    d += `${i === 0 ? 'M' : 'L'}${points[i].toFixed(2)} ${points[i + 1].toFixed(2)} `;
  if (points.length === 2) d += `L${(points[0] + 0.01).toFixed(2)} ${points[1].toFixed(2)}`;
  return d.trim();
}

export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineWidth: number,
): number[] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.max(8, lineWidth * 4);
  const spread = Math.PI / 7;
  return [
    x2,
    y2,
    x2 - length * Math.cos(angle - spread),
    y2 - length * Math.sin(angle - spread),
    x2 - length * Math.cos(angle + spread),
    y2 - length * Math.sin(angle + spread),
  ];
}

/** Draws one annotation into `page`. */
export async function drawAnnotation(page: PDFPage, ctx: DrawContext, annotation: Annotation) {
  const crop = page.getCropBox();
  const frame: Frame = { cropX: crop.x, cropY: crop.y, cropHeight: crop.height };
  const svgOrigin = { x: frame.cropX, y: frame.cropY + frame.cropHeight };
  const a = annotation;
  switch (a.type) {
    case 'text':
      await drawText(page, frame, ctx, a);
      return;
    case 'stamp':
      await drawStamp(page, frame, ctx, a);
      return;
    case 'image': {
      const image = await ctx.image(a.imageId);
      if (!image) {
        ctx.warnings.add('An inserted image could not be found and was skipped.');
        return;
      }
      withUprightBox(page, frame, a, a.rotation, (width, height) => {
        page.drawImage(image, { x: 0, y: 0, width, height, opacity: a.opacity });
      });
      return;
    }
    case 'rect':
    case 'ellipse':
    case 'highlight':
    case 'whiteout':
    case 'redact': {
      const [x, yTop] = toPdf(frame, a.x, a.y);
      const y = yTop - a.h;
      if (a.type === 'ellipse') {
        page.drawEllipse({
          x: x + a.w / 2,
          y: y + a.h / 2,
          xScale: a.w / 2,
          yScale: a.h / 2,
          color: a.fill ? hexToRgb(a.fill) : undefined,
          opacity: a.opacity,
          borderColor: a.stroke ? hexToRgb(a.stroke) : undefined,
          borderWidth: a.stroke ? a.lineWidth : 0,
          borderOpacity: a.opacity,
        });
      } else if (a.type === 'rect') {
        page.drawRectangle({
          x,
          y,
          width: a.w,
          height: a.h,
          color: a.fill ? hexToRgb(a.fill) : undefined,
          opacity: a.opacity,
          borderColor: a.stroke ? hexToRgb(a.stroke) : undefined,
          borderWidth: a.stroke ? a.lineWidth : 0,
          borderOpacity: a.opacity,
        });
      } else if (a.type === 'highlight') {
        page.drawRectangle({
          x,
          y,
          width: a.w,
          height: a.h,
          color: hexToRgb(a.color),
          opacity: a.opacity,
          blendMode: BlendMode.Multiply,
        });
      } else if (a.type === 'whiteout') {
        page.drawRectangle({ x, y, width: a.w, height: a.h, color: hexToRgb(a.color), opacity: 1 });
      } else {
        page.drawRectangle({ x, y, width: a.w, height: a.h, color: rgb(0, 0, 0), opacity: 1 });
      }
      return;
    }
    case 'line':
    case 'arrow': {
      const color = hexToRgb(a.stroke);
      const [x1, y1] = toPdf(frame, a.x1, a.y1);
      let [x2, y2] = toPdf(frame, a.x2, a.y2);
      if (a.type === 'arrow') {
        // Stop the shaft inside the head so the tip stays sharp.
        const head = arrowHead(a.x1, a.y1, a.x2, a.y2, a.lineWidth);
        const back = Math.max(8, a.lineWidth * 4) * 0.8;
        const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        [x2, y2] = toPdf(frame, a.x2 - back * Math.cos(angle), a.y2 - back * Math.sin(angle));
        page.drawSvgPath(`M${head[0]} ${head[1]} L${head[2]} ${head[3]} L${head[4]} ${head[5]} Z`, {
          ...svgOrigin,
          color,
          opacity: a.opacity,
          borderWidth: 0,
        });
      }
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: a.lineWidth,
        color,
        opacity: a.opacity,
        lineCap: LineCapStyle.Round,
      });
      return;
    }
    case 'ink': {
      const color = hexToRgb(a.stroke);
      for (const stroke of a.strokes) {
        if (stroke.length < 2) continue;
        page.drawSvgPath(strokePath(stroke), {
          ...svgOrigin,
          borderColor: color,
          borderWidth: a.lineWidth,
          borderOpacity: a.opacity,
          borderLineCap: LineCapStyle.Round,
        });
      }
      return;
    }
  }
}
