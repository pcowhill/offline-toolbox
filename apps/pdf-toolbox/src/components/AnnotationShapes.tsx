import { memo, useEffect, useState } from 'react';
import { stampFontSize, arrowHead } from '../core/annotationsPdf';
import { boxPageToView, pageToView, viewSize } from '../core/geometry';
import { LINE_HEIGHT, TEXT_PADDING, wrapText } from '../core/textLayout';
import {
  effectiveRotation,
  type Annotation,
  type FontFamily,
  type Rotation,
  type WorkspacePage,
} from '../core/types';
import { images } from '../state/registry';

export const CSS_FONTS: Record<FontFamily, string> = {
  Helvetica: "Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', sans-serif",
  Times: "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif",
  Courier: "'Courier New', Courier, 'Liberation Mono', 'Nimbus Mono PS', monospace",
};

let measureContext: CanvasRenderingContext2D | null = null;
/** Measures text like the PDF export does (metric-compatible system fonts). */
export function measureFor(font: FontFamily, bold: boolean, size: number) {
  measureContext ??= document.createElement('canvas').getContext('2d');
  const ctx = measureContext!;
  ctx.font = `${bold ? 'bold ' : ''}100px ${CSS_FONTS[font]}`;
  return (text: string) => (ctx.measureText(text).width / 100) * size;
}

const imageUrls = new Map<string, string>();
function imageUrl(id: string): string | null {
  const cached = imageUrls.get(id);
  if (cached) return cached;
  const image = images.get(id);
  if (!image) return null;
  const url = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.mime }));
  imageUrls.set(id, url);
  return url;
}

interface Frame {
  width: number;
  height: number;
  rotation: Rotation;
}

/** Rotation of content relative to the current view, plus the upright box in view space. */
export function uprightFrame(a: Extract<Annotation, { rotation: Rotation }>, frame: Frame) {
  const box = boxPageToView(a, frame.width, frame.height, frame.rotation);
  const delta = (((frame.rotation - a.rotation) % 360) + 360) % 360;
  const upright =
    delta % 180 === 0 ? { width: box.w, height: box.h } : { width: box.h, height: box.w };
  const transform = `translate(${box.x + box.w / 2} ${box.y + box.h / 2}) rotate(${delta}) translate(${-upright.width / 2} ${-upright.height / 2})`;
  return { box, delta, upright, transform };
}

export function TextLines({
  a,
  width,
  hidden,
}: {
  a: Extract<Annotation, { type: 'text' }>;
  width: number;
  height: number;
  hidden?: boolean;
}) {
  const measure = measureFor(a.font, a.bold, a.fontSize);
  const lines = wrapText(a.text, width - TEXT_PADDING * 2, measure);
  const anchor = a.align === 'center' ? 'middle' : a.align === 'right' ? 'end' : 'start';
  const x =
    a.align === 'center' ? width / 2 : a.align === 'right' ? width - TEXT_PADDING : TEXT_PADDING;
  return (
    <text
      fontFamily={CSS_FONTS[a.font]}
      fontSize={a.fontSize}
      fontWeight={a.bold ? 700 : 400}
      fill={a.color}
      textAnchor={anchor}
      style={{ whiteSpace: 'pre', visibility: hidden ? 'hidden' : undefined }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} y={TEXT_PADDING + a.fontSize * 0.8 + i * a.fontSize * LINE_HEIGHT}>
          {line || ' '}
        </tspan>
      ))}
    </text>
  );
}

interface ShapeProps {
  annotation: Annotation;
  frame: Frame;
  editing?: boolean;
  /** Editor-only hints (whiteout outline, redaction label). */
  editorHints?: boolean;
}

export const AnnotationShape = memo(function AnnotationShape({
  annotation: a,
  frame,
  editing,
  editorHints,
}: ShapeProps) {
  const [, force] = useState(0);
  useEffect(() => {
    if (a.type === 'image' && !imageUrl(a.imageId)) {
      const t = setTimeout(() => force((n) => n + 1), 200);
      return () => clearTimeout(t);
    }
  });
  switch (a.type) {
    case 'text': {
      const { upright, transform } = uprightFrame(a, frame);
      return (
        <g transform={transform} opacity={a.opacity}>
          {a.background && (
            <rect width={upright.width} height={upright.height} fill={a.background} />
          )}
          <TextLines a={a} width={upright.width} height={upright.height} hidden={editing} />
        </g>
      );
    }
    case 'stamp': {
      const { upright, transform } = uprightFrame(a, frame);
      const text = a.text.toUpperCase();
      const measure = measureFor('Helvetica', true, 1);
      const size = stampFontSize(text, upright.width, upright.height, measure);
      const border = Math.max(1.5, Math.min(upright.width, upright.height) * 0.06);
      return (
        <g transform={transform} opacity={a.opacity}>
          <rect
            x={border / 2}
            y={border / 2}
            width={upright.width - border}
            height={upright.height - border}
            fill="none"
            stroke={a.color}
            strokeWidth={border}
          />
          <text
            x={upright.width / 2}
            y={upright.height / 2 + size * 0.35}
            textAnchor="middle"
            fontFamily={CSS_FONTS.Helvetica}
            fontWeight={700}
            fontSize={size}
            fill={a.color}
          >
            {text}
          </text>
        </g>
      );
    }
    case 'image': {
      const { upright, transform } = uprightFrame(a, frame);
      const url = imageUrl(a.imageId);
      return (
        <g transform={transform} opacity={a.opacity}>
          {url ? (
            <image
              href={url}
              width={upright.width}
              height={upright.height}
              preserveAspectRatio="none"
            />
          ) : (
            <rect width={upright.width} height={upright.height} fill="#ddd" />
          )}
        </g>
      );
    }
    case 'rect':
    case 'ellipse':
    case 'highlight':
    case 'whiteout':
    case 'redact': {
      const b = boxPageToView(a, frame.width, frame.height, frame.rotation);
      if (a.type === 'ellipse') {
        return (
          <ellipse
            cx={b.x + b.w / 2}
            cy={b.y + b.h / 2}
            rx={b.w / 2}
            ry={b.h / 2}
            fill={a.fill ?? 'none'}
            stroke={a.stroke ?? 'none'}
            strokeWidth={a.lineWidth}
            opacity={a.opacity}
          />
        );
      }
      if (a.type === 'rect') {
        return (
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            fill={a.fill ?? 'none'}
            stroke={a.stroke ?? 'none'}
            strokeWidth={a.lineWidth}
            opacity={a.opacity}
          />
        );
      }
      if (a.type === 'highlight') {
        return (
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            fill={a.color}
            opacity={a.opacity}
            style={{ mixBlendMode: 'multiply' }}
          />
        );
      }
      if (a.type === 'whiteout') {
        return (
          <g>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={a.color} />
            {editorHints && (
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={0.75}
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        );
      }
      return editorHints ? (
        <g>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#000" opacity={0.72} />
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            fill="none"
            stroke="#dc2626"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {b.h > 10 && b.w > 34 && (
            <text
              x={b.x + 3}
              y={b.y + Math.min(10, b.h - 2)}
              fontSize={Math.min(9, b.h - 2)}
              fill="#fca5a5"
              fontFamily={CSS_FONTS.Helvetica}
              fontWeight={700}
            >
              REDACT
            </text>
          )}
        </g>
      ) : (
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#000" />
      );
    }
    case 'line':
    case 'arrow': {
      const p1 = pageToView({ x: a.x1, y: a.y1 }, frame.width, frame.height, frame.rotation);
      const p2 = pageToView({ x: a.x2, y: a.y2 }, frame.width, frame.height, frame.rotation);
      if (a.type === 'line') {
        return (
          <line
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={a.stroke}
            strokeWidth={a.lineWidth}
            strokeLinecap="round"
            opacity={a.opacity}
          />
        );
      }
      const head = arrowHead(p1.x, p1.y, p2.x, p2.y, a.lineWidth);
      const back = Math.max(8, a.lineWidth * 4) * 0.8;
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      return (
        <g opacity={a.opacity}>
          <line
            x1={p1.x}
            y1={p1.y}
            x2={p2.x - back * Math.cos(angle)}
            y2={p2.y - back * Math.sin(angle)}
            stroke={a.stroke}
            strokeWidth={a.lineWidth}
            strokeLinecap="round"
          />
          <polygon points={head.join(' ')} fill={a.stroke} />
        </g>
      );
    }
    case 'ink':
      return (
        <g
          opacity={a.opacity}
          fill="none"
          stroke={a.stroke}
          strokeWidth={a.lineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {a.strokes.map((stroke, i) => {
            const points: string[] = [];
            for (let j = 0; j < stroke.length; j += 2) {
              const p = pageToView(
                { x: stroke[j], y: stroke[j + 1] },
                frame.width,
                frame.height,
                frame.rotation,
              );
              points.push(`${p.x},${p.y}`);
            }
            return <polyline key={i} points={points.join(' ')} />;
          })}
        </g>
      );
  }
});

/** All annotations of a page, in view space. */
export function AnnotationShapes({
  page,
  editingId,
  editorHints,
}: {
  page: WorkspacePage;
  editingId?: string | null;
  editorHints?: boolean;
}) {
  const rotation = effectiveRotation(page);
  const frame = { width: page.size.width, height: page.size.height, rotation };
  return (
    <>
      {page.annotations.map((a) => (
        <AnnotationShape
          key={a.id}
          annotation={a}
          frame={frame}
          editing={a.id === editingId}
          editorHints={editorHints}
        />
      ))}
    </>
  );
}

export { viewSize };
