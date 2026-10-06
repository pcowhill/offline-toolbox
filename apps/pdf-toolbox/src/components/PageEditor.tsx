import { LoaderCircle } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createId } from '@shared/lib/id';
import { isEditableTarget } from '@shared/react/useHotkeys';
import {
  annotationBounds,
  boxPageToView,
  boxViewToPage,
  isBox,
  isLine,
  normalizeBox,
  pageToView,
  resizeAnnotation,
  translateAnnotation,
  viewSize,
  viewToPage,
  type Point,
} from '../core/geometry';
import { LINE_HEIGHT, TEXT_PADDING, wrapText } from '../core/textLayout';
import {
  effectiveRotation,
  type Annotation,
  type Box,
  type TextAnnotation,
  type WorkspacePage,
} from '../core/types';
import { AnnotationMode, enqueue, renderToCanvas } from '../pdf/pdfjs';
import { pdfDocument } from '../state/registry';
import {
  addAnnotation,
  checkpoint,
  deleteAnnotation,
  selectAnnotation,
  setTool,
  updateAnnotation,
  useStore,
  type Tool,
} from '../state/store';
import { AnnotationShape, CSS_FONTS, measureFor, uprightFrame } from './AnnotationShapes';
import { FormLayer } from './FormLayer';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2';

type Drag =
  | { kind: 'create'; tool: Tool; start: Point; current: Point }
  | { kind: 'ink'; points: number[] }
  | { kind: 'move'; id: string; start: Point; original: Annotation; moved: boolean }
  | {
      kind: 'resize';
      id: string;
      handle: Handle;
      start: Point;
      viewBox: Box;
      original: Annotation;
      moved: boolean;
    };

const BOX_TOOLS: Tool[] = [
  'rect',
  'ellipse',
  'highlight',
  'whiteout',
  'redact',
  'text',
  'stamp',
  'image',
];

function useContainerWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Height needed to show all lines of a text annotation (in upright points). */
function requiredTextHeight(a: TextAnnotation, uprightWidth: number): number {
  const lines = wrapText(
    a.text || ' ',
    uprightWidth - TEXT_PADDING * 2,
    measureFor(a.font, a.bold, a.fontSize),
  );
  return TEXT_PADDING * 2 + lines.length * a.fontSize * LINE_HEIGHT;
}

export function PageEditor({ page }: { page: WorkspacePage }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(scrollRef);
  const zoom = useStore((s) => s.zoom);
  const fitWidth = useStore((s) => s.fitWidth);
  const rotation = effectiveRotation(page);
  const view = viewSize(page.size.width, page.size.height, rotation);
  const scale = fitWidth ? Math.max(0.2, Math.min(4, (containerWidth - 48) / view.width)) : zoom;
  const source = useStore((s) => s.sources[page.sourceId]);
  const hasForm = (source?.formFields.length ?? 0) > 0;

  return (
    <div className="editor-scroll" ref={scrollRef} data-testid="page-editor">
      <div
        className="editor-page"
        style={{ width: view.width * scale, height: view.height * scale }}
      >
        <PageCanvas page={page} scale={scale} forms={hasForm} />
        {hasForm && <FormLayer page={page} scale={scale} />}
        <AnnotationLayer page={page} scale={scale} />
      </div>
    </div>
  );
}

function PageCanvas({
  page,
  scale,
  forms,
}: {
  page: WorkspacePage;
  scale: number;
  forms: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rotation = effectiveRotation(page);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      enqueue(async () => {
        if (controller.signal.aborted) return;
        const doc = await pdfDocument(page.sourceId);
        const pdfPage = await doc.getPage(page.sourceIndex + 1);
        const offscreen = document.createElement('canvas');
        const ratio = Math.min(3, window.devicePixelRatio || 1);
        await renderToCanvas(
          pdfPage,
          offscreen,
          {
            scale: scale * ratio,
            rotation,
            annotationMode: forms ? AnnotationMode.ENABLE_FORMS : AnnotationMode.ENABLE,
          },
          controller.signal,
        );
        const canvas = canvasRef.current;
        if (!canvas || controller.signal.aborted) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.getContext('2d')!.drawImage(offscreen, 0, 0);
        offscreen.width = 0;
        setError(null);
      }, 10)
        .catch((e: unknown) => {
          if (!controller.signal.aborted && (e as Error)?.name !== 'RenderingCancelledException')
            setError((e as Error).message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 60);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [page.sourceId, page.sourceIndex, rotation, scale, forms]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="editor-page__canvas"
        aria-label="Page preview"
        data-testid="page-canvas"
      />
      {loading && (
        <LoaderCircle className="spinner editor-page__spinner" aria-label="Rendering page" />
      )}
      {error && <div className="editor-page__error">This page could not be rendered: {error}</div>}
    </>
  );
}

function AnnotationLayer({ page, scale }: { page: WorkspacePage; scale: number }) {
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const selectedId = useStore((s) => s.selectedAnnotationId);
  const pendingImage = useStore((s) => s.pendingImage);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rotation = effectiveRotation(page);
  const { width: W, height: H } = page.size;
  const view = viewSize(W, H, rotation);
  const frame = useMemo(() => ({ width: W, height: H, rotation }), [W, H, rotation]);
  const selected = page.annotations.find((a) => a.id === selectedId) ?? null;

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // Leaving the page (or switching tools) ends text editing.
  useEffect(() => setEditingId(null), [page.id]);

  const toView = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: Math.max(
          0,
          Math.min(view.width, ((event.clientX - rect.left) * view.width) / rect.width),
        ),
        y: Math.max(
          0,
          Math.min(view.height, ((event.clientY - rect.top) * view.height) / rect.height),
        ),
      };
    },
    [view.width, view.height],
  );
  const toPage = (p: Point) => viewToPage(p, W, H, rotation);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || editingId) return;
    const point = toView(event);
    const target = event.target as Element;
    if (tool === 'select') {
      const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as Handle | null;
      const id =
        target.closest('[data-annotation-id]')?.getAttribute('data-annotation-id') ??
        (handle ? selectedId : null);
      const annotation = page.annotations.find((a) => a.id === id);
      if (!annotation) {
        selectAnnotation(null);
        return;
      }
      selectAnnotation(annotation.id);
      svgRef.current?.setPointerCapture(event.pointerId);
      if (handle) {
        updateDrag({
          kind: 'resize',
          id: annotation.id,
          handle,
          start: point,
          viewBox: boxPageToView(annotationBounds(annotation), W, H, rotation),
          original: annotation,
          moved: false,
        });
      } else {
        updateDrag({
          kind: 'move',
          id: annotation.id,
          start: point,
          original: annotation,
          moved: false,
        });
      }
      event.preventDefault();
      return;
    }
    if (tool === 'image' && !pendingImage) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (tool === 'ink') {
      const p = toPage(point);
      updateDrag({ kind: 'ink', points: [p.x, p.y] });
      return;
    }
    updateDrag({ kind: 'create', tool, start: point, current: point });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const point = toView(event);
    if (current.kind === 'create') {
      updateDrag({ ...current, current: point });
    } else if (current.kind === 'ink') {
      const p = toPage(point);
      const n = current.points.length;
      if (Math.hypot(p.x - current.points[n - 2], p.y - current.points[n - 1]) > 0.8)
        updateDrag({ ...current, points: [...current.points, p.x, p.y] });
    } else if (current.kind === 'move') {
      const a = toPage(current.start);
      const b = toPage(point);
      if (!current.moved) {
        if (Math.hypot(point.x - current.start.x, point.y - current.start.y) < 2) return;
        checkpoint();
        dragRef.current = { ...current, moved: true };
      }
      updateAnnotation(page.id, current.id, () =>
        translateAnnotation(current.original, b.x - a.x, b.y - a.y),
      );
    } else if (current.kind === 'resize') {
      if (!current.moved) {
        checkpoint();
        dragRef.current = { ...current, moved: true };
      }
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      const original = current.original;
      if ((current.handle === 'p1' || current.handle === 'p2') && isLine(original)) {
        const which = current.handle;
        const startPage = pageToView(
          {
            x: which === 'p1' ? original.x1 : original.x2,
            y: which === 'p1' ? original.y1 : original.y2,
          },
          W,
          H,
          rotation,
        );
        const p = toPage({ x: startPage.x + dx, y: startPage.y + dy });
        updateAnnotation(page.id, current.id, () =>
          which === 'p1' ? { ...original, x1: p.x, y1: p.y } : { ...original, x2: p.x, y2: p.y },
        );
        return;
      }
      const v = current.viewBox;
      let { x, y } = v;
      let right = v.x + v.w;
      let bottom = v.y + v.h;
      if (current.handle.includes('w')) x += dx;
      if (current.handle.includes('e')) right += dx;
      if (current.handle.includes('n')) y += dy;
      if (current.handle.includes('s')) bottom += dy;
      // Keep the aspect ratio of images and signatures when dragging a corner.
      if (
        (original.type === 'image' || event.shiftKey) &&
        current.handle.length === 2 &&
        v.w > 0 &&
        v.h > 0
      ) {
        const ratio = v.w / v.h;
        const width = Math.max(4, right - x);
        const height = width / ratio;
        if (current.handle.includes('n')) y = bottom - height;
        else bottom = y + height;
      }
      const next = normalizeBox({ x, y }, { x: right, y: bottom });
      if (next.w < 4 || next.h < 4) return;
      const from = annotationBounds(original);
      const to = boxViewToPage(next, W, H, rotation);
      updateAnnotation(page.id, current.id, () => resizeAnnotation(original, from, to));
    }
  };

  const finishCreate = (current: Extract<Drag, { kind: 'create' }>) => {
    let box = normalizeBox(current.start, current.current);
    const click = box.w < 3 && box.h < 3;
    const id = createId();
    const base = { id, opacity: style.opacity };
    const t = current.tool;
    if (t === 'line' || t === 'arrow') {
      if (click) return;
      const p1 = toPage(current.start);
      const p2 = toPage(current.current);
      addAnnotation(page.id, {
        ...base,
        type: t,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        stroke: style.color,
        lineWidth: style.lineWidth,
      });
      return;
    }
    if (!BOX_TOOLS.includes(t)) return;
    if (click) {
      if (t === 'text')
        box = {
          x: box.x,
          y: box.y,
          w: Math.min(220, view.width - box.x),
          h: TEXT_PADDING * 2 + style.fontSize * LINE_HEIGHT,
        };
      else if (t === 'stamp') box = { x: box.x - 80, y: box.y - 25, w: 160, h: 50 };
      else if (t === 'image' && pendingImage) {
        const w = Math.min(180, view.width / 2);
        box = { x: box.x, y: box.y, w, h: w / pendingImage.aspect };
      } else return;
    } else if (t === 'image' && pendingImage) {
      box = { ...box, h: box.w / pendingImage.aspect };
    }
    box.x = Math.max(0, Math.min(box.x, view.width - box.w));
    box.y = Math.max(0, Math.min(box.y, view.height - box.h));
    const pageBox = boxViewToPage(box, W, H, rotation);
    let annotation: Annotation;
    switch (t) {
      case 'text':
        annotation = {
          ...base,
          ...pageBox,
          type: 'text',
          rotation,
          text: '',
          fontSize: style.fontSize,
          font: style.font,
          bold: style.bold,
          color: style.color,
          align: style.align,
          background: null,
        };
        break;
      case 'stamp':
        annotation = {
          ...base,
          ...pageBox,
          type: 'stamp',
          rotation,
          text: style.stampText,
          color: style.stampColor,
        };
        break;
      case 'image':
        annotation = {
          ...base,
          ...pageBox,
          type: 'image',
          rotation,
          imageId: pendingImage!.imageId,
          signature: pendingImage!.signature,
        };
        break;
      case 'highlight':
        annotation = {
          ...base,
          ...pageBox,
          type: 'highlight',
          color: style.highlightColor,
          opacity: 0.4,
        };
        break;
      case 'whiteout':
        annotation = { ...base, ...pageBox, type: 'whiteout', color: '#ffffff', opacity: 1 };
        break;
      case 'redact':
        annotation = { ...base, ...pageBox, type: 'redact', opacity: 1 };
        break;
      default:
        annotation = {
          ...base,
          ...pageBox,
          type: t as 'rect' | 'ellipse',
          stroke: style.color,
          fill: style.fill,
          lineWidth: style.lineWidth,
        };
    }
    addAnnotation(page.id, annotation);
    if (t === 'text') setEditingId(id);
    if (t === 'image') setTool('select');
  };

  const onPointerUp = () => {
    const current = dragRef.current;
    updateDrag(null);
    if (!current) return;
    if (current.kind === 'create') finishCreate(current);
    if (current.kind === 'ink' && current.points.length >= 2) {
      addAnnotation(page.id, {
        id: createId(),
        type: 'ink',
        strokes: [current.points],
        stroke: style.color,
        lineWidth: style.lineWidth,
        opacity: style.opacity,
      });
    }
  };

  // Keyboard: delete / nudge the selected annotation.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !selected ||
        editingId ||
        isEditableTarget(event.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteAnnotation(page.id, selected.id);
      } else if (event.key === 'Enter' && selected.type === 'text') {
        event.preventDefault();
        setEditingId(selected.id);
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const v = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[event.key] ?? [0, 0];
        const a = viewToPage({ x: 0, y: 0 }, W, H, rotation);
        const b = viewToPage({ x: v[0], y: v[1] }, W, H, rotation);
        updateAnnotation(
          page.id,
          selected.id,
          (ann) => translateAnnotation(ann, b.x - a.x, b.y - a.y),
          true,
        );
      } else if (event.key === 'Escape') {
        selectAnnotation(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, editingId, page.id, W, H, rotation]);

  const drawing = tool !== 'select';
  const editing = page.annotations.find((a) => a.id === editingId && a.type === 'text') as
    TextAnnotation | undefined;

  return (
    <>
      <svg
        ref={svgRef}
        className={`annotation-layer${drawing ? ' annotation-layer--drawing' : ''}${tool === 'image' && !pendingImage ? ' annotation-layer--blocked' : ''}`}
        viewBox={`0 0 ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => updateDrag(null)}
        onDoubleClick={(event) => {
          const id = (event.target as Element)
            .closest('[data-annotation-id]')
            ?.getAttribute('data-annotation-id');
          const a = page.annotations.find((x) => x.id === id);
          if (a?.type === 'text') setEditingId(a.id);
        }}
        data-testid="annotation-layer"
        role="application"
        aria-label="Page annotations"
      >
        {page.annotations.map((a) => (
          <g
            key={a.id}
            data-annotation-id={a.id}
            className="annotation-hit"
            data-testid={`annotation-${a.type}`}
          >
            <AnnotationShape
              annotation={a}
              frame={frame}
              editing={a.id === editingId}
              editorHints
            />
            <HitArea annotation={a} frame={frame} />
          </g>
        ))}
        {selected && !editingId && (
          <SelectionBox annotation={selected} frame={frame} scale={scale} />
        )}
        {drag?.kind === 'create' && <CreatePreview drag={drag} />}
        {drag?.kind === 'ink' && (
          <polyline
            points={inkViewPoints(drag.points, frame)}
            fill="none"
            stroke={style.color}
            strokeWidth={style.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={style.opacity}
          />
        )}
      </svg>
      {editing && (
        <TextEditor
          annotation={editing}
          page={page}
          scale={scale}
          onDone={() => {
            setEditingId(null);
            if (!editing.text.trim()) deleteAnnotation(page.id, editing.id);
          }}
        />
      )}
    </>
  );
}

function inkViewPoints(
  points: number[],
  frame: { width: number; height: number; rotation: WorkspacePage['rotation'] },
): string {
  const out: string[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const p = pageToView(
      { x: points[i], y: points[i + 1] },
      frame.width,
      frame.height,
      frame.rotation,
    );
    out.push(`${p.x},${p.y}`);
  }
  return out.join(' ');
}

/** Invisible, slightly larger hit target so thin lines are easy to grab. */
function HitArea({
  annotation,
  frame,
}: {
  annotation: Annotation;
  frame: { width: number; height: number; rotation: WorkspacePage['rotation'] };
}) {
  const b = boxPageToView(annotationBounds(annotation), frame.width, frame.height, frame.rotation);
  if (isLine(annotation)) {
    const p1 = pageToView(
      { x: annotation.x1, y: annotation.y1 },
      frame.width,
      frame.height,
      frame.rotation,
    );
    const p2 = pageToView(
      { x: annotation.x2, y: annotation.y2 },
      frame.width,
      frame.height,
      frame.rotation,
    );
    return (
      <line
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke="transparent"
        strokeWidth={Math.max(8, annotation.lineWidth + 6)}
        className="hit"
      />
    );
  }
  return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" className="hit" />;
}

function SelectionBox({
  annotation,
  frame,
  scale,
}: {
  annotation: Annotation;
  frame: { width: number; height: number; rotation: WorkspacePage['rotation'] };
  scale: number;
}) {
  const handleSize = 8 / scale;
  if (isLine(annotation)) {
    const points: Array<[Handle, Point]> = [
      [
        'p1',
        pageToView(
          { x: annotation.x1, y: annotation.y1 },
          frame.width,
          frame.height,
          frame.rotation,
        ),
      ],
      [
        'p2',
        pageToView(
          { x: annotation.x2, y: annotation.y2 },
          frame.width,
          frame.height,
          frame.rotation,
        ),
      ],
    ];
    return (
      <g className="selection">
        {points.map(([handle, p]) => (
          <circle
            key={handle}
            cx={p.x}
            cy={p.y}
            r={handleSize / 1.4}
            data-handle={handle}
            className="selection__handle"
          />
        ))}
      </g>
    );
  }
  const b = boxPageToView(annotationBounds(annotation), frame.width, frame.height, frame.rotation);
  const handles: Array<[Handle, number, number]> = [
    ['nw', b.x, b.y],
    ['n', b.x + b.w / 2, b.y],
    ['ne', b.x + b.w, b.y],
    ['e', b.x + b.w, b.y + b.h / 2],
    ['se', b.x + b.w, b.y + b.h],
    ['s', b.x + b.w / 2, b.y + b.h],
    ['sw', b.x, b.y + b.h],
    ['w', b.x, b.y + b.h / 2],
  ];
  return (
    <g className="selection" data-testid="selection">
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        className="selection__box"
        vectorEffect="non-scaling-stroke"
      />
      {(isBox(annotation) || annotation.type === 'ink') &&
        handles.map(([handle, x, y]) => (
          <rect
            key={handle}
            x={x - handleSize / 2}
            y={y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            data-handle={handle}
            className={`selection__handle selection__handle--${handle}`}
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </g>
  );
}

function CreatePreview({ drag }: { drag: Extract<Drag, { kind: 'create' }> }) {
  if (drag.tool === 'line' || drag.tool === 'arrow') {
    return (
      <line
        x1={drag.start.x}
        y1={drag.start.y}
        x2={drag.current.x}
        y2={drag.current.y}
        className="create-preview"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  const b = normalizeBox(drag.start, drag.current);
  if (drag.tool === 'ellipse') {
    return (
      <ellipse
        cx={b.x + b.w / 2}
        cy={b.y + b.h / 2}
        rx={b.w / 2}
        ry={b.h / 2}
        className="create-preview"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return (
    <rect
      x={b.x}
      y={b.y}
      width={b.w}
      height={b.h}
      className="create-preview"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** In-place text editing with a textarea positioned over the annotation. */
function TextEditor({
  annotation,
  page,
  scale,
  onDone,
}: {
  annotation: TextAnnotation;
  page: WorkspacePage;
  scale: number;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const rotation = effectiveRotation(page);
  const frame = { width: page.size.width, height: page.size.height, rotation };
  const { box, delta, upright } = uprightFrame(annotation, frame);
  const started = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const onChange = (text: string) => {
    if (!started.current) {
      checkpoint();
      started.current = true;
    }
    updateAnnotation(page.id, annotation.id, (a) => {
      const t = { ...(a as TextAnnotation), text };
      // Grow the box downwards (in the upright orientation) when text needs more lines.
      const needed = requiredTextHeight(t, upright.width);
      if (needed <= upright.height + 0.5) return t;
      const grow = needed - upright.height;
      switch (annotation.rotation) {
        case 90:
          return { ...t, w: t.w + grow };
        case 180:
          return { ...t, h: t.h + grow, y: t.y - grow };
        case 270:
          return { ...t, w: t.w + grow, x: t.x - grow };
        default:
          return { ...t, h: t.h + grow };
      }
    });
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={annotation.text}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          onDone();
        }
        e.stopPropagation();
      }}
      aria-label="Annotation text"
      data-testid="text-editor"
      spellCheck
      style={{
        left: (box.x + box.w / 2) * scale - (upright.width * scale) / 2,
        top: (box.y + box.h / 2) * scale - (upright.height * scale) / 2,
        width: upright.width * scale,
        height: upright.height * scale,
        transform: `rotate(${delta}deg)`,
        fontFamily: CSS_FONTS[annotation.font],
        fontSize: annotation.fontSize * scale,
        fontWeight: annotation.bold ? 700 : 400,
        lineHeight: LINE_HEIGHT,
        padding: `${TEXT_PADDING * scale}px`,
        color: annotation.color,
        background: annotation.background ?? 'transparent',
        textAlign: annotation.align,
      }}
    />
  );
}
