import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  countRequests,
  duplicateItem,
  insertItem,
  listFolders,
  locateItem,
  moveItem,
  removeItem,
  renameItem,
} from '../collections';
import { createExport, parseImport } from '../exchange';
import {
  createCollection,
  createEnvironment,
  createKeyValue,
  createRequestSpec,
  createVariable,
} from '../factory';
import { addToHistory, createHistoryEntry } from '../history';
import { IndexedDbBackend, MemoryBackend, Repository } from '../storage';
import type { Folder, SavedRequest } from '../types';

function request(name: string, url = 'http://h/' + name): SavedRequest {
  return { type: 'request', id: `${name}-id`, name, request: createRequestSpec({ url }) };
}

describe('collection tree operations', () => {
  it('insert, rename, duplicate, move and delete', () => {
    const folder: Folder = { type: 'folder', id: 'f1', name: 'Users', items: [] };
    let a = createCollection('A');
    a = insertItem(a, null, folder);
    a = insertItem(a, 'f1', request('list'));
    a = insertItem(a, null, request('health'));
    expect(countRequests(a.items)).toBe(2);
    expect(listFolders(a)).toEqual([{ id: 'f1', path: 'Users' }]);

    a = renameItem(a, 'list-id', 'List users');
    expect(locateItem([a], 'list-id')?.item.name).toBe('List users');

    const { collection, copy } = duplicateItem(a, 'list-id');
    a = collection;
    expect(copy.name).toBe('List users (copy)');
    expect(copy.id).not.toBe('list-id');
    expect((a.items[0] as Folder).items.map((i) => i.name)).toEqual([
      'List users',
      'List users (copy)',
    ]);

    let b = createCollection('B');
    [a, b] = moveItem([a, b], 'health-id', { collectionId: b.id, folderId: null });
    expect(countRequests(a.items)).toBe(2);
    expect(b.items.map((i) => i.id)).toEqual(['health-id']);
    expect(() => moveItem([a, b], 'f1', { collectionId: a.id, folderId: 'f1' })).toThrow(
      /into itself/,
    );

    a = removeItem(a, 'f1');
    expect(a.items).toEqual([]);
  });
});

describe('export / import', () => {
  it('round-trips collections and environments with new ids, without unsaved secrets', () => {
    let collection = createCollection('Demo');
    const saved = request('get-user');
    saved.request.auth = { type: 'bearer', token: 'literal-secret' };
    saved.request.headers = [createKeyValue({ key: 'Accept', value: 'application/json' })];
    collection = insertItem(collection, null, saved);
    const withCreds = request('basic');
    withCreds.request.auth = {
      type: 'basic',
      username: 'u',
      password: 'kept',
      saveCredentials: true,
    };
    collection = insertItem(collection, null, withCreds);
    const env = createEnvironment('Dev', [
      createVariable({ key: 'baseUrl', value: 'http://localhost' }),
      createVariable({ key: 'token', value: 'session-only' }),
      createVariable({ key: 'apiKey', value: 'saved-secret', secret: true, persist: true }),
    ]);

    const text = JSON.stringify(createExport([collection], [env]));
    expect(text).not.toContain('literal-secret');
    expect(text).not.toContain('session-only');
    expect(text).not.toContain('saved-secret');
    expect(text).toContain('kept');

    const imported = parseImport(text);
    expect(imported.source).toBe('api-workbench');
    expect(imported.collections[0].name).toBe('Demo');
    expect(imported.collections[0].id).not.toBe(collection.id);
    const first = imported.collections[0].items[0] as SavedRequest;
    expect(first.request.url).toBe('http://h/get-user');
    expect(first.request.headers[0]).toMatchObject({ key: 'Accept', value: 'application/json' });
    expect(imported.environments[0].variables.map((v) => [v.key, v.value])).toEqual([
      ['baseUrl', 'http://localhost'],
      ['token', ''],
      ['apiKey', ''],
    ]);

    const withSecrets = JSON.stringify(createExport([], [env], { includeSecretValues: true }));
    expect(withSecrets).toContain('saved-secret');
    expect(withSecrets).not.toContain('session-only');
  });

  it('rejects garbage and future versions', () => {
    expect(() => parseImport('not json')).toThrow(/not valid JSON/);
    expect(() => parseImport('{"hello":1}')).toThrow(/Unrecognised/);
    expect(() => parseImport('{"format":"offline-toolbox.api-workbench","version":99}')).toThrow(
      /newer version/,
    );
  });

  it('imports Postman v2.1 collections', () => {
    const postman = {
      info: {
        name: 'PM',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      variable: [{ key: 'host', value: 'http://x' }],
      item: [
        {
          name: 'Folder',
          item: [
            {
              name: 'Create',
              request: {
                method: 'POST',
                url: { raw: '{{host}}/items?debug=1' },
                header: [{ key: 'X-A', value: '1', disabled: true }],
                body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
                auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}' }] },
              },
            },
          ],
        },
      ],
    };
    const result = parseImport(JSON.stringify(postman));
    expect(result.source).toBe('postman');
    const folder = result.collections[0].items[0] as Folder;
    const create = folder.items[0] as SavedRequest;
    expect(create.request.method).toBe('POST');
    expect(create.request.params.map((p) => p.key)).toEqual(['debug']);
    expect(create.request.headers[0].enabled).toBe(false);
    expect(create.request.body).toMatchObject({ mode: 'json', json: '{"a":1}' });
    expect(create.request.auth).toEqual({ type: 'bearer', token: '{{tok}}' });
    expect(result.environments[0].variables[0]).toMatchObject({ key: 'host', value: 'http://x' });
  });
});

describe('history', () => {
  it('keeps newest first and evicts beyond the limit', () => {
    let entries = [] as ReturnType<typeof createHistoryEntry>[];
    for (let i = 0; i < 5; i++) {
      const result = addToHistory(
        entries,
        createHistoryEntry(createRequestSpec({ url: `http://h/${i}` }), { status: 200 }, 1000 + i),
        3,
      );
      entries = result.entries;
      if (i === 4) expect(result.evicted.map((e) => e.url)).toEqual(['http://h/1']);
    }
    expect(entries.map((e) => e.url)).toEqual(['http://h/4', 'http://h/3', 'http://h/2']);
  });

  it('strips unsaved credentials from history', () => {
    const spec = createRequestSpec({
      url: 'http://h',
      auth: { type: 'basic', username: 'u', password: 'pw' },
    });
    expect(createHistoryEntry(spec, {}).request.auth).toEqual({
      type: 'basic',
      username: 'u',
      password: '',
    });
    const ref = createRequestSpec({
      url: 'http://h',
      auth: { type: 'bearer', token: '{{token}}' },
    });
    expect(createHistoryEntry(ref, {}).request.auth).toEqual({
      type: 'bearer',
      token: '{{token}}',
    });
  });
});

describe('persistence (IndexedDB)', () => {
  for (const [label, makeBackend] of [
    ['IndexedDB', () => new IndexedDbBackend(indexedDB, `test-${Math.random()}`)],
    ['memory', () => new MemoryBackend()],
  ] as const) {
    it(`${label}: saves, reloads and deletes`, async () => {
      const repo = new Repository(makeBackend(), true);
      const collection = insertItem(createCollection('Saved'), null, request('one'));
      const env = createEnvironment('Local', [
        createVariable({ key: 'baseUrl', value: 'http://localhost' }),
        createVariable({ key: 'password', value: 'not-on-disk' }),
      ]);
      await repo.saveCollection(collection);
      await repo.saveEnvironment(env);
      const entry = createHistoryEntry(createRequestSpec({ url: 'http://h' }), { status: 204 });
      await repo.addHistory(entry);
      await repo.saveSession({ activeEnvironmentId: env.id, activeTabId: null, tabs: [] });

      const loaded = await repo.loadAll();
      expect(loaded.collections).toHaveLength(1);
      expect(loaded.collections[0].items[0].name).toBe('one');
      expect(loaded.environments[0].variables.map((v) => v.value)).toEqual([
        'http://localhost',
        '',
      ]);
      expect(loaded.history[0].status).toBe(204);
      expect(loaded.session?.activeEnvironmentId).toBe(env.id);

      await repo.deleteHistory(entry.id);
      await repo.deleteCollection(collection.id);
      const after = await repo.loadAll();
      expect(after.history).toHaveLength(0);
      expect(after.collections).toHaveLength(0);
    });
  }
});
