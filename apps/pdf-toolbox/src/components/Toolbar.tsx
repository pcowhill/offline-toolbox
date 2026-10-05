import {
  ArrowUpRight,
  Circle,
  Copy,
  Eraser,
  Highlighter,
  ImagePlus,
  LayoutGrid,
  Minus,
  MousePointer2,
  PenLine,
  PenTool,
  Redo2,
  RotateCcw,
  RotateCw,
  Signature,
  Square,
  SquareDashed,
  Stamp,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { pickFiles } from '@shared/lib/download';
import { toast } from '@shared/react/toasts';
import { loadInsertImage } from '../state/actions';
import {
  deletePages,
  duplicatePages,
  redo,
  rotatePages,
  setMode,
  setPendingImage,
  setTool,
  setZoom,
  targetPageIds,
  undo,
  useStore,
  type Tool,
} from '../state/store';

const TOOLS: Array<{
  id: Tool;
  label: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  key: string;
}> = [
  { id: 'select', label: 'Select & fill forms', icon: MousePointer2, key: 'V' },
  { id: 'text', label: 'Text box', icon: Type, key: 'T' },
  { id: 'ink', label: 'Freehand draw', icon: PenTool, key: 'D' },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, key: 'H' },
  { id: 'rect', label: 'Rectangle', icon: Square, key: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: Circle, key: 'O' },
  { id: 'line', label: 'Line', icon: Minus, key: 'L' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, key: 'A' },
  { id: 'stamp', label: 'Stamp', icon: Stamp, key: 'S' },
  { id: 'whiteout', label: 'Whiteout (visual cover only)', icon: Eraser, key: 'W' },
  {
    id: 'redact',
    label: 'Redact (permanently removes content on export)',
    icon: SquareDashed,
    key: 'X',
  },
];

export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key, t.id])) as Record<
  string,
  Tool
>;

export async function chooseInsertImage() {
  const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp' });
  if (!file) return;
  try {
    const { id, aspect } = await loadInsertImage(file, file.name);
    setPendingImage({ imageId: id, signature: false, aspect });
    toast('Click or drag on the page to place the image.', 'info');
  } catch (error) {
    toast((error as Error).message, 'error');
  }
}

export function Toolbar({ onSignature }: { onSignature: () => void }) {
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const currentPageId = useStore((s) => s.currentPageId);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const zoom = useStore((s) => s.zoom);
  const fitWidth = useStore((s) => s.fitWidth);
  const pendingImage = useStore((s) => s.pendingImage);
  const hasTargets = selection.length > 0 || (mode === 'edit' && !!currentPageId);
  const targets = () => targetPageIds();
  const count = selection.length || (mode === 'edit' && currentPageId ? 1 : 0);

  return (
    <div className="toolbar main-toolbar" role="toolbar" aria-label="Page tools">
      <div className="btn-group" role="group" aria-label="View">
        <button
          type="button"
          className="btn"
          aria-pressed={mode === 'organize'}
          onClick={() => setMode('organize')}
          data-testid="mode-organize"
          title="Organize pages (thumbnails)"
        >
          <LayoutGrid aria-hidden /> Organize
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={mode === 'edit'}
          onClick={() => setMode('edit')}
          data-testid="mode-edit"
          title="Edit and annotate a page"
        >
          <PenLine aria-hidden /> Edit
        </button>
      </div>
      <span className="toolbar__sep" />
      <button
        type="button"
        className="btn btn--icon"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        data-testid="undo"
      >
        <Undo2 aria-hidden />
      </button>
      <button
        type="button"
        className="btn btn--icon"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        data-testid="redo"
      >
        <Redo2 aria-hidden />
      </button>
      <span className="toolbar__sep" />
      <button
        type="button"
        className="btn btn--icon"
        disabled={!hasTargets}
        onClick={() => rotatePages(targets(), -90)}
        title="Rotate left"
        aria-label="Rotate selected pages left"
        data-testid="rotate-left"
      >
        <RotateCcw aria-hidden />
      </button>
      <button
        type="button"
        className="btn btn--icon"
        disabled={!hasTargets}
        onClick={() => rotatePages(targets(), 90)}
        title="Rotate right"
        aria-label="Rotate selected pages right"
        data-testid="rotate-right"
      >
        <RotateCw aria-hidden />
      </button>
      <button
        type="button"
        className="btn btn--icon"
        disabled={!hasTargets}
        onClick={() => duplicatePages(targets())}
        title="Duplicate"
        aria-label="Duplicate selected pages"
        data-testid="duplicate-pages"
      >
        <Copy aria-hidden />
      </button>
      <button
        type="button"
        className="btn btn--icon btn--danger"
        disabled={!hasTargets}
        onClick={() => deletePages(targets())}
        title="Delete (Del)"
        aria-label="Delete selected pages"
        data-testid="delete-pages"
      >
        <Trash2 aria-hidden />
      </button>
      {mode === 'organize' && (
        <span className="muted toolbar__hint">
          {count ? `${count} selected` : 'Click to select · Ctrl/Shift for more · drag to reorder'}
        </span>
      )}

      {mode === 'edit' && (
        <>
          <span className="toolbar__sep" />
          <div className="tool-palette" role="radiogroup" aria-label="Annotation tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tool === t.id}
                className={`btn btn--icon tool-btn${tool === t.id ? ' is-active' : ''}${t.id === 'redact' ? ' tool-btn--redact' : ''}`}
                title={`${t.label} (${t.key})`}
                aria-label={t.label}
                onClick={() => setTool(t.id)}
                data-testid={`tool-${t.id}`}
              >
                <t.icon aria-hidden />
              </button>
            ))}
            <button
              type="button"
              className={`btn btn--icon tool-btn${tool === 'image' && pendingImage && !pendingImage.signature ? ' is-active' : ''}`}
              title="Insert image"
              aria-label="Insert image"
              onClick={chooseInsertImage}
              data-testid="tool-image"
            >
              <ImagePlus aria-hidden />
            </button>
            <button
              type="button"
              className={`btn btn--icon tool-btn${tool === 'image' && pendingImage?.signature ? ' is-active' : ''}`}
              title="Signature"
              aria-label="Signature"
              onClick={onSignature}
              data-testid="tool-signature"
            >
              <Signature aria-hidden />
            </button>
          </div>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setZoom(zoom / 1.2)}
            aria-label="Zoom out"
            title="Zoom out (Ctrl+-)"
          >
            <ZoomOut aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn--sm"
            aria-pressed={fitWidth}
            onClick={() => setZoom(zoom, !fitWidth)}
            title="Fit page width"
          >
            {fitWidth ? 'Fit width' : `${Math.round(zoom * 100)}%`}
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setZoom(zoom * 1.2)}
            aria-label="Zoom in"
            title="Zoom in (Ctrl++)"
          >
            <ZoomIn aria-hidden />
          </button>
        </>
      )}
      {mode === 'organize' && <span className="spacer" />}
    </div>
  );
}
