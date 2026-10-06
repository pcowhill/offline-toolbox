// IndexedDB persistence (local to this browser profile and origin). No cloud sync.
// All writes go through the sanitize helpers so unsaved secrets never reach disk.
import { stripCollectionSecrets, stripEnvironmentSecrets, stripRequestSecrets } from './sanitize';
import type { Collection, Environment, HistoryEntry, RequestSpec } from './types';
import type { ApiSpec } from './openapi';

export const DB_NAME = 'offline-toolbox.api-workbench';
export const DB_VERSION = 1;

export type StoreName = 'collections' | 'environments' | 'history' | 'specs' | 'meta';
const STORES: StoreName[] = ['collections', 'environments', 'history', 'specs', 'meta'];

export interface KeyValueBackend {
  getAll<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put<T>(store: StoreName, value: T, key?: string): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbBackend implements KeyValueBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory;
  private readonly name: string;

  constructor(factory: IDBFactory = indexedDB, name = DB_NAME) {
    this.factory = factory;
    this.name = name;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = this.factory.open(this.name, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const store of STORES) {
            if (!db.objectStoreNames.contains(store)) {
              db.createObjectStore(store, store === 'meta' ? undefined : { keyPath: 'id' });
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
        request.onblocked = () => reject(new Error('IndexedDB is blocked by another open tab.'));
      });
    }
    return this.dbPromise;
  }

  private async tx<T>(
    store: StoreName,
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.db();
    const transaction = db.transaction(store, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
    });
    const result = promisify(run(transaction.objectStore(store)));
    await Promise.all([result, done]);
    return result;
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return this.tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  }

  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return this.tx(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  }

  async put<T>(store: StoreName, value: T, key?: string): Promise<void> {
    await this.tx(store, 'readwrite', (s) =>
      key === undefined ? s.put(value) : s.put(value, key),
    );
  }

  async delete(store: StoreName, key: string): Promise<void> {
    await this.tx(store, 'readwrite', (s) => s.delete(key));
  }

  async clear(store: StoreName): Promise<void> {
    await this.tx(store, 'readwrite', (s) => s.clear());
  }
}

/** Fallback when IndexedDB is unavailable (e.g. some private-browsing modes). */
export class MemoryBackend implements KeyValueBackend {
  private data = new Map<StoreName, Map<string, unknown>>();

  private store(name: StoreName) {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return this.data.get(name)!;
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    return [...this.store(store).values()].map((v) => structuredClone(v) as T);
  }

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const value = this.store(store).get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async put<T>(store: StoreName, value: T, key?: string): Promise<void> {
    const id = key ?? (value as { id: string }).id;
    this.store(store).set(id, structuredClone(value));
  }

  async delete(store: StoreName, key: string): Promise<void> {
    this.store(store).delete(key);
  }

  async clear(store: StoreName): Promise<void> {
    this.store(store).clear();
  }
}

export interface OpenTabSnapshot {
  id: string;
  title: string;
  savedRequestId?: string;
  request: RequestSpec;
}

export interface Session {
  activeEnvironmentId: string | null;
  tabs: OpenTabSnapshot[];
  activeTabId: string | null;
}

/** Typed repository over a backend. */
export class Repository {
  readonly backend: KeyValueBackend;
  readonly persistent: boolean;

  constructor(backend: KeyValueBackend, persistent: boolean) {
    this.backend = backend;
    this.persistent = persistent;
  }

  async loadAll() {
    const [collections, environments, history, specs, session] = await Promise.all([
      this.backend.getAll<Collection>('collections'),
      this.backend.getAll<Environment>('environments'),
      this.backend.getAll<HistoryEntry>('history'),
      this.backend.getAll<ApiSpec>('specs'),
      this.backend.get<Session>('meta', 'session'),
    ]);
    return {
      collections: collections.sort((a, b) => a.createdAt - b.createdAt),
      environments: environments.sort((a, b) => a.createdAt - b.createdAt),
      history: history.sort((a, b) => b.timestamp - a.timestamp),
      specs: specs.sort((a, b) => a.importedAt - b.importedAt),
      session: session ?? null,
    };
  }

  saveCollection(collection: Collection) {
    return this.backend.put('collections', stripCollectionSecrets(collection));
  }

  deleteCollection(id: string) {
    return this.backend.delete('collections', id);
  }

  saveEnvironment(environment: Environment) {
    return this.backend.put('environments', stripEnvironmentSecrets(environment));
  }

  deleteEnvironment(id: string) {
    return this.backend.delete('environments', id);
  }

  addHistory(entry: HistoryEntry) {
    return this.backend.put('history', { ...entry, request: stripRequestSecrets(entry.request) });
  }

  deleteHistory(id: string) {
    return this.backend.delete('history', id);
  }

  clearHistory() {
    return this.backend.clear('history');
  }

  saveSpec(spec: ApiSpec) {
    return this.backend.put('specs', spec);
  }

  deleteSpec(id: string) {
    return this.backend.delete('specs', id);
  }

  saveSession(session: Session) {
    return this.backend.put(
      'meta',
      {
        ...session,
        tabs: session.tabs.map((tab) => ({ ...tab, request: stripRequestSecrets(tab.request) })),
      },
      'session',
    );
  }
}

export async function openRepository(): Promise<Repository> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB not available');
    const backend = new IndexedDbBackend();
    await backend.getAll('meta');
    return new Repository(backend, true);
  } catch (error) {
    console.warn('Falling back to in-memory storage:', error);
    return new Repository(new MemoryBackend(), false);
  }
}
