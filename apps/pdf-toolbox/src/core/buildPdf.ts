// Export pipeline: turns the workspace (page list + edits) into a brand-new PDF.
//
// A new document is always created and only the pages in the workspace are copied into it.
// pdf-lib writes every object of a loaded document when saving, so editing the original in
// place would leave deleted pages (and their content) inside the file.
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFRef,
  PDFBool,
  PDFHexString,
  type PDFPage,
} from 'pdf-lib';
import { applyFormValues } from './forms';
import { DrawContext, drawAnnotation } from './annotationsPdf';
import { boxPageToView } from './geometry';
import {
  effectiveRotation,
  type Box,
  type EmbeddedImage,
  type FormValue,
  type WorkspacePage,
} from './types';

export const PRODUCER = 'Offline Toolbox — PDF Toolbox (pdf-lib)';

export class EncryptedPdfError extends Error {
  constructor(name: string) {
    super(
      `"${name}" is encrypted (password-protected or permission-restricted). PDF Toolbox cannot modify encrypted PDFs. If you are entitled to, remove the protection with the software that created it and try again.`,
    );
    this.name = 'EncryptedPdfError';
  }
}

export async function loadPdfLib(bytes: Uint8Array, name = 'document'): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
  } catch (error) {
    throw new Error(`"${name}" could not be read as a PDF: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (doc.isEncrypted) throw new EncryptedPdfError(name);
  return doc;
}

/** Renders whole pages to images; used to make redactions irreversible. Provided by the UI (pdf.js). */
export type PageRasterizer = (
  pdfBytes: Uint8Array,
  pages: Array<{ index: number; redactions: Box[] }>,
) => Promise<Map<number, { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' }>>;

export interface BuildInput {
  pages: WorkspacePage[];
  sources: Map<string, { name: string; bytes: Uint8Array }>;
  images?: Map<string, EmbeddedImage>;
  formValues?: Record<string, Record<string, FormValue>>;
  flattenForms?: boolean;
  /** Required when any page contains a redaction mark. */
  rasterize?: PageRasterizer;
  title?: string;
}

export interface BuildResult {
  bytes: Uint8Array;
  warnings: string[];
  redactedPages: number;
}

export function hasRedactions(pages: WorkspacePage[]): boolean {
  return pages.some((p) => p.annotations.some((a) => a.type === 'redact'));
}

export async function buildPdf(input: BuildInput): Promise<BuildResult> {
  const { pages, sources } = input;
  if (pages.length === 0) throw new Error('There are no pages to export.');
  const warnings = new Set<string>();
  const redacting = hasRedactions(pages);
  if (redacting && !input.rasterize) throw new Error('Redaction requires a page rasterizer.');
  // Redaction flattens forms: a live field on a rasterised page would survive as data.
  const flatten = (input.flattenForms ?? false) || redacting;

  // 1. Load each source once and apply form values.
  const loaded = new Map<string, PDFDocument>();
  let needAppearances = false;
  for (const sourceId of new Set(pages.map((p) => p.sourceId))) {
    const source = sources.get(sourceId);
    if (!source) throw new Error('A page refers to a document that is no longer open.');
    const doc = await loadPdfLib(source.bytes, source.name);
    const values = input.formValues?.[sourceId] ?? {};
    let hasForm: boolean;
    try {
      hasForm = doc.getForm().getFields().length > 0;
    } catch {
      hasForm = false;
    }
    if (hasForm && (Object.keys(values).length > 0 || flatten)) {
      const result = applyFormValues(doc, values, { flatten });
      result.warnings.forEach((w) => warnings.add(w));
      needAppearances ||= result.needAppearances;
    }
    loaded.set(sourceId, doc);
  }

  // 2. Copy pages into a new document. All first occurrences from one source are copied in
  //    a single call so shared resources (fonts, images, multi-page form fields) stay shared.
  const out = await PDFDocument.create({ updateMetadata: false });
  const firstCopies = new Map<string, PDFPage>();
  for (const [sourceId, doc] of loaded) {
    const indices = [
      ...new Set(pages.filter((p) => p.sourceId === sourceId).map((p) => p.sourceIndex)),
    ];
    for (const index of indices) {
      if (index < 0 || index >= doc.getPageCount())
        throw new Error('A page index is out of range for its document.');
    }
    const copied = await out.copyPages(doc, indices);
    indices.forEach((index, i) => firstCopies.set(`${sourceId}:${index}`, copied[i]));
  }
  const used = new Set<string>();
  const ctx = new DrawContext(out, input.images ?? new Map());
  for (const page of pages) {
    const key = `${page.sourceId}:${page.sourceIndex}`;
    let copy: PDFPage;
    if (!used.has(key)) {
      copy = firstCopies.get(key)!;
      used.add(key);
    } else {
      [copy] = await out.copyPages(loaded.get(page.sourceId)!, [page.sourceIndex]);
    }
    out.addPage(copy);
    copy.setRotation(degrees(effectiveRotation(page)));
    for (const annotation of page.annotations) await drawAnnotation(copy, ctx, annotation);
  }
  ctx.warnings.forEach((w) => warnings.add(w));

  // 3. Re-create the interactive form (unless flattened): widgets were copied with the pages.
  if (!flatten) rebuildAcroForm(out, loaded, needAppearances, warnings);

  setMetadata(out, input.title ?? firstTitle(loaded));
  let bytes = await out.save({ useObjectStreams: true });

  // 4. Redaction: replace affected pages by images rendered from the annotated output.
  let redactedPages = 0;
  if (redacting) {
    const targets = pages
      .map((page, index) => ({ page, index }))
      .filter(({ page }) => page.annotations.some((a) => a.type === 'redact'))
      .map(({ page, index }) => ({
        index,
        redactions: page.annotations
          .filter((a) => a.type === 'redact')
          .map((a) =>
            boxPageToView(a as Box, page.size.width, page.size.height, effectiveRotation(page)),
          ),
      }));
    const rasters = await input.rasterize!(bytes, targets);
    bytes = await replaceWithImages(bytes, rasters, input.title ?? firstTitle(loaded));
    redactedPages = targets.length;
  }

  return { bytes, warnings: [...warnings], redactedPages };
}

function firstTitle(docs: Map<string, PDFDocument>): string | undefined {
  for (const doc of docs.values()) {
    try {
      const title = doc.getTitle();
      if (title) return title;
    } catch {
      /* ignore malformed info dictionaries */
    }
  }
  return undefined;
}

function setMetadata(doc: PDFDocument, title: string | undefined) {
  if (title) doc.setTitle(title);
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
}

/** Builds the final document where every redacted page is only an image. */
async function replaceWithImages(
  bytes: Uint8Array,
  rasters: Map<number, { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' }>,
  title: string | undefined,
): Promise<Uint8Array> {
  const annotated = await PDFDocument.load(bytes, { updateMetadata: false });
  const final = await PDFDocument.create({ updateMetadata: false });
  const keep = annotated.getPageIndices().filter((i) => !rasters.has(i));
  const copied = await final.copyPages(annotated, keep);
  const copiedByIndex = new Map(keep.map((index, i) => [index, copied[i]]));
  for (const index of annotated.getPageIndices()) {
    const raster = rasters.get(index);
    if (!raster) {
      final.addPage(copiedByIndex.get(index)!);
      continue;
    }
    const source = annotated.getPage(index);
    const { width, height } = source.getCropBox();
    const rotation = source.getRotation().angle % 180 === 0;
    const pageWidth = rotation ? width : height;
    const pageHeight = rotation ? height : width;
    const image =
      raster.mime === 'image/png'
        ? await final.embedPng(raster.bytes)
        : await final.embedJpg(raster.bytes);
    const page = final.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }
  setMetadata(final, title);
  return final.save({ useObjectStreams: true });
}

/**
 * Collects the root fields of all widget annotations on the output pages and registers them in
 * a new /AcroForm, copying default appearance (DA) and resources (DR) from the sources.
 */
function rebuildAcroForm(
  out: PDFDocument,
  sources: Map<string, PDFDocument>,
  needAppearances: boolean,
  warnings: Set<string>,
) {
  const context = out.context;
  const roots: PDFRef[] = [];
  const seenRoots = new Set<string>();
  const names = new Map<string, number>();
  for (const page of out.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const annot = context.lookup(ref);
      if (!(annot instanceof PDFDict) || annot.get(PDFName.of('Subtype')) !== PDFName.of('Widget'))
        continue;
      let currentRef = ref instanceof PDFRef ? ref : undefined;
      let current: PDFDict = annot;
      for (let depth = 0; depth < 32; depth++) {
        const parentRef = current.get(PDFName.of('Parent'));
        const parent = parentRef ? context.lookup(parentRef) : undefined;
        if (!(parent instanceof PDFDict) || !(parentRef instanceof PDFRef)) break;
        current = parent;
        currentRef = parentRef;
      }
      if (!currentRef || seenRoots.has(currentRef.toString())) continue;
      seenRoots.add(currentRef.toString());
      // Duplicated pages produce duplicate field names; make them unique so they stay independent.
      const title = current.get(PDFName.of('T'));
      const name = title
        ? ((title as { decodeText?: () => string }).decodeText?.() ?? String(title))
        : '';
      if (name) {
        const count = names.get(name) ?? 0;
        names.set(name, count + 1);
        if (count > 0) {
          current.set(PDFName.of('T'), PDFHexString.fromText(`${name} (${count + 1})`));
          warnings.add('Duplicated pages contain copies of form fields; the copies were renamed.');
        }
      }
      roots.push(currentRef);
    }
  }
  if (!roots.length) return;
  const acroForm = context.obj({ Fields: roots }) as PDFDict;
  const resources = context.obj({}) as PDFDict;
  const fonts = context.obj({}) as PDFDict;
  for (const doc of sources.values()) {
    const sourceForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (!sourceForm) continue;
    const da = sourceForm.get(PDFName.of('DA'));
    if (da && !acroForm.has(PDFName.of('DA'))) acroForm.set(PDFName.of('DA'), da);
    const dr = sourceForm.lookupMaybe(PDFName.of('DR'), PDFDict);
    const drFonts = dr?.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (drFonts) {
      const copier = PDFObjectCopier.for(doc.context, context);
      for (const [key, value] of drFonts.entries()) {
        if (!fonts.has(key)) fonts.set(key, value instanceof PDFRef ? copier.copy(value) : value);
      }
    }
  }
  if (fonts.keys().length) {
    resources.set(PDFName.of('Font'), fonts);
    acroForm.set(PDFName.of('DR'), resources);
  }
  if (needAppearances) acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);
  out.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));
}

/** Utility for tests and the UI: number of pages and whether a form exists. */
export async function inspectPdf(bytes: Uint8Array, name = 'document') {
  const doc = await loadPdfLib(bytes, name);
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  return { pageCount: doc.getPageCount(), hasForm: !!fields && fields.size() > 0, doc };
}
