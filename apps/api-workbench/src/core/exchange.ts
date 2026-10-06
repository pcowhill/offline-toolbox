// Export / import of collections and environments as a portable JSON file, so saved work can
// be carried to another (possibly air-gapped) computer.
import { createId } from '@shared/lib/id';
import { createKeyValue, createMultipartField, createRequestSpec, createVariable } from './factory';
import { stripCollectionSecrets, stripEnvironmentSecrets } from './sanitize';
import {
  HTTP_METHODS,
  type AuthConfig,
  type BodyMode,
  type Collection,
  type CollectionItem,
  type Environment,
  type HttpMethod,
  type KeyValue,
  type MultipartField,
  type RequestSpec,
} from './types';
import { paramsFromUrl } from './url';

export const EXPORT_FORMAT = 'offline-toolbox.api-workbench';
export const EXPORT_VERSION = 1;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  collections: Collection[];
  environments: Environment[];
}

export interface ExportOptions {
  /** Include values of variables marked secret (only those the user chose to save). */
  includeSecretValues?: boolean;
}

export function createExport(
  collections: Collection[],
  environments: Environment[],
  options: ExportOptions = {},
): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    collections: collections.map(stripCollectionSecrets),
    environments: environments.map((env) =>
      stripEnvironmentSecrets(env, { includeSecretValues: options.includeSecretValues ?? false }),
    ),
  };
}

export interface ImportResult {
  collections: Collection[];
  environments: Environment[];
  warnings: string[];
  source: 'api-workbench' | 'postman';
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function normalizeKeyValues(value: unknown): KeyValue[] {
  return arr(value)
    .filter(isObject)
    .map((row) =>
      createKeyValue({
        key: str(row.key),
        value: str(row.value),
        enabled: bool(row.enabled, true),
        ...(typeof row.description === 'string' ? { description: row.description } : {}),
      }),
    );
}

function normalizeMultipart(value: unknown): MultipartField[] {
  return arr(value)
    .filter(isObject)
    .map((row) =>
      createMultipartField({
        key: str(row.key),
        value: str(row.value),
        enabled: bool(row.enabled, true),
        kind: row.kind === 'file' ? 'file' : 'text',
        ...(typeof row.fileName === 'string' ? { fileName: row.fileName } : {}),
        ...(typeof row.contentType === 'string' ? { contentType: row.contentType } : {}),
      }),
    );
}

function normalizeAuth(value: unknown): AuthConfig {
  if (!isObject(value)) return { type: 'none' };
  if (value.type === 'basic') {
    return {
      type: 'basic',
      username: str(value.username),
      password: str(value.password),
      saveCredentials: bool(value.saveCredentials, false),
    };
  }
  if (value.type === 'bearer') {
    return {
      type: 'bearer',
      token: str(value.token),
      ...(typeof value.prefix === 'string' ? { prefix: value.prefix } : {}),
      saveCredentials: bool(value.saveCredentials, false),
    };
  }
  return { type: 'none' };
}

const BODY_MODES: BodyMode[] = ['none', 'raw', 'json', 'urlencoded', 'multipart'];

export function normalizeRequestSpec(value: unknown): RequestSpec {
  const input = isObject(value) ? value : {};
  const spec = createRequestSpec();
  const method = str(input.method, 'GET').toUpperCase();
  spec.method = (HTTP_METHODS as readonly string[]).includes(method)
    ? (method as HttpMethod)
    : 'GET';
  spec.url = str(input.url);
  spec.params = normalizeKeyValues(input.params);
  if (spec.params.length === 0 && spec.url.includes('?')) spec.params = paramsFromUrl(spec.url, []);
  spec.headers = normalizeKeyValues(input.headers);
  spec.auth = normalizeAuth(input.auth);
  const body = isObject(input.body) ? input.body : {};
  spec.body = {
    mode: BODY_MODES.includes(body.mode as BodyMode) ? (body.mode as BodyMode) : 'none',
    raw: str(body.raw),
    rawContentType: str(body.rawContentType, 'text/plain'),
    json: str(body.json),
    urlencoded: normalizeKeyValues(body.urlencoded),
    multipart: normalizeMultipart(body.multipart),
  };
  const settings = isObject(input.settings) ? input.settings : {};
  spec.settings = {
    timeoutMs:
      typeof settings.timeoutMs === 'number' && settings.timeoutMs >= 0
        ? settings.timeoutMs
        : 30_000,
    credentials: ['omit', 'same-origin', 'include'].includes(settings.credentials as string)
      ? (settings.credentials as RequestSpec['settings']['credentials'])
      : 'omit',
    redirect: settings.redirect === 'error' ? 'error' : 'follow',
    ...(settings.saveSensitiveHeaders === true ? { saveSensitiveHeaders: true } : {}),
  };
  return spec;
}

function normalizeItems(value: unknown, depth = 0): CollectionItem[] {
  if (depth > 20) return [];
  return arr(value)
    .filter(isObject)
    .map((item): CollectionItem =>
      item.type === 'folder'
        ? {
            type: 'folder',
            id: createId(),
            name: str(item.name, 'Folder'),
            items: normalizeItems(item.items, depth + 1),
          }
        : {
            type: 'request',
            id: createId(),
            name: str(item.name, 'Request'),
            request: normalizeRequestSpec(item.request),
            ...(typeof item.description === 'string' ? { description: item.description } : {}),
          },
    );
}

function normalizeCollection(value: Json): Collection {
  const now = Date.now();
  return {
    id: createId(),
    name: str(value.name, 'Imported collection'),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    items: normalizeItems(value.items),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeEnvironment(value: Json): Environment {
  const now = Date.now();
  return {
    id: createId(),
    name: str(value.name, 'Imported environment'),
    variables: arr(value.variables)
      .filter(isObject)
      .map((v) => {
        const persist = bool(v.persist, true);
        return createVariable({
          key: str(v.key),
          value: str(v.value),
          enabled: bool(v.enabled, true),
          secret: bool(v.secret, false),
          persist,
        });
      }),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Parses an import file. Accepts API Workbench exports and Postman v2.x collections.
 * Every imported object receives a fresh id, so importing never overwrites existing data.
 */
export function parseImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`The file is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  if (!isObject(data)) throw new Error('Unrecognised file: expected a JSON object.');

  if (data.format === EXPORT_FORMAT) {
    if (typeof data.version !== 'number' || data.version > EXPORT_VERSION) {
      throw new Error(
        `This file was created by a newer version of API Workbench (format v${String(data.version)}).`,
      );
    }
    return {
      collections: arr(data.collections).filter(isObject).map(normalizeCollection),
      environments: arr(data.environments).filter(isObject).map(normalizeEnvironment),
      warnings: [],
      source: 'api-workbench',
    };
  }
  if (isObject(data.info) && str(data.info.schema).includes('getpostman.com')) {
    return importPostmanCollection(data);
  }
  throw new Error(
    'Unrecognised file. Expected an API Workbench export or a Postman v2 collection.',
  );
}

// ---------------------------------------------------------------------------------------
// Postman collection v2.0 / v2.1 (common subset)

function postmanUrl(url: unknown): string {
  if (typeof url === 'string') return url;
  if (isObject(url)) return str(url.raw);
  return '';
}

function postmanKeyValues(value: unknown): KeyValue[] {
  return arr(value)
    .filter(isObject)
    .map((row) =>
      createKeyValue({ key: str(row.key), value: str(row.value), enabled: !row.disabled }),
    );
}

function postmanRequest(request: unknown, warnings: string[]): RequestSpec {
  const spec = createRequestSpec();
  if (typeof request === 'string') {
    spec.url = request;
    spec.params = paramsFromUrl(request, []);
    return spec;
  }
  if (!isObject(request)) return spec;
  const method = str(request.method, 'GET').toUpperCase();
  spec.method = (HTTP_METHODS as readonly string[]).includes(method)
    ? (method as HttpMethod)
    : 'GET';
  spec.url = postmanUrl(request.url);
  spec.params = paramsFromUrl(spec.url, []);
  spec.headers = postmanKeyValues(request.header);
  const body = isObject(request.body) ? request.body : null;
  if (body) {
    if (body.mode === 'raw') {
      const raw = str(body.raw);
      const lang =
        isObject(body.options) && isObject(body.options.raw) ? str(body.options.raw.language) : '';
      if (lang === 'json' || /^\s*[[{]/.test(raw)) {
        spec.body.mode = 'json';
        spec.body.json = raw;
      } else {
        spec.body.mode = 'raw';
        spec.body.raw = raw;
      }
    } else if (body.mode === 'urlencoded') {
      spec.body.mode = 'urlencoded';
      spec.body.urlencoded = postmanKeyValues(body.urlencoded);
    } else if (body.mode === 'formdata') {
      spec.body.mode = 'multipart';
      spec.body.multipart = arr(body.formdata)
        .filter(isObject)
        .map((row) =>
          createMultipartField({
            key: str(row.key),
            value: str(row.value),
            enabled: !row.disabled,
            kind: row.type === 'file' ? 'file' : 'text',
            ...(row.type === 'file' && typeof row.src === 'string'
              ? { fileName: row.src.split(/[\\/]/).pop() }
              : {}),
          }),
        );
    } else if (body.mode) {
      warnings.push(`Body mode "${str(body.mode)}" is not supported and was skipped.`);
    }
  }
  const auth = isObject(request.auth) ? request.auth : null;
  if (auth) {
    const entries = (key: string) =>
      new Map(
        arr(auth[key])
          .filter(isObject)
          .map((e) => [str(e.key), str(e.value)] as [string, string]),
      );
    if (auth.type === 'bearer')
      spec.auth = { type: 'bearer', token: entries('bearer').get('token') ?? '' };
    else if (auth.type === 'basic') {
      const basic = entries('basic');
      spec.auth = {
        type: 'basic',
        username: basic.get('username') ?? '',
        password: basic.get('password') ?? '',
      };
    } else if (auth.type && auth.type !== 'noauth') {
      warnings.push(`Auth type "${str(auth.type)}" is not supported; add the header manually.`);
    }
  }
  return spec;
}

function postmanItems(value: unknown, warnings: string[], depth = 0): CollectionItem[] {
  if (depth > 20) return [];
  return arr(value)
    .filter(isObject)
    .map((item): CollectionItem =>
      Array.isArray(item.item)
        ? {
            type: 'folder',
            id: createId(),
            name: str(item.name, 'Folder'),
            items: postmanItems(item.item, warnings, depth + 1),
          }
        : {
            type: 'request',
            id: createId(),
            name: str(item.name, 'Request'),
            request: postmanRequest(item.request, warnings),
          },
    );
}

function importPostmanCollection(data: Json): ImportResult {
  const warnings: string[] = [];
  const info = data.info as Json;
  const now = Date.now();
  const collection: Collection = {
    id: createId(),
    name: str(info.name, 'Postman collection'),
    items: postmanItems(data.item, warnings),
    createdAt: now,
    updatedAt: now,
  };
  const environments: Environment[] = [];
  const variables = arr(data.variable).filter(isObject);
  if (variables.length) {
    environments.push({
      id: createId(),
      name: `${collection.name} variables`,
      variables: variables.map((v) => createVariable({ key: str(v.key), value: str(v.value) })),
      createdAt: now,
      updatedAt: now,
    });
  }
  if (data.event || JSON.stringify(data).includes('"event"')) {
    warnings.push('Pre-request and test scripts are not supported and were ignored.');
  }
  return {
    collections: [collection],
    environments,
    warnings: [...new Set(warnings)],
    source: 'postman',
  };
}
