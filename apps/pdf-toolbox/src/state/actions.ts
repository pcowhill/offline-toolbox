// User-level operations that combine the store, the PDF core and browser services.
import { downloadBytes, downloadBlob } from '@shared/lib/download';
import { safeFileName } from '@shared/lib/format';
import { createId } from '@shared/lib/id';
import { toast } from '@shared/react/toasts';
import { buildPdf, hasRedactions, loadPdfLib } from '../core/buildPdf';
import { extractImages } from '../core/extractImages';
import { readFormFields } from '../core/forms';
import { imagesToPdf, type ImagesToPdfOptions } from '../core/imagesToPdf';
import { jpegOrientation, sniffImageType } from '../core/jpeg';
import { optimizePdf, type OptimizePreset, type OptimizeResult } from '../core/optimize';
import { effectiveRotation, normalizeRotation, type WorkspacePage } from '../core/types';
import { createZip } from '../core/zip';
import { extractPageText, openPdf, renderPageImage } from '../pdf/pdfjs';
import {
  decodedImageToFile,
  encodeJpeg,
  normalizeImageFile,
  rasterizeForRedaction,
} from '../pdf/rasterize';
import { images, openPdfFor, pdfDocument, sourceMap } from './registry';
import { addSource, setBusy, useStore } from './store';

const MAX_FILE_BYTES = 500 * 1024 * 1024;

export function isPdfFile(file: File, head: Uint8Array): boolean {
  return (
    file.type === 'application/pdf' ||
    /\.pdf$/i.test(file.name) ||
    new TextDecoder().decode(head.subarray(0, 5)) === '%PDF-'
  );
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof RangeError ||
    /out of memory|allocation failed|array buffer allocation/i.test(message)
  ) {
    return 'The browser ran out of memory. Try closing other tabs, or work with fewer/smaller documents at a time.';
  }
  return message;
}

/** Splits dropped/picked files into PDFs (opened directly) and images (need page options). */
export async function classifyFiles(
  files: File[],
): Promise<{ pdfs: File[]; images: File[]; rejected: string[] }> {
  const pdfs: File[] = [];
  const imageFiles: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (isPdfFile(file, head)) pdfs.push(file);
    else if (sniffImageType(head) || file.type.startsWith('image/')) imageFiles.push(file);
    else rejected.push(file.name);
  }
  return { pdfs, images: imageFiles, rejected };
}

/** Opens PDFs and appends their pages to the workspace. */
export async function addPdfFiles(files: File[], insertAt?: number) {
  let offset = insertAt;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      toast(
        `"${file.name}" is larger than 500 MB, which is beyond what a browser tab can reliably handle.`,
        'error',
      );
      continue;
    }
    setBusy({ message: `Opening ${file.name}…` });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const added = await addPdfBytes(file.name, bytes, offset);
      if (offset !== undefined) offset += added;
    } catch (error) {
      toast(describeError(error), 'error');
    } finally {
      setBusy(null);
    }
  }
}

export async function addPdfBytes(
  name: string,
  bytes: Uint8Array,
  insertAt?: number,
): Promise<number> {
  // pdf-lib validates that the document can be edited (rejects encrypted files).
  const libDoc = await loadPdfLib(bytes, name);
  const formFields = readFormFields(libDoc);
  const id = createId();
  const pdf = await openPdfFor(id, name, bytes);
  const pages: Array<Omit<WorkspacePage, 'id' | 'annotations' | 'rotation'>> = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const [x1, y1, x2, y2] = page.view;
    pages.push({
      sourceId: id,
      sourceIndex: i,
      baseRotation: normalizeRotation(page.rotate),
      size: { width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) },
    });
  }
  addSource(
    { id, name, pageCount: pdf.numPages, byteLength: bytes.length, formFields },
    pages,
    insertAt,
  );
  if (formFields.length)
    toast(
      `"${name}" contains a fillable form with ${formFields.length} field(s). Use the Form panel in Edit mode.`,
      'info',
    );
  return pages.length;
}

/** Converts images into PDF pages (one page per image) and adds them to the workspace. */
export async function addImageFiles(files: File[], options: ImagesToPdfOptions, insertAt?: number) {
  setBusy({ message: `Converting ${files.length} image(s)…` });
  try {
    const inputs = [];
    for (const file of files) {
      const raw = new Uint8Array(await file.arrayBuffer());
      const mime = sniffImageType(raw) ?? file.type;
      try {
        const normalized = await normalizeImageFile(
          raw,
          mime,
          mime === 'image/jpeg' ? jpegOrientation(raw) : 1,
        );
        inputs.push({ name: file.name, bytes: normalized.bytes, mime: normalized.mime });
      } catch {
        toast(`"${file.name}" is not an image format this browser can read.`, 'error');
      }
    }
    if (!inputs.length) return;
    const bytes = await imagesToPdf(inputs, options);
    const name =
      inputs.length === 1
        ? `${inputs[0].name.replace(/\.[^.]+$/, '')}.pdf`
        : `Images (${inputs.length}).pdf`;
    await addPdfBytes(name, bytes, insertAt);
    toast(`Added ${inputs.length} image page(s)`, 'success');
  } catch (error) {
    toast(describeError(error), 'error');
  } finally {
    setBusy(null);
  }
}

/** Loads an image for the image/signature tool. */
export async function loadInsertImage(
  file: Blob,
  name = 'image',
): Promise<{ id: string; aspect: number }> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageType(raw) ?? file.type;
  const normalized = await normalizeImageFile(
    raw,
    mime,
    mime === 'image/jpeg' ? jpegOrientation(raw) : 1,
  ).catch(() => {
    throw new Error(`"${name}" is not an image format this browser can read.`);
  });
  const id = createId();
  images.set(id, {
    id,
    bytes: normalized.bytes,
    mime: normalized.mime,
    width: normalized.width,
    height: normalized.height,
  });
  return { id, aspect: normalized.width / normalized.height };
}

// --------------------------------------------------------------------------------------
// Export

export function defaultBaseName(): string {
  const { pages, sources } = useStore.getState();
  const first = pages[0] && sources[pages[0].sourceId]?.name;
  return safeFileName((first ?? 'document').replace(/\.pdf$/i, ''), 'document');
}

async function build(pages: WorkspacePage[]) {
  const state = useStore.getState();
  return buildPdf({
    pages,
    sources: sourceMap(),
    images,
    formValues: state.formValues,
    flattenForms: state.flattenForms,
    rasterize: rasterizeForRedaction,
  });
}

function reportWarnings(warnings: string[]) {
  if (warnings.length) toast(warnings.join('\n'), 'warning', 12000);
}

export async function exportPdf(pageIds?: string[], fileName?: string) {
  const { pages } = useStore.getState();
  const chosen = pageIds ? pages.filter((p) => pageIds.includes(p.id)) : pages;
  if (!chosen.length) {
    toast('There are no pages to export.', 'warning');
    return;
  }
  setBusy({
    message: hasRedactions(chosen) ? 'Applying redactions and exporting…' : 'Creating PDF…',
  });
  try {
    const result = await build(chosen);
    const name = fileName ?? `${defaultBaseName()}${pageIds ? '-pages' : '-edited'}.pdf`;
    downloadBytes(result.bytes, name, 'application/pdf');
    reportWarnings(result.warnings);
    toast(
      `Saved ${name} (${chosen.length} page${chosen.length === 1 ? '' : 's'})${result.redactedPages ? `\n${result.redactedPages} page(s) were redacted and converted to images.` : ''}`,
      'success',
    );
  } catch (error) {
    toast(`Export failed: ${describeError(error)}`, 'error');
  } finally {
    setBusy(null);
  }
}

export async function splitPdf(groups: number[][]) {
  const { pages } = useStore.getState();
  const base = defaultBaseName();
  setBusy({ message: 'Splitting…', progress: 0 });
  try {
    const entries = [];
    const allWarnings = new Set<string>();
    for (let i = 0; i < groups.length; i++) {
      setBusy({
        message: `Creating part ${i + 1} of ${groups.length}…`,
        progress: i / groups.length,
      });
      const result = await build(groups[i].map((index) => pages[index]));
      result.warnings.forEach((w) => allWarnings.add(w));
      const first = groups[i][0] + 1;
      const last = groups[i][groups[i].length - 1] + 1;
      entries.push({
        name: `${base}-${first === last ? `p${first}` : `p${first}-${last}`}.pdf`,
        data: result.bytes,
      });
    }
    if (entries.length === 1) downloadBytes(entries[0].data, entries[0].name, 'application/pdf');
    else downloadBytes(createZip(entries), `${base}-split.zip`, 'application/zip');
    reportWarnings([...allWarnings]);
    toast(
      `Created ${entries.length} PDF file(s)${entries.length > 1 ? ' (downloaded as a ZIP archive)' : ''}`,
      'success',
    );
  } catch (error) {
    toast(`Split failed: ${describeError(error)}`, 'error');
  } finally {
    setBusy(null);
  }
}

/** Renders pages (with their edits) to PNG/JPEG. */
export async function exportPageImages(
  pageIds: string[],
  options: { format: 'png' | 'jpeg'; dpi: number; quality: number },
) {
  const { pages } = useStore.getState();
  const chosen = pages.filter((p) => pageIds.includes(p.id));
  if (!chosen.length) return;
  setBusy({ message: 'Rendering pages…', progress: 0 });
  const base = defaultBaseName();
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const hasEdits =
      chosen.some((p) => p.annotations.length) ||
      Object.keys(useStore.getState().formValues).length > 0;
    // Pages with edits are rendered from a temporary export so the images show the edits.
    let render: (i: number) => Promise<Blob>;
    if (hasEdits) {
      const result = await build(chosen);
      const doc = await openPdf(result.bytes, 'export');
      cleanup = () => doc.loadingTask.destroy();
      render = async (i) => {
        const page = await doc.getPage(i + 1);
        return renderPageImage(page, {
          dpi: options.dpi,
          rotation: normalizeRotation(page.rotate),
          type: `image/${options.format}`,
          quality: options.quality,
        });
      };
    } else {
      render = async (i) => {
        const p = chosen[i];
        const doc = await pdfDocument(p.sourceId);
        const page = await doc.getPage(p.sourceIndex + 1);
        return renderPageImage(page, {
          dpi: options.dpi,
          rotation: effectiveRotation(p),
          type: `image/${options.format}`,
          quality: options.quality,
        });
      };
    }
    const entries = [];
    for (let i = 0; i < chosen.length; i++) {
      setBusy({
        message: `Rendering page ${i + 1} of ${chosen.length}…`,
        progress: i / chosen.length,
      });
      const blob = await render(i);
      const number = pages.indexOf(chosen[i]) + 1;
      entries.push({
        name: `${base}-page-${String(number).padStart(3, '0')}.${options.format === 'jpeg' ? 'jpg' : 'png'}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    if (entries.length === 1)
      downloadBlob(
        new Blob([entries[0].data as BlobPart], { type: `image/${options.format}` }),
        entries[0].name,
      );
    else downloadBytes(createZip(entries), `${base}-images.zip`, 'application/zip');
    toast(`Exported ${entries.length} image(s)`, 'success');
  } catch (error) {
    toast(`Image export failed: ${describeError(error)}`, 'error');
  } finally {
    await cleanup?.().catch(() => undefined);
    setBusy(null);
  }
}

export interface ExtractedText {
  pageNumber: number;
  text: string;
  scanned: boolean;
}

export async function extractText(pageIds: string[]): Promise<ExtractedText[]> {
  const { pages } = useStore.getState();
  const out: ExtractedText[] = [];
  setBusy({ message: 'Extracting text…' });
  try {
    for (const p of pages) {
      if (!pageIds.includes(p.id)) continue;
      const doc = await pdfDocument(p.sourceId);
      const page = await doc.getPage(p.sourceIndex + 1);
      const { text, hasImages } = await extractPageText(page);
      out.push({ pageNumber: pages.indexOf(p) + 1, text, scanned: !text && hasImages });
    }
  } finally {
    setBusy(null);
  }
  return out;
}

export async function extractEmbeddedImages(pageIds: string[]) {
  const { pages } = useStore.getState();
  const chosen = pages.filter((p) => pageIds.includes(p.id));
  setBusy({ message: 'Extracting images…' });
  try {
    const entries = [];
    const unsupported: string[] = [];
    const bySource = new Map<string, WorkspacePage[]>();
    for (const p of chosen) bySource.set(p.sourceId, [...(bySource.get(p.sourceId) ?? []), p]);
    const sources = sourceMap();
    for (const [sourceId, list] of bySource) {
      const doc = await loadPdfLib(sources.get(sourceId)!.bytes);
      const result = extractImages(
        doc,
        list.map((p) => ({ index: p.sourceIndex, label: pages.indexOf(p) + 1 })),
      );
      for (const item of result.images) {
        const file = await decodedImageToFile(item.image);
        entries.push({
          name: `page-${String(item.pageNumber).padStart(3, '0')}-image-${item.index}.${file.extension}`,
          data: file.bytes,
        });
      }
      unsupported.push(...result.unsupported.map((u) => `page ${u.pageNumber}: ${u.reason}`));
    }
    if (!entries.length) {
      toast(
        unsupported.length
          ? `No extractable images. ${unsupported.length} image(s) use formats that cannot be extracted (${[...new Set(unsupported)].slice(0, 3).join('; ')}).`
          : 'The selected pages contain no embedded raster images.',
        'warning',
      );
      return;
    }
    const base = defaultBaseName();
    if (entries.length === 1)
      downloadBytes(entries[0].data, `${base}-${entries[0].name}`, 'application/octet-stream');
    else downloadBytes(createZip(entries), `${base}-images.zip`, 'application/zip');
    toast(
      `Extracted ${entries.length} image(s)${unsupported.length ? `; ${unsupported.length} could not be extracted (unsupported encoding)` : ''}.`,
      unsupported.length ? 'warning' : 'success',
    );
  } catch (error) {
    toast(`Image extraction failed: ${describeError(error)}`, 'error');
  } finally {
    setBusy(null);
  }
}

export async function optimizeCurrent(
  preset: OptimizePreset,
  removeMetadata: boolean,
): Promise<OptimizeResult | null> {
  const { pages } = useStore.getState();
  if (!pages.length) return null;
  setBusy({ message: 'Building document…' });
  try {
    const built = await build(pages);
    setBusy({ message: 'Optimising images…', progress: 0 });
    const result = await optimizePdf(built.bytes, {
      preset,
      removeMetadata,
      encodeJpeg,
      onProgress: (done, total) =>
        setBusy({
          message: `Optimising images (${done}/${total})…`,
          progress: total ? done / total : 1,
        }),
    });
    reportWarnings(built.warnings);
    return result;
  } catch (error) {
    toast(`Optimisation failed: ${describeError(error)}`, 'error');
    return null;
  } finally {
    setBusy(null);
  }
}
