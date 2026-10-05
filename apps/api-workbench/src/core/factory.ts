import { createId } from '@shared/lib/id';
import type {
  Collection,
  Environment,
  EnvironmentVariable,
  KeyValue,
  MultipartField,
  RequestSpec,
} from './types';

export function createKeyValue(partial: Partial<KeyValue> = {}): KeyValue {
  return { id: createId(), key: '', value: '', enabled: true, ...partial };
}

export function createMultipartField(partial: Partial<MultipartField> = {}): MultipartField {
  return { id: createId(), key: '', value: '', enabled: true, kind: 'text', ...partial };
}

export function createRequestSpec(partial: Partial<RequestSpec> = {}): RequestSpec {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: {
      mode: 'none',
      raw: '',
      rawContentType: 'text/plain',
      json: '',
      urlencoded: [],
      multipart: [],
    },
    settings: { timeoutMs: 30_000, credentials: 'omit', redirect: 'follow' },
    ...partial,
  };
}

export function createCollection(name: string): Collection {
  const now = Date.now();
  return { id: createId(), name, items: [], createdAt: now, updatedAt: now };
}

export function createEnvironment(
  name: string,
  variables: EnvironmentVariable[] = [],
): Environment {
  const now = Date.now();
  return { id: createId(), name, variables, createdAt: now, updatedAt: now };
}

const SENSITIVE_NAME =
  /(pass(word)?|secret|token|api[-_]?key|apikey|auth|credential|private|session|cookie|bearer)/i;

/** Variable names that look sensitive default to "secret, not saved". */
export function looksSensitive(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

export function createVariable(partial: Partial<EnvironmentVariable> = {}): EnvironmentVariable {
  const sensitive = looksSensitive(partial.key ?? '');
  return {
    id: createId(),
    key: '',
    value: '',
    enabled: true,
    secret: sensitive,
    persist: !sensitive,
    ...partial,
  };
}

/** Deep copy with fresh ids for every row — used for duplicate/import operations. */
export function cloneRequestSpec(spec: RequestSpec): RequestSpec {
  const copy: RequestSpec = structuredClone(spec);
  const fresh = <T extends { id: string }>(rows: T[]) =>
    rows.map((r) => ({ ...r, id: createId() }));
  copy.params = fresh(copy.params);
  copy.headers = fresh(copy.headers);
  copy.body.urlencoded = fresh(copy.body.urlencoded);
  copy.body.multipart = fresh(copy.body.multipart);
  return copy;
}
