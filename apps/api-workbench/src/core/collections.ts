// Pure (immutable) operations on collection trees.
import { createId } from '@shared/lib/id';
import { cloneRequestSpec } from './factory';
import type { Collection, CollectionItem, Folder, RequestSpec, SavedRequest } from './types';

export interface ItemLocation {
  collectionId: string;
  /** Folder id, or null for the collection root. */
  folderId: string | null;
}

export function findItem(items: CollectionItem[], id: string): CollectionItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.type === 'folder') {
      const found = findItem(item.items, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Locates a saved request (or folder) across all collections. */
export function locateItem(
  collections: Collection[],
  id: string,
): { collection: Collection; item: CollectionItem; parentFolderId: string | null } | undefined {
  const search = (
    items: CollectionItem[],
    parent: string | null,
  ): { item: CollectionItem; parentFolderId: string | null } | undefined => {
    for (const item of items) {
      if (item.id === id) return { item, parentFolderId: parent };
      if (item.type === 'folder') {
        const found = search(item.items, item.id);
        if (found) return found;
      }
    }
    return undefined;
  };
  for (const collection of collections) {
    const found = search(collection.items, null);
    if (found) return { collection, ...found };
  }
  return undefined;
}

function mapItems(
  items: CollectionItem[],
  fn: (item: CollectionItem) => CollectionItem | null,
): CollectionItem[] {
  const out: CollectionItem[] = [];
  for (const item of items) {
    const mapped = fn(item);
    if (!mapped) continue;
    out.push(mapped.type === 'folder' ? { ...mapped, items: mapItems(mapped.items, fn) } : mapped);
  }
  return out;
}

function touch(collection: Collection, items: CollectionItem[]): Collection {
  return { ...collection, items, updatedAt: Date.now() };
}

/** Inserts an item at the collection root or inside a folder (appended). */
export function insertItem(
  collection: Collection,
  folderId: string | null,
  item: CollectionItem,
): Collection {
  if (folderId === null) return touch(collection, [...collection.items, item]);
  let inserted = false;
  const items = mapItems(collection.items, (node) => {
    if (node.type === 'folder' && node.id === folderId) {
      inserted = true;
      return { ...node, items: [...node.items, item] };
    }
    return node;
  });
  if (!inserted) throw new Error('Folder not found.');
  return touch(collection, items);
}

export function removeItem(collection: Collection, id: string): Collection {
  return touch(
    collection,
    mapItems(collection.items, (node) => (node.id === id ? null : node)),
  );
}

export function renameItem(collection: Collection, id: string, name: string): Collection {
  return touch(
    collection,
    mapItems(collection.items, (node) => (node.id === id ? { ...node, name } : node)),
  );
}

export function updateRequestInCollection(
  collection: Collection,
  id: string,
  request: RequestSpec,
): Collection {
  return touch(
    collection,
    mapItems(collection.items, (node) =>
      node.id === id && node.type === 'request' ? { ...node, request } : node,
    ),
  );
}

/** Deep copy with new ids (for duplicate and import). */
export function cloneItem(item: CollectionItem, nameSuffix = ''): CollectionItem {
  if (item.type === 'request') {
    return {
      ...item,
      id: createId(),
      name: item.name + nameSuffix,
      request: cloneRequestSpec(item.request),
    };
  }
  return {
    ...item,
    id: createId(),
    name: item.name + nameSuffix,
    items: item.items.map((child) => cloneItem(child)),
  };
}

/** Duplicates an item and places the copy directly after the original. */
export function duplicateItem(
  collection: Collection,
  id: string,
): { collection: Collection; copy: CollectionItem } {
  let copy: CollectionItem | null = null;
  const duplicateIn = (items: CollectionItem[]): CollectionItem[] => {
    const out: CollectionItem[] = [];
    for (const item of items) {
      const current = item.type === 'folder' ? { ...item, items: duplicateIn(item.items) } : item;
      out.push(current);
      if (item.id === id) {
        copy = cloneItem(item, ' (copy)');
        out.push(copy);
      }
    }
    return out;
  };
  const items = duplicateIn(collection.items);
  if (!copy) throw new Error('Item not found.');
  return { collection: touch(collection, items), copy };
}

export function cloneCollection(collection: Collection, name?: string): Collection {
  const now = Date.now();
  return {
    ...collection,
    id: createId(),
    name: name ?? collection.name,
    items: collection.items.map((item) => cloneItem(item)),
    createdAt: now,
    updatedAt: now,
  };
}

/** Folder ids (with display paths) — used by "save to" and "move to" pickers. */
export function listFolders(collection: Collection): Array<{ id: string; path: string }> {
  const out: Array<{ id: string; path: string }> = [];
  const walk = (items: CollectionItem[], prefix: string) => {
    for (const item of items) {
      if (item.type === 'folder') {
        const path = prefix ? `${prefix} / ${item.name}` : item.name;
        out.push({ id: item.id, path });
        walk(item.items, path);
      }
    }
  };
  walk(collection.items, '');
  return out;
}

export function countRequests(items: CollectionItem[]): number {
  return items.reduce(
    (sum, item) => sum + (item.type === 'request' ? 1 : countRequests(item.items)),
    0,
  );
}

/** True when `candidateId` is `folderId` itself or nested inside it. */
export function isWithinFolder(folder: Folder, candidateId: string): boolean {
  if (folder.id === candidateId) return true;
  return folder.items.some((item) => item.type === 'folder' && isWithinFolder(item, candidateId));
}

/**
 * Moves an item to another location (possibly another collection). Returns the updated
 * collections array.
 */
export function moveItem(
  collections: Collection[],
  itemId: string,
  target: ItemLocation,
): Collection[] {
  const located = locateItem(collections, itemId);
  if (!located) throw new Error('Item not found.');
  if (
    located.item.type === 'folder' &&
    target.folderId &&
    isWithinFolder(located.item, target.folderId)
  ) {
    throw new Error('A folder cannot be moved into itself.');
  }
  const item = located.item;
  return collections.map((collection) => {
    let next = collection;
    if (collection.id === located.collection.id) next = removeItem(next, itemId);
    if (collection.id === target.collectionId) next = insertItem(next, target.folderId, item);
    return next;
  });
}

export function allRequests(collection: Collection): SavedRequest[] {
  const out: SavedRequest[] = [];
  const walk = (items: CollectionItem[]) => {
    for (const item of items) {
      if (item.type === 'request') out.push(item);
      else walk(item.items);
    }
  };
  walk(collection.items);
  return out;
}
