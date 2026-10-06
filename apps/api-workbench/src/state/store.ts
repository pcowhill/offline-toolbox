import { useMemo } from 'react';
import { createId } from '@shared/lib/id';
import { toast } from '@shared/react/toasts';
import { create } from 'zustand';
import {
  duplicateItem,
  insertItem,
  locateItem,
  moveItem,
  removeItem,
  renameItem,
  updateRequestInCollection,
  type ItemLocation,
} from '../core/collections';
import {
  cloneRequestSpec,
  createCollection,
  createEnvironment,
  createRequestSpec,
} from '../core/factory';
import { addToHistory, createHistoryEntry } from '../core/history';
import type { ApiSpec } from '../core/openapi';
import { prepareRequest, type PreparedRequest } from '../core/request';
import { stripRequestSecrets } from '../core/sanitize';
import { openRepository, type Repository, type Session } from '../core/storage';
import { defaultTransport, RequestError, type ResponseData } from '../core/transport';
import type {
  Collection,
  Environment,
  HistoryEntry,
  RequestSpec,
  SavedRequest,
} from '../core/types';
import { environmentVariables } from '../core/variables';

export interface RequestTab {
  kind: 'request';
  id: string;
  title: string;
  savedRequestId?: string;
  request: RequestSpec;
  dirty: boolean;
  sending: boolean;
  response?: ResponseData;
  error?: { kind: string; message: string; detail: string; durationMs: number; url: string };
  /** What was actually sent (after variable substitution) for the current response. */
  sent?: PreparedRequest;
  warnings: string[];
}

export interface OperationTab {
  kind: 'operation';
  id: string;
  title: string;
  specId: string;
  operationId: string;
}

export type Tab = RequestTab | OperationTab;

export type SidebarView = 'collections' | 'history' | 'specs';

interface State {
  ready: boolean;
  persistent: boolean;
  collections: Collection[];
  environments: Environment[];
  history: HistoryEntry[];
  specs: ApiSpec[];
  activeEnvironmentId: string | null;
  /** In-memory values of variables that are not persisted, keyed by variable id. */
  sessionValues: Record<string, string>;
  tabs: Tab[];
  activeTabId: string | null;
  sidebarView: SidebarView;
}

/** Runtime-only objects that must never be serialised. */
const abortControllers = new Map<string, AbortController>();
export const multipartFiles = new Map<string, File>();

let repository: Repository | null = null;
const persist = (fn: (repo: Repository) => Promise<unknown>) => {
  if (!repository) return;
  fn(repository).catch((error: unknown) => {
    console.error(error);
    toast(`Could not save to browser storage: ${(error as Error).message}`, 'error');
  });
};

function newRequestTab(partial: Partial<RequestTab> = {}): RequestTab {
  return {
    kind: 'request',
    id: createId(),
    title: 'Untitled request',
    request: createRequestSpec(),
    dirty: false,
    sending: false,
    warnings: [],
    ...partial,
  };
}

export const useStore = create<State>(() => ({
  ready: false,
  persistent: true,
  collections: [],
  environments: [],
  history: [],
  specs: [],
  activeEnvironmentId: null,
  sessionValues: {},
  tabs: [],
  activeTabId: null,
  sidebarView: 'collections',
}));

const set = useStore.setState;
const get = useStore.getState;

// --------------------------------------------------------------------------------------
// Initialisation & session persistence

export async function initStore() {
  repository = await openRepository();
  const data = await repository.loadAll();
  const tabs: Tab[] = (data.session?.tabs ?? []).map((t) =>
    newRequestTab({
      id: t.id,
      title: t.title,
      savedRequestId: t.savedRequestId,
      request: t.request,
    }),
  );
  if (tabs.length === 0) tabs.push(newRequestTab());
  const activeTabId = tabs.some((t) => t.id === data.session?.activeTabId)
    ? data.session!.activeTabId
    : tabs[0].id;
  set({
    ready: true,
    persistent: repository.persistent,
    collections: data.collections,
    environments: data.environments,
    history: data.history,
    specs: data.specs,
    activeEnvironmentId: data.environments.some((e) => e.id === data.session?.activeEnvironmentId)
      ? data.session!.activeEnvironmentId
      : null,
    tabs,
    activeTabId,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((state, previous) => {
    if (
      state.tabs === previous.tabs &&
      state.activeTabId === previous.activeTabId &&
      state.activeEnvironmentId === previous.activeEnvironmentId
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const current = get();
      const session: Session = {
        activeEnvironmentId: current.activeEnvironmentId,
        activeTabId: current.activeTabId,
        tabs: current.tabs
          .filter((t): t is RequestTab => t.kind === 'request')
          .map((t) => ({
            id: t.id,
            title: t.title,
            savedRequestId: t.savedRequestId,
            request: t.request,
          })),
      };
      persist((repo) => repo.saveSession(session));
    }, 400);
  });
}

// --------------------------------------------------------------------------------------
// Selectors

export function activeEnvironment(state: State = get()): Environment | undefined {
  return state.environments.find((e) => e.id === state.activeEnvironmentId);
}

export function currentVariables(state: State = get()) {
  return environmentVariables(activeEnvironment(state), state.sessionValues);
}

export function activeTab(state: State = get()): Tab | undefined {
  return state.tabs.find((t) => t.id === state.activeTabId);
}

// --------------------------------------------------------------------------------------
// Tabs

export function setSidebarView(view: SidebarView) {
  set({ sidebarView: view });
}

export function openNewTab(request?: RequestSpec, title?: string) {
  const tab = newRequestTab({
    request: request ?? createRequestSpec(),
    title: title ?? 'Untitled request',
    dirty: !!request,
  });
  set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  return tab.id;
}

export function activateTab(id: string) {
  set({ activeTabId: id });
}

export function closeTab(id: string) {
  abortControllers.get(id)?.abort();
  set((s) => {
    const index = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    if (tabs.length === 0) tabs.push(newRequestTab());
    const activeTabId =
      s.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)].id : s.activeTabId;
    return { tabs, activeTabId };
  });
}

function patchTab(
  id: string,
  patch: Partial<RequestTab> | ((tab: RequestTab) => Partial<RequestTab>),
) {
  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === id && t.kind === 'request'
        ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) }
        : t,
    ),
  }));
}

export function updateRequest(tabId: string, updater: (request: RequestSpec) => RequestSpec) {
  patchTab(tabId, (tab) => ({ request: updater(tab.request), dirty: true }));
}

export function openSavedRequest(id: string) {
  const existing = get().tabs.find((t) => t.kind === 'request' && t.savedRequestId === id);
  if (existing) {
    set({ activeTabId: existing.id });
    return;
  }
  const located = locateItem(get().collections, id);
  if (!located || located.item.type !== 'request') return;
  const tab = newRequestTab({
    title: located.item.name,
    savedRequestId: id,
    request: cloneRequestSpec(located.item.request),
  });
  set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
}

export function openOperationTab(specId: string, operationId: string, title: string) {
  const existing = get().tabs.find((t) => t.kind === 'operation' && t.operationId === operationId);
  if (existing) {
    set({ activeTabId: existing.id });
    return;
  }
  const tab: OperationTab = { kind: 'operation', id: createId(), title, specId, operationId };
  set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
}

// --------------------------------------------------------------------------------------
// Sending

export async function sendRequest(tabId: string) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== 'request' || tab.sending) return;
  const prepared = prepareRequest(tab.request, currentVariables(), { files: multipartFiles });
  if (!prepared.request) {
    patchTab(tabId, { warnings: prepared.warnings, error: undefined });
    toast(prepared.errors.join('\n'), 'error');
    return;
  }
  const controller = new AbortController();
  abortControllers.set(tabId, controller);
  patchTab(tabId, { sending: true, warnings: prepared.warnings, error: undefined });
  const request = prepared.request;
  try {
    const response = await defaultTransport.send(request, controller.signal);
    patchTab(tabId, { sending: false, response, sent: request, error: undefined });
    recordHistory(tab.request, {
      status: response.status,
      statusText: response.statusText,
      durationMs: response.durationMs,
      sizeBytes: response.sizeBytes,
    });
  } catch (error) {
    const err =
      error instanceof RequestError
        ? error
        : new RequestError(
            'unknown',
            (error as Error)?.message ?? 'Request failed',
            String(error),
            0,
          );
    patchTab(tabId, {
      sending: false,
      response: undefined,
      sent: request,
      error: {
        kind: err.kind,
        message: err.message,
        detail: err.detail,
        durationMs: err.durationMs,
        url: request.url,
      },
    });
    if (err.kind !== 'cancelled')
      recordHistory(tab.request, { error: err.message, durationMs: err.durationMs });
  } finally {
    abortControllers.delete(tabId);
  }
}

export function cancelRequest(tabId: string) {
  abortControllers.get(tabId)?.abort();
}

function recordHistory(request: RequestSpec, outcome: Parameters<typeof createHistoryEntry>[1]) {
  const entry = createHistoryEntry(request, outcome);
  const { entries, evicted } = addToHistory(get().history, entry);
  set({ history: entries });
  persist(async (repo) => {
    await repo.addHistory(entry);
    for (const old of evicted) await repo.deleteHistory(old.id);
  });
}

export function deleteHistoryEntry(id: string) {
  set((s) => ({ history: s.history.filter((h) => h.id !== id) }));
  persist((repo) => repo.deleteHistory(id));
}

export function clearHistory() {
  set({ history: [] });
  persist((repo) => repo.clearHistory());
}

export function openHistoryEntry(id: string) {
  const entry = get().history.find((h) => h.id === id);
  if (!entry) return;
  const tab = newRequestTab({
    title: `${entry.method} ${shortUrl(entry.url)}`,
    request: cloneRequestSpec(entry.request),
    dirty: true,
  });
  set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
}

export function shortUrl(url: string): string {
  const withoutScheme = url.replace(/^https?:\/\//, '');
  return withoutScheme.length > 40 ? `${withoutScheme.slice(0, 37)}…` : withoutScheme || 'request';
}

// --------------------------------------------------------------------------------------
// Collections

function commitCollection(collection: Collection) {
  set((s) => ({
    collections: s.collections.map((c) => (c.id === collection.id ? collection : c)),
  }));
  persist((repo) => repo.saveCollection(collection));
}

export function createNewCollection(name: string): Collection {
  const collection = createCollection(name);
  set((s) => ({ collections: [...s.collections, collection] }));
  persist((repo) => repo.saveCollection(collection));
  return collection;
}

export function renameCollection(id: string, name: string) {
  const collection = get().collections.find((c) => c.id === id);
  if (collection) commitCollection({ ...collection, name, updatedAt: Date.now() });
}

export function deleteCollection(id: string) {
  set((s) => ({
    collections: s.collections.filter((c) => c.id !== id),
    tabs: s.tabs.map((t) =>
      t.kind === 'request' &&
      t.savedRequestId &&
      !locateItem(
        s.collections.filter((c) => c.id !== id),
        t.savedRequestId,
      )
        ? { ...t, savedRequestId: undefined, dirty: true }
        : t,
    ),
  }));
  persist((repo) => repo.deleteCollection(id));
}

export function addFolder(collectionId: string, parentFolderId: string | null, name: string) {
  const collection = get().collections.find((c) => c.id === collectionId);
  if (!collection) return;
  commitCollection(
    insertItem(collection, parentFolderId, { type: 'folder', id: createId(), name, items: [] }),
  );
}

export function renameItemInCollections(itemId: string, name: string) {
  const located = locateItem(get().collections, itemId);
  if (!located) return;
  commitCollection(renameItem(located.collection, itemId, name));
  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.kind === 'request' && t.savedRequestId === itemId ? { ...t, title: name } : t,
    ),
  }));
}

export function duplicateItemInCollections(itemId: string) {
  const located = locateItem(get().collections, itemId);
  if (!located) return;
  commitCollection(duplicateItem(located.collection, itemId).collection);
}

export function deleteItemFromCollections(itemId: string) {
  const located = locateItem(get().collections, itemId);
  if (!located) return;
  commitCollection(removeItem(located.collection, itemId));
  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.kind === 'request' && t.savedRequestId && !locateItem(get().collections, t.savedRequestId)
        ? { ...t, savedRequestId: undefined, dirty: true }
        : t,
    ),
  }));
}

export function moveItemInCollections(itemId: string, target: ItemLocation) {
  const updated = moveItem(get().collections, itemId, target);
  const changed = updated.filter((c, i) => c !== get().collections[i]);
  set({ collections: updated });
  for (const c of changed) persist((repo) => repo.saveCollection(c));
}

/** Saves the tab's request: updates the linked saved request, or creates a new one. */
export function saveTabRequest(tabId: string, target?: { location: ItemLocation; name: string }) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== 'request') return;
  const request = stripForCollection(tab.request);
  if (!target && tab.savedRequestId) {
    const located = locateItem(get().collections, tab.savedRequestId);
    if (located) {
      commitCollection(updateRequestInCollection(located.collection, tab.savedRequestId, request));
      patchTab(tabId, { dirty: false });
      toast(`Saved "${located.item.name}"`, 'success');
      return;
    }
  }
  if (!target) return;
  const collection = get().collections.find((c) => c.id === target.location.collectionId);
  if (!collection) return;
  const item: SavedRequest = { type: 'request', id: createId(), name: target.name, request };
  commitCollection(insertItem(collection, target.location.folderId, item));
  patchTab(tabId, { savedRequestId: item.id, title: target.name, dirty: false });
  toast(`Saved "${target.name}" to ${collection.name}`, 'success');
}

/** The persisted copy loses unsaved credentials, but the open tab keeps them for this session. */
function stripForCollection(request: RequestSpec): RequestSpec {
  return stripRequestSecrets(structuredClone(request));
}

export function importData(collections: Collection[], environments: Environment[]) {
  set((s) => ({
    collections: [...s.collections, ...collections],
    environments: [...s.environments, ...environments],
  }));
  for (const c of collections) persist((repo) => repo.saveCollection(c));
  for (const e of environments) persist((repo) => repo.saveEnvironment(e));
}

// --------------------------------------------------------------------------------------
// Environments

export function setActiveEnvironment(id: string | null) {
  set({ activeEnvironmentId: id });
}

export function createNewEnvironment(name: string): Environment {
  const environment = createEnvironment(name);
  set((s) => ({ environments: [...s.environments, environment] }));
  persist((repo) => repo.saveEnvironment(environment));
  return environment;
}

export function saveEnvironment(environment: Environment, sessionValues: Record<string, string>) {
  const updated = { ...environment, updatedAt: Date.now() };
  set((s) => ({
    environments: s.environments.map((e) => (e.id === environment.id ? updated : e)),
    sessionValues: { ...s.sessionValues, ...sessionValues },
  }));
  persist((repo) => repo.saveEnvironment(updated));
}

export function deleteEnvironment(id: string) {
  set((s) => ({
    environments: s.environments.filter((e) => e.id !== id),
    activeEnvironmentId: s.activeEnvironmentId === id ? null : s.activeEnvironmentId,
  }));
  persist((repo) => repo.deleteEnvironment(id));
}

// --------------------------------------------------------------------------------------
// API specifications

export function addSpec(spec: ApiSpec) {
  set((s) => ({ specs: [...s.specs, spec] }));
  persist((repo) => repo.saveSpec(spec));
}

export function deleteSpec(id: string) {
  set((s) => ({
    specs: s.specs.filter((sp) => sp.id !== id),
    tabs: s.tabs.filter((t) => !(t.kind === 'operation' && t.specId === id)),
  }));
  if (!get().tabs.some((t) => t.id === get().activeTabId)) {
    const first = get().tabs[0];
    if (first) set({ activeTabId: first.id });
    else openNewTab();
  }
  persist((repo) => repo.deleteSpec(id));
}

/** Variable map of the active environment (memoised; safe to use in components). */
export function useVariables() {
  const environments = useStore((s) => s.environments);
  const activeEnvironmentId = useStore((s) => s.activeEnvironmentId);
  const sessionValues = useStore((s) => s.sessionValues);
  return useMemo(
    () =>
      environmentVariables(
        environments.find((e) => e.id === activeEnvironmentId),
        sessionValues,
      ),
    [environments, activeEnvironmentId, sessionValues],
  );
}
