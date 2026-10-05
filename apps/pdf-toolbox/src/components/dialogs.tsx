import { ClipboardCopy, Download, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { copyToClipboard, downloadBytes, downloadText } from '@shared/lib/download';
import { formatBytes } from '@shared/lib/format';
import { Dialog } from '@shared/react/Dialog';
import { toast } from '@shared/react/toasts';
import type { ImagesToPdfOptions, OrientationOption, PageSizeOption } from '../core/imagesToPdf';
import { PRESETS, type OptimizePreset, type OptimizeResult } from '../core/optimize';
import { describePages, splitPlan, type SplitMode } from '../core/pageRanges';
import {
  addImageFiles,
  defaultBaseName,
  exportPageImages,
  extractText,
  optimizeCurrent,
  splitPdf,
  type ExtractedText,
} from '../state/actions';
import { useStore } from '../state/store';

// ------------------------------------------------------------------------------------------

export function ImagesDialog({ files, onClose }: { files: File[] | null; onClose: () => void }) {
  const [pageSize, setPageSize] = useState<PageSizeOption>('a4');
  const [orientation, setOrientation] = useState<OrientationOption>('auto');
  const [margin, setMargin] = useState(20);
  const submit = async () => {
    if (!files) return;
    const options: ImagesToPdfOptions = {
      pageSize,
      orientation,
      margin: pageSize === 'fit' ? 0 : margin * 2.835,
    };
    onClose();
    await addImageFiles(files, options);
  };
  return (
    <Dialog
      open={!!files}
      onClose={onClose}
      title={`Create PDF pages from ${files?.length ?? 0} image(s)`}
      testId="images-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            data-testid="images-confirm"
          >
            Add pages
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Each image becomes one page, added after the existing pages. PNG and JPEG are embedded
        without quality loss; other formats are converted to PNG.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="img-size">Page size</label>
          <select
            id="img-size"
            className="select"
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value as PageSizeOption)}
            data-testid="images-page-size"
          >
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="letter">US Letter (8.5 × 11 in)</option>
            <option value="fit">Same as image (1 px = 1 pt)</option>
          </select>
        </div>
        {pageSize !== 'fit' && (
          <>
            <div className="field">
              <label htmlFor="img-orientation">Orientation</label>
              <select
                id="img-orientation"
                className="select"
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as OrientationOption)}
              >
                <option value="auto">Automatic (match image)</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="img-margin">Margin (mm)</label>
              <input
                id="img-margin"
                className="input"
                type="number"
                min={0}
                max={50}
                value={margin}
                onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: 100 }}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------

export function SplitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pageCount = useStore((s) => s.pages.length);
  const [kind, setKind] = useState<SplitMode['kind']>('every');
  const [size, setSize] = useState(1);
  const [ranges, setRanges] = useState('');
  const plan = useMemo(() => {
    try {
      const mode: SplitMode =
        kind === 'every' ? { kind, size } : kind === 'ranges' ? { kind, ranges } : { kind };
      return { groups: splitPlan(pageCount, mode), error: null };
    } catch (error) {
      return { groups: [], error: (error as Error).message };
    }
  }, [kind, size, ranges, pageCount]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Split PDF"
      testId="split-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!plan.groups.length}
            data-testid="split-confirm"
            onClick={() => {
              onClose();
              void splitPdf(plan.groups);
            }}
          >
            Split into {plan.groups.length} file(s)
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="check">
          <input
            type="radio"
            name="split"
            checked={kind === 'every'}
            onChange={() => setKind('every')}
          />
          Every
          <input
            className="input"
            type="number"
            min={1}
            max={Math.max(1, pageCount)}
            value={size}
            onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 70 }}
            onFocus={() => setKind('every')}
            aria-label="Pages per file"
          />
          page(s)
        </label>
        <label className="check">
          <input
            type="radio"
            name="split"
            checked={kind === 'ranges'}
            onChange={() => setKind('ranges')}
          />
          Page ranges
          <input
            className="input"
            value={ranges}
            placeholder="e.g. 1-3, 4-6, 7-"
            onChange={(e) => setRanges(e.target.value)}
            onFocus={() => setKind('ranges')}
            aria-label="Page ranges"
            data-testid="split-ranges"
          />
        </label>
        <p className="muted" style={{ margin: 0 }}>
          Page numbers refer to the current workspace order ({pageCount} pages). Each range becomes
          one PDF; several files are downloaded as a ZIP archive.
        </p>
        {plan.error ? (
          <p className="danger-text">{plan.error}</p>
        ) : (
          <p className="split-preview">
            {plan.groups.slice(0, 12).map((g, i) => (
              <span key={i} className="badge">
                {describePages(g)}
              </span>
            ))}
            {plan.groups.length > 12 && <span className="muted">… +{plan.groups.length - 12}</span>}
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------

export function ImageExportDialog({
  pageIds,
  onClose,
}: {
  pageIds: string[] | null;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.9);
  return (
    <Dialog
      open={!!pageIds}
      onClose={onClose}
      title={`Export ${pageIds?.length ?? 0} page(s) as images`}
      testId="image-export-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="image-export-confirm"
            onClick={() => {
              const ids = pageIds ?? [];
              onClose();
              void exportPageImages(ids, { format, dpi, quality });
            }}
          >
            Export
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="img-format">Format</label>
          <select
            id="img-format"
            className="select"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg')}
            data-testid="image-format"
          >
            <option value="png">PNG (lossless)</option>
            <option value="jpeg">JPEG (smaller)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="img-dpi">Resolution</label>
          <select
            id="img-dpi"
            className="select"
            value={dpi}
            onChange={(e) => setDpi(Number(e.target.value))}
          >
            <option value={72}>72 dpi (screen, small)</option>
            <option value={150}>150 dpi (good default)</option>
            <option value={200}>200 dpi</option>
            <option value={300}>300 dpi (print)</option>
          </select>
          <span className="field__hint">
            An A4/Letter page at 300 dpi is about 2500 × 3300 pixels.
          </span>
        </div>
        {format === 'jpeg' && (
          <label className="prop">
            <span className="prop__label">Quality</span>
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.05}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
            <span className="prop__value">{Math.round(quality * 100)}%</span>
          </label>
        )}
        <p className="muted" style={{ margin: 0 }}>
          Annotations and filled form values are included. Several pages are downloaded as a ZIP
          archive.
        </p>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------

export function TextDialog({
  pageIds,
  onClose,
}: {
  pageIds: string[] | null;
  onClose: () => void;
}) {
  const [result, setResult] = useState<ExtractedText[] | null>(null);
  useEffect(() => {
    setResult(null);
    if (!pageIds) return;
    let cancelled = false;
    extractText(pageIds)
      .then((r) => !cancelled && setResult(r))
      .catch((e: unknown) => toast((e as Error).message, 'error'));
    return () => {
      cancelled = true;
    };
  }, [pageIds]);
  const combined = (result ?? [])
    .map(
      (r) =>
        `--- Page ${r.pageNumber} ---\n${r.text || (r.scanned ? '[scanned image — no text layer]' : '[no text]')}`,
    )
    .join('\n\n');
  const scanned = (result ?? []).filter((r) => r.scanned).map((r) => r.pageNumber);
  return (
    <Dialog
      open={!!pageIds}
      onClose={onClose}
      title="Extracted text"
      wide
      testId="text-dialog"
      footer={
        <>
          <button
            type="button"
            className="btn"
            disabled={!result}
            onClick={async () =>
              toast(
                (await copyToClipboard(combined))
                  ? 'Text copied'
                  : 'Could not access the clipboard',
                'success',
              )
            }
          >
            <ClipboardCopy aria-hidden /> Copy all
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!result}
            onClick={() => downloadText(combined, `${defaultBaseName()}.txt`)}
            data-testid="text-download"
          >
            <Download aria-hidden /> Save as .txt
          </button>
        </>
      }
    >
      {!result ? (
        <p className="muted">Extracting…</p>
      ) : (
        <>
          {scanned.length > 0 && (
            <div
              className="notice notice--warning"
              style={{ marginBottom: 12 }}
              data-testid="scanned-notice"
            >
              <TriangleAlert aria-hidden />
              <div>
                <p>
                  Page(s) {describePages(scanned.map((n) => n - 1))} appear to contain only scanned
                  images. Their text cannot be extracted without OCR, which is not available in this
                  version.
                </p>
              </div>
            </div>
          )}
          <pre className="text-dialog__text" data-testid="extracted-text">
            {combined}
          </pre>
        </>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------

export function OptimizeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [preset, setPreset] = useState<OptimizePreset>('balanced');
  const [removeMetadata, setRemoveMetadata] = useState(true);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (open) setResult(null);
  }, [open]);
  const run = async () => {
    setRunning(true);
    setResult(await optimizeCurrent(preset, removeMetadata));
    setRunning(false);
  };
  const saved = result ? result.before - result.after : 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reduce file size"
      testId="optimize-dialog"
      footer={
        result ? (
          <>
            <button type="button" className="btn" onClick={() => setResult(null)}>
              Try another preset
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="optimize-download"
              onClick={() => {
                downloadBytes(
                  result.bytes,
                  `${defaultBaseName()}-optimized.pdf`,
                  'application/pdf',
                );
                onClose();
              }}
            >
              <Download aria-hidden /> Save optimised PDF
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={run}
              disabled={running}
              data-testid="optimize-run"
            >
              {running ? 'Optimising…' : 'Optimise'}
            </button>
          </>
        )
      }
    >
      {!result ? (
        <div className="form-grid">
          {(Object.keys(PRESETS) as OptimizePreset[]).map((key) => (
            <label key={key} className="preset">
              <input
                type="radio"
                name="preset"
                checked={preset === key}
                onChange={() => setPreset(key)}
              />
              <span>
                <strong>{PRESETS[key].label}</strong>
                <span className="muted"> — {PRESETS[key].description}</span>
              </span>
            </label>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={removeMetadata}
              onChange={(e) => setRemoveMetadata(e.target.checked)}
            />
            Remove document metadata (title, author, XMP)
          </label>
          <p className="muted" style={{ margin: 0 }}>
            The current workspace (with all edits) is exported and then optimised: large images are
            downsampled and recompressed as JPEG, unused objects are removed and uncompressed data
            is compressed. Browser-based optimisation is simpler than Acrobat's optimiser — results
            vary by document, and text-only PDFs rarely shrink much.
          </p>
        </div>
      ) : (
        <div className="optimize-result" data-testid="optimize-result">
          <p className="optimize-result__sizes">
            {formatBytes(result.before)} → <strong>{formatBytes(result.after)}</strong>{' '}
            {saved > 0 ? (
              <span className="badge badge--success">
                −{Math.round((saved / result.before) * 100)}%
              </span>
            ) : (
              <span className="badge badge--warning">no reduction</span>
            )}
          </p>
          <ul>
            <li>
              {result.imagesRecompressed} image(s) recompressed, {result.imagesKept} kept as they
              were
              {result.imagesUnsupported
                ? `, ${result.imagesUnsupported} in formats that cannot be recompressed`
                : ''}
            </li>
            <li>
              {result.objectsRemoved} unused object(s) removed, {result.streamsCompressed} stream(s)
              compressed
            </li>
          </ul>
          {saved <= 0 && (
            <p className="muted">
              This document could not be made smaller with this preset. You may keep using the
              original.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
