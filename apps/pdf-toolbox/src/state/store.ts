import { createId } from '@shared/lib/id';
import { create } from 'zustand';
import type {
  Annotation,
  FontFamily,
  FormValue,
  Rotation,
  SourceInfo,
  TextAlign,
  WorkspacePage,
} from '../core/types';
import { normalizeRotation } from '../core/types';

export type Tool =
  | 'select'
  | 'text'
  | 'ink'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'whiteout'
  | 'redact'
  | 'stamp'
  | 'image';

export interface ToolStyle {
  color: string;
  fill: string | null;
  lineWidth: number;
  fontSize: number;
  font: FontFamily;
  bold: boolean;
  align: TextAlign;
  opacity: number;
  highlightColor: string;
  stampText: string;
  stampColor: string;
}

export type Mode = 'organize' | 'edit';

interface Snapshot {
  pages: WorkspacePage[];
  formValues: Record<string, Record<string, FormValue>>;
}

interface State extends Snapshot {
  sources: Record<string, SourceInfo>;
  /** Selected page ids (organize mode and thumbnails). */
  selection: string[];
  anchor: string | null;
  currentPageId: string | null;
  mode: Mode;
  tool: Tool;
  style: ToolStyle;
  selectedAnnotationId: string | null;
  /** Image waiting to be placed with the image tool. */
  pendingImage: { imageId: string; signature: boolean; aspect: number } | null;
  flattenForms: boolean;
  zoom: number;
  fitWidth: boolean;
  busy: { message: string; progress?: number } | null;
  past: Snapshot[];
  future: Snapshot[];
}

const HISTORY_LIMIT = 100;

export const DEFAULT_STYLE: ToolStyle = {
  color: '#1d4ed8',
  fill: null,
  lineWidth: 2,
  fontSize: 14,
  font: 'Helvetica',
  bold: false,
  align: 'left',
  opacity: 1,
  highlightColor: '#facc15',
  stampText: 'APPROVED',
  stampColor: '#15803d',
};

export const useStore = create<State>(() => ({
  pages: [],
  formValues: {},
  sources: {},
  selection: [],
  anchor: null,
  currentPageId: null,
  mode: 'organize',
  tool: 'select',
  style: DEFAULT_STYLE,
  selectedAnnotationId: null,
  pendingImage: null,
  flattenForms: false,
  zoom: 1,
  fitWidth: true,
  busy: null,
  past: [],
  future: [],
}));

const set = useStore.setState;
const get = useStore.getState;

// --------------------------------------------------------------------------------------
// Undo / redo

/** Records the current state as an undo step. Call before a (group of) change(s). */
export function checkpoint() {
  const { pages, formValues, past } = get();
  set({ past: [...past.slice(-(HISTORY_LIMIT - 1)), { pages, formValues }], future: [] });
}

export function undo() {
  const { past, future, pages, formValues } = get();
  const previous = past[past.length - 1];
  if (!previous) return;
  set({
    ...previous,
    past: past.slice(0, -1),
    future: [{ pages, formValues }, ...future],
    selectedAnnotationId: null,
  });
  repairSelection();
}

export function redo() {
  const { past, future, pages, formValues } = get();
  const next = future[0];
  if (!next) return;
  set({
    ...next,
    future: future.slice(1),
    past: [...past, { pages, formValues }],
    selectedAnnotationId: null,
  });
  repairSelection();
}

function repairSelection() {
  const { pages, selection, currentPageId } = get();
  const ids = new Set(pages.map((p) => p.id));
  set({
    selection: selection.filter((id) => ids.has(id)),
    currentPageId: currentPageId && ids.has(currentPageId) ? currentPageId : (pages[0]?.id ?? null),
  });
}

// --------------------------------------------------------------------------------------
// Sources & pages

export function addSource(
  info: SourceInfo,
  pages: Array<Omit<WorkspacePage, 'id' | 'annotations' | 'rotation'>>,
  insertAt?: number,
) {
  checkpoint();
  const newPages: WorkspacePage[] = pages.map((p) => ({
    ...p,
    id: createId(),
    rotation: 0,
    annotations: [],
  }));
  set((s) => {
    const all = [...s.pages];
    all.splice(insertAt ?? all.length, 0, ...newPages);
    return {
      sources: { ...s.sources, [info.id]: info },
      pages: all,
      currentPageId: s.currentPageId ?? newPages[0]?.id ?? null,
    };
  });
  return newPages;
}

export function closeAll() {
  set({
    pages: [],
    formValues: {},
    sources: {},
    selection: [],
    anchor: null,
    currentPageId: null,
    selectedAnnotationId: null,
    pendingImage: null,
    past: [],
    future: [],
    mode: 'organize',
    tool: 'select',
  });
}

export function setMode(mode: Mode) {
  const { currentPageId, selection, pages } = get();
  set({
    mode,
    currentPageId:
      mode === 'edit' ? (selection[0] ?? currentPageId ?? pages[0]?.id ?? null) : currentPageId,
    selectedAnnotationId: null,
  });
}

export function openPageInEditor(pageId: string) {
  set({
    mode: 'edit',
    currentPageId: pageId,
    selection: [pageId],
    anchor: pageId,
    selectedAnnotationId: null,
  });
}

export function setCurrentPage(pageId: string) {
  set({ currentPageId: pageId, selectedAnnotationId: null });
}

/** Click selection semantics: plain = single, Ctrl/Cmd = toggle, Shift = range. */
export function selectPage(pageId: string, modifiers: { toggle?: boolean; range?: boolean } = {}) {
  const { pages, selection, anchor } = get();
  if (modifiers.range && anchor) {
    const a = pages.findIndex((p) => p.id === anchor);
    const b = pages.findIndex((p) => p.id === pageId);
    if (a >= 0 && b >= 0) {
      const [from, to] = a < b ? [a, b] : [b, a];
      const range = pages.slice(from, to + 1).map((p) => p.id);
      set({
        selection: modifiers.toggle ? [...new Set([...selection, ...range])] : range,
        currentPageId: pageId,
      });
      return;
    }
  }
  if (modifiers.toggle) {
    set({
      selection: selection.includes(pageId)
        ? selection.filter((id) => id !== pageId)
        : [...selection, pageId],
      anchor: pageId,
      currentPageId: pageId,
    });
    return;
  }
  set({ selection: [pageId], anchor: pageId, currentPageId: pageId });
}

export function selectAll() {
  set((s) => ({ selection: s.pages.map((p) => p.id) }));
}

export function clearSelection() {
  set({ selection: [] });
}

/** Pages the page operations apply to: the selection, or the current page in edit mode. */
export function targetPageIds(): string[] {
  const { selection, mode, currentPageId } = get();
  if (selection.length) return selection;
  if (mode === 'edit' && currentPageId) return [currentPageId];
  return [];
}

export function rotatePages(ids: string[], delta: number) {
  if (!ids.length) return;
  checkpoint();
  const target = new Set(ids);
  set((s) => ({
    pages: s.pages.map((p) =>
      target.has(p.id) ? { ...p, rotation: normalizeRotation(p.rotation + delta) as Rotation } : p,
    ),
  }));
}

export function deletePages(ids: string[]) {
  if (!ids.length) return;
  checkpoint();
  const target = new Set(ids);
  set((s) => {
    const index = s.pages.findIndex((p) => target.has(p.id));
    const pages = s.pages.filter((p) => !target.has(p.id));
    const fallback = pages[Math.min(Math.max(index, 0), pages.length - 1)]?.id ?? null;
    return {
      pages,
      selection: [],
      currentPageId: s.currentPageId && !target.has(s.currentPageId) ? s.currentPageId : fallback,
      selectedAnnotationId: null,
    };
  });
}

export function duplicatePages(ids: string[]) {
  if (!ids.length) return;
  checkpoint();
  const target = new Set(ids);
  const copies: string[] = [];
  set((s) => {
    const pages: WorkspacePage[] = [];
    for (const page of s.pages) {
      pages.push(page);
      if (target.has(page.id)) {
        const copy = {
          ...page,
          id: createId(),
          annotations: page.annotations.map((a) => ({ ...a, id: createId() })),
        };
        copies.push(copy.id);
        pages.push(copy);
      }
    }
    return { pages, selection: copies };
  });
}

/** Moves the given pages so they start at `targetIndex` (index in the list before moving). */
export function movePages(ids: string[], targetIndex: number) {
  const { pages } = get();
  const moving = new Set(ids);
  const moved = pages.filter((p) => moving.has(p.id));
  if (!moved.length) return;
  const before = pages.slice(0, targetIndex).filter((p) => !moving.has(p.id));
  const after = pages.slice(targetIndex).filter((p) => !moving.has(p.id));
  const next = [...before, ...moved, ...after];
  if (next.every((p, i) => p === pages[i])) return;
  checkpoint();
  set({ pages: next });
}

export function movePageBy(id: string, delta: number) {
  const { pages } = get();
  const index = pages.findIndex((p) => p.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= pages.length) return;
  movePages([id], delta > 0 ? target + 1 : target);
}

// --------------------------------------------------------------------------------------
// Annotations

export function setTool(tool: Tool) {
  set({
    tool,
    selectedAnnotationId: tool === 'select' ? get().selectedAnnotationId : null,
    pendingImage: tool === 'image' ? get().pendingImage : null,
  });
}

export function setStyle(patch: Partial<ToolStyle>) {
  set((s) => ({ style: { ...s.style, ...patch } }));
}

export function setPendingImage(pending: State['pendingImage']) {
  set({ pendingImage: pending, tool: pending ? 'image' : get().tool });
}

export function selectAnnotation(id: string | null) {
  set({ selectedAnnotationId: id });
}

export function addAnnotation(pageId: string, annotation: Annotation) {
  checkpoint();
  set((s) => ({
    pages: s.pages.map((p) =>
      p.id === pageId ? { ...p, annotations: [...p.annotations, annotation] } : p,
    ),
    selectedAnnotationId: annotation.id,
  }));
}

/** Updates an annotation. Pass `record: true` to create an undo step (not for every drag move). */
export function updateAnnotation(
  pageId: string,
  annotationId: string,
  patch: Partial<Annotation> | ((a: Annotation) => Annotation),
  record = false,
) {
  if (record) checkpoint();
  set((s) => ({
    pages: s.pages.map((p) =>
      p.id === pageId
        ? {
            ...p,
            annotations: p.annotations.map((a) =>
              a.id === annotationId
                ? typeof patch === 'function'
                  ? patch(a)
                  : ({ ...a, ...patch } as Annotation)
                : a,
            ),
          }
        : p,
    ),
  }));
}

export function deleteAnnotation(pageId: string, annotationId: string) {
  checkpoint();
  set((s) => ({
    pages: s.pages.map((p) =>
      p.id === pageId
        ? { ...p, annotations: p.annotations.filter((a) => a.id !== annotationId) }
        : p,
    ),
    selectedAnnotationId: s.selectedAnnotationId === annotationId ? null : s.selectedAnnotationId,
  }));
}

export function reorderAnnotation(pageId: string, annotationId: string, toFront: boolean) {
  checkpoint();
  set((s) => ({
    pages: s.pages.map((p) => {
      if (p.id !== pageId) return p;
      const target = p.annotations.find((a) => a.id === annotationId);
      if (!target) return p;
      const rest = p.annotations.filter((a) => a.id !== annotationId);
      return { ...p, annotations: toFront ? [...rest, target] : [target, ...rest] };
    }),
  }));
}

// --------------------------------------------------------------------------------------
// Forms

export function setFormValue(sourceId: string, name: string, value: FormValue, record = true) {
  if (record) checkpoint();
  set((s) => ({
    formValues: { ...s.formValues, [sourceId]: { ...s.formValues[sourceId], [name]: value } },
  }));
}

export function setFlattenForms(flatten: boolean) {
  set({ flattenForms: flatten });
}

export function formValue(sourceId: string, name: string): FormValue | undefined {
  const state = get();
  const edited = state.formValues[sourceId]?.[name];
  if (edited !== undefined) return edited;
  return state.sources[sourceId]?.formFields.find((f) => f.name === name)?.value;
}

// --------------------------------------------------------------------------------------
// View

export function setZoom(zoom: number, fitWidth = false) {
  set({ zoom: Math.min(5, Math.max(0.25, zoom)), fitWidth });
}

export function setBusy(busy: State['busy']) {
  set({ busy });
}
