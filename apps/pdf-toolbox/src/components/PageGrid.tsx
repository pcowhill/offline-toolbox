import { Copy, PenLine, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { WorkspacePage } from '../core/types';
import {
  deletePages,
  duplicatePages,
  movePageBy,
  movePages,
  openPageInEditor,
  rotatePages,
  selectPage,
  useStore,
} from '../state/store';
import { Thumbnail } from './Thumbnail';

const DRAG_TYPE = 'application/x-pdf-toolbox-pages';

interface Props {
  /** Thumbnail width in CSS pixels. */
  size: number;
  /** Compact single-column strip (edit mode). */
  compact?: boolean;
}

/** Page thumbnails with multi-selection, drag-and-drop and keyboard reordering. */
export function PageGrid({ size, compact }: Props) {
  const pages = useStore((s) => s.pages);
  const sources = useStore((s) => s.sources);
  const selection = useStore((s) => s.selection);
  const currentPageId = useStore((s) => s.currentPageId);
  const mode = useStore((s) => s.mode);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = new Set(selection);

  const focusCard = (index: number) => {
    const cards = listRef.current?.querySelectorAll<HTMLElement>('[data-page-card]');
    cards?.[Math.max(0, Math.min(index, (cards?.length ?? 1) - 1))]?.focus();
  };

  const onDragStart = (event: DragEvent, page: WorkspacePage) => {
    const ids = selected.has(page.id)
      ? pages.filter((p) => selected.has(p.id)).map((p) => p.id)
      : [page.id];
    if (!selected.has(page.id)) selectPage(page.id);
    setDragging(ids);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.setData('text/plain', `${ids.length} page(s)`);
  };

  const onDragOver = (event: DragEvent, index: number) => {
    if (!Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after = compact
      ? event.clientY > rect.top + rect.height / 2
      : event.clientX > rect.left + rect.width / 2;
    setDropIndex(index + (after ? 1 : 0));
  };

  const onDrop = (event: DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
    event.preventDefault();
    const ids = JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || '[]') as string[];
    if (dropIndex !== null && ids.length) movePages(ids, dropIndex);
    setDropIndex(null);
    setDragging(null);
  };

  const onKeyDown = (event: KeyboardEvent, page: WorkspacePage, index: number) => {
    const columns = compact
      ? 1
      : Math.max(1, Math.floor((listRef.current?.clientWidth ?? size) / (size + 24)));
    const mod = event.ctrlKey || event.metaKey;
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    if (event.key in step) {
      event.preventDefault();
      if (mod && event.shiftKey) {
        movePageBy(page.id, step[event.key] > 0 ? 1 : -1);
        requestAnimationFrame(() => focusCard(index + (step[event.key] > 0 ? 1 : -1)));
        return;
      }
      const next = pages[Math.max(0, Math.min(pages.length - 1, index + step[event.key]))];
      if (next) {
        selectPage(next.id, { range: event.shiftKey });
        focusCard(pages.indexOf(next));
      }
    } else if (event.key === ' ') {
      event.preventDefault();
      selectPage(page.id, { toggle: true });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openPageInEditor(page.id);
    }
  };

  return (
    <div
      ref={listRef}
      className={`page-grid${compact ? ' page-grid--compact' : ''}`}
      role="listbox"
      aria-multiselectable
      aria-label="Pages"
      data-testid="page-grid"
      onDragLeave={(e) => {
        if (!listRef.current?.contains(e.relatedTarget as Node)) setDropIndex(null);
      }}
      onDrop={onDrop}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) e.preventDefault();
      }}
    >
      {pages.map((page, index) => {
        const isSelected = selected.has(page.id);
        const isCurrent = mode === 'edit' && page.id === currentPageId;
        const source = sources[page.sourceId];
        return (
          <div
            key={page.id}
            className={`page-card${isSelected ? ' is-selected' : ''}${isCurrent ? ' is-current' : ''}${dragging?.includes(page.id) ? ' is-dragging' : ''}`}
            style={{ width: size + 16 }}
            role="option"
            aria-selected={isSelected}
            aria-label={`Page ${index + 1}${source ? ` (${source.name}, page ${page.sourceIndex + 1})` : ''}`}
            tabIndex={isCurrent || (index === 0 && !currentPageId) ? 0 : -1}
            data-page-card
            data-testid="page-card"
            draggable
            onDragStart={(e) => onDragStart(e, page)}
            onDragEnd={() => {
              setDragging(null);
              setDropIndex(null);
            }}
            onDragOver={(e) => onDragOver(e, index)}
            onClick={(e) =>
              selectPage(page.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })
            }
            onDoubleClick={() => openPageInEditor(page.id)}
            onKeyDown={(e) => onKeyDown(e, page, index)}
          >
            {dropIndex === index && (
              <span className="page-card__drop page-card__drop--before" aria-hidden />
            )}
            {dropIndex === index + 1 && index === pages.length - 1 && (
              <span className="page-card__drop page-card__drop--after" aria-hidden />
            )}
            <div className="page-card__thumb">
              <Thumbnail page={page} width={size} />
              {!compact && (
                <div className="page-card__actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-chip"
                    title="Rotate left"
                    aria-label={`Rotate page ${index + 1} left`}
                    onClick={() => rotatePages([page.id], -90)}
                  >
                    <RotateCcw aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-chip"
                    title="Rotate right"
                    aria-label={`Rotate page ${index + 1} right`}
                    onClick={() => rotatePages([page.id], 90)}
                    data-testid="card-rotate"
                  >
                    <RotateCw aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-chip"
                    title="Duplicate"
                    aria-label={`Duplicate page ${index + 1}`}
                    onClick={() => duplicatePages([page.id])}
                  >
                    <Copy aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-chip"
                    title="Edit page"
                    aria-label={`Edit page ${index + 1}`}
                    onClick={() => openPageInEditor(page.id)}
                  >
                    <PenLine aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-chip icon-chip--danger"
                    title="Delete"
                    aria-label={`Delete page ${index + 1}`}
                    onClick={() => deletePages([page.id])}
                    data-testid="card-delete"
                  >
                    <Trash2 aria-hidden />
                  </button>
                </div>
              )}
            </div>
            <div className="page-card__label">
              <span className="page-card__number" data-testid="page-number">
                {index + 1}
              </span>
              {!compact && source && (
                <span className="page-card__source" title={source.name}>
                  {source.name} · p{page.sourceIndex + 1}
                </span>
              )}
              {page.annotations.length > 0 && (
                <span className="page-card__badge" title={`${page.annotations.length} edit(s)`}>
                  ✎{page.annotations.length}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
