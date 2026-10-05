// Workspace model of PDF Toolbox. Pages reference pages of loaded source documents; edits are
// kept as data (rotation, annotations, form values) and only applied when exporting, so the
// original files are never modified.

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Annotation geometry uses "page space": points, origin at the top-left of the page's crop box,
 * y pointing down, *before* any page rotation. This keeps annotations attached to the content
 * when pages are rotated.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';
export type TextAlign = 'left' | 'center' | 'right';

interface Base {
  id: string;
  opacity: number;
}

export interface TextAnnotation extends Base, Box {
  type: 'text';
  /** Page rotation when created: the text is upright when the page is viewed at this rotation. */
  rotation: Rotation;
  text: string;
  fontSize: number;
  font: FontFamily;
  bold: boolean;
  color: string;
  align: TextAlign;
  /** Optional box fill (e.g. white to cover text being replaced). */
  background: string | null;
}

export interface StampAnnotation extends Base, Box {
  type: 'stamp';
  rotation: Rotation;
  text: string;
  color: string;
}

export interface ImageAnnotation extends Base, Box {
  type: 'image';
  rotation: Rotation;
  imageId: string;
  /** Inserted as a (visual) signature. */
  signature?: boolean;
}

export interface ShapeAnnotation extends Base, Box {
  type: 'rect' | 'ellipse';
  stroke: string | null;
  fill: string | null;
  lineWidth: number;
}

export interface HighlightAnnotation extends Base, Box {
  type: 'highlight';
  color: string;
}

/** Visual cover only — the content underneath remains in the file. */
export interface WhiteoutAnnotation extends Base, Box {
  type: 'whiteout';
  color: string;
}

/** Secure redaction mark: pages containing these are rasterised on export. */
export interface RedactAnnotation extends Base, Box {
  type: 'redact';
}

export interface LineAnnotation extends Base {
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  lineWidth: number;
}

export interface InkAnnotation extends Base {
  type: 'ink';
  /** Each stroke is a flat list [x0, y0, x1, y1, …] in page space. */
  strokes: number[][];
  stroke: string;
  lineWidth: number;
}

export type BoxAnnotation =
  | TextAnnotation
  | StampAnnotation
  | ImageAnnotation
  | ShapeAnnotation
  | HighlightAnnotation
  | WhiteoutAnnotation
  | RedactAnnotation;

export type Annotation = BoxAnnotation | LineAnnotation | InkAnnotation;
export type AnnotationType = Annotation['type'];

export interface PageSize {
  /** Crop box width/height in points (unrotated). */
  width: number;
  height: number;
}

export interface WorkspacePage {
  id: string;
  sourceId: string;
  /** Zero-based page index within the source document. */
  sourceIndex: number;
  /** /Rotate of the original page. */
  baseRotation: Rotation;
  /** Additional rotation applied by the user. */
  rotation: Rotation;
  size: PageSize;
  annotations: Annotation[];
}

export type FormFieldType =
  'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist' | 'button' | 'signature' | 'unknown';
export type FormValue = string | boolean | string[];

export interface FormFieldInfo {
  name: string;
  type: FormFieldType;
  value: FormValue;
  options: string[];
  readOnly: boolean;
  multiline: boolean;
  required: boolean;
}

export interface SourceInfo {
  id: string;
  name: string;
  pageCount: number;
  byteLength: number;
  formFields: FormFieldInfo[];
}

export interface EmbeddedImage {
  id: string;
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

export function effectiveRotation(
  page: Pick<WorkspacePage, 'baseRotation' | 'rotation'>,
): Rotation {
  return ((((page.baseRotation + page.rotation) % 360) + 360) % 360) as Rotation;
}

export function normalizeRotation(value: number): Rotation {
  return ((((Math.round(value / 90) * 90) % 360) + 360) % 360) as Rotation;
}
