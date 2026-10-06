// Coordinate conversions between page space (unrotated, y-down, points) and view space
// (the page as displayed after rotation, y-down, points).
import type {
  Annotation,
  Box,
  BoxAnnotation,
  InkAnnotation,
  LineAnnotation,
  Rotation,
} from './types';

export const isLine = (a: Annotation): a is LineAnnotation =>
  a.type === 'line' || a.type === 'arrow';
export const isInk = (a: Annotation): a is InkAnnotation => a.type === 'ink';
export const isBox = (a: Annotation): a is BoxAnnotation => !isLine(a) && !isInk(a);

export interface Point {
  x: number;
  y: number;
}

export function viewSize(
  width: number,
  height: number,
  rotation: Rotation,
): { width: number; height: number } {
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
}

export function pageToView(p: Point, width: number, height: number, rotation: Rotation): Point {
  switch (rotation) {
    case 90:
      return { x: height - p.y, y: p.x };
    case 180:
      return { x: width - p.x, y: height - p.y };
    case 270:
      return { x: p.y, y: width - p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

export function viewToPage(p: Point, width: number, height: number, rotation: Rotation): Point {
  switch (rotation) {
    case 90:
      return { x: p.y, y: height - p.x };
    case 180:
      return { x: width - p.x, y: height - p.y };
    case 270:
      return { x: width - p.y, y: p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

export function normalizeBox(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function boxPageToView(box: Box, width: number, height: number, rotation: Rotation): Box {
  return normalizeBox(
    pageToView({ x: box.x, y: box.y }, width, height, rotation),
    pageToView({ x: box.x + box.w, y: box.y + box.h }, width, height, rotation),
  );
}

export function boxViewToPage(box: Box, width: number, height: number, rotation: Rotation): Box {
  return normalizeBox(
    viewToPage({ x: box.x, y: box.y }, width, height, rotation),
    viewToPage({ x: box.x + box.w, y: box.y + box.h }, width, height, rotation),
  );
}

/** Bounding box of any annotation in page space. */
export function annotationBounds(annotation: Annotation): Box {
  if (isLine(annotation)) {
    const pad = annotation.lineWidth * 2;
    const box = normalizeBox(
      { x: annotation.x1, y: annotation.y1 },
      { x: annotation.x2, y: annotation.y2 },
    );
    return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  }
  if (isInk(annotation)) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const stroke of annotation.strokes) {
      for (let i = 0; i < stroke.length; i += 2) {
        minX = Math.min(minX, stroke[i]);
        maxX = Math.max(maxX, stroke[i]);
        minY = Math.min(minY, stroke[i + 1]);
        maxY = Math.max(maxY, stroke[i + 1]);
      }
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    const pad = annotation.lineWidth;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  const box = annotation as BoxAnnotation;
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

/** Moves an annotation by (dx, dy) in page space. */
export function translateAnnotation<T extends Annotation>(
  annotation: T,
  dx: number,
  dy: number,
): T {
  if (isLine(annotation)) {
    return {
      ...annotation,
      x1: annotation.x1 + dx,
      y1: annotation.y1 + dy,
      x2: annotation.x2 + dx,
      y2: annotation.y2 + dy,
    };
  }
  if (isInk(annotation)) {
    return {
      ...annotation,
      strokes: annotation.strokes.map((s) => s.map((v, i) => v + (i % 2 === 0 ? dx : dy))),
    };
  }
  const box = annotation as BoxAnnotation;
  return { ...annotation, x: box.x + dx, y: box.y + dy };
}

/** Scales an annotation from one bounding box to another (page space). */
export function resizeAnnotation<T extends Annotation>(annotation: T, from: Box, to: Box): T {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const mx = (x: number) => to.x + (x - from.x) * sx;
  const my = (y: number) => to.y + (y - from.y) * sy;
  if (isLine(annotation)) {
    return {
      ...annotation,
      x1: mx(annotation.x1),
      y1: my(annotation.y1),
      x2: mx(annotation.x2),
      y2: my(annotation.y2),
    };
  }
  if (isInk(annotation)) {
    return {
      ...annotation,
      strokes: annotation.strokes.map((s) => s.map((v, i) => (i % 2 === 0 ? mx(v) : my(v)))),
    };
  }
  return { ...annotation, x: to.x, y: to.y, w: to.w, h: to.h };
}

/** Upright content size of a rotated box: the box as the user sees it when created. */
export function uprightSize(box: Box, rotation: Rotation): { width: number; height: number } {
  return rotation % 180 === 0 ? { width: box.w, height: box.h } : { width: box.h, height: box.w };
}
