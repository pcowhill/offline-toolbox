// Turns an editable RequestSpec into a concrete request that a transport can send.
import { AUTH_HELPERS } from './auth';
import { maskVariablesForValidation, parseJson, describeJsonError } from './json';
import type { HttpMethod, RequestSpec } from './types';
import { buildFinalUrl, splitUrl } from './url';
import { substitute, type VariableMap } from './variables';

/** Headers browsers refuse to let scripts set; they are dropped or replaced silently. */
const FORBIDDEN_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

export function isForbiddenHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return FORBIDDEN_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-');
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export type PreparedBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string; contentType: string | null }
  | { kind: 'urlencoded'; fields: Array<[string, string]> }
  | {
      kind: 'multipart';
      fields: Array<
        | { kind: 'text'; name: string; value: string }
        | { kind: 'file'; name: string; file: Blob | null; fileName: string; contentType?: string }
      >;
    };

export interface PreparedRequest {
  method: HttpMethod;
  url: string;
  headers: Array<[string, string]>;
  body: PreparedBody;
  settings: RequestSpec['settings'];
}

export interface PrepareResult {
  request: PreparedRequest | null;
  /** Fatal problems: the request cannot be sent. */
  errors: string[];
  /** Non-fatal issues worth showing to the user. */
  warnings: string[];
  unresolved: string[];
}

export interface PrepareOptions {
  /** In-memory files for multipart file fields, keyed by field id. */
  files?: Map<string, File>;
}

export function hasHeader(headers: Array<[string, string]>, name: string): boolean {
  const lower = name.toLowerCase();
  return headers.some(([key]) => key.toLowerCase() === lower);
}

export function prepareRequest(
  spec: RequestSpec,
  variables: VariableMap,
  options: PrepareOptions = {},
): PrepareResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unresolved = new Set<string>();
  const resolve = (value: string) => {
    const result = substitute(value, variables);
    result.unresolved.forEach((name) => unresolved.add(name));
    return result.value;
  };

  // ---- URL ----
  const { base } = splitUrl(spec.url.trim());
  const resolvedBase = resolve(base);
  const params = spec.params
    .filter((p) => p.enabled && (p.key.trim() !== '' || p.value !== ''))
    .map((p) => ({ key: resolve(p.key), value: resolve(p.value) }));
  let url = '';
  if (!spec.url.trim()) {
    errors.push('Enter a URL.');
  } else {
    try {
      url = buildFinalUrl(resolvedBase, params);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  // ---- Headers ----
  const headers: Array<[string, string]> = [];
  for (const row of spec.headers) {
    if (!row.enabled || !row.key.trim()) continue;
    const name = resolve(row.key).trim();
    if (!HEADER_NAME.test(name)) {
      errors.push(`"${name}" is not a valid header name.`);
      continue;
    }
    if (isForbiddenHeader(name)) {
      warnings.push(
        `Browsers do not allow scripts to set the "${name}" header; it will be ignored or replaced.`,
      );
    }
    headers.push([name, resolve(row.value)]);
  }

  // ---- Auth ----
  const helper = AUTH_HELPERS[spec.auth.type];
  for (const [name, value] of helper.headers(spec.auth, { resolve })) {
    if (hasHeader(headers, name)) {
      warnings.push(`The "${name}" header on the Headers tab overrides the Auth tab.`);
      continue;
    }
    headers.push([name, value]);
  }

  // ---- Body ----
  let body: PreparedBody = { kind: 'none' };
  const mode = spec.body.mode;
  const bodyAllowed = spec.method !== 'GET' && spec.method !== 'HEAD';
  if (mode !== 'none' && !bodyAllowed) {
    warnings.push(
      `Browsers cannot send a body with ${spec.method} requests; the body is not sent.`,
    );
  } else if (mode === 'json') {
    const text = resolve(spec.body.json);
    if (text.trim()) {
      const check = parseJson(text);
      if (!check.ok) {
        const masked = parseJson(maskVariablesForValidation(spec.body.json));
        warnings.push(
          masked.ok
            ? 'The JSON body is not valid JSON after variable substitution.'
            : `The JSON body is not valid JSON: ${describeJsonError(check.error)}`,
        );
      }
    }
    body = { kind: 'text', text, contentType: 'application/json' };
  } else if (mode === 'raw') {
    body = {
      kind: 'text',
      text: resolve(spec.body.raw),
      contentType: spec.body.rawContentType || null,
    };
  } else if (mode === 'urlencoded') {
    body = {
      kind: 'urlencoded',
      fields: spec.body.urlencoded
        .filter((f) => f.enabled && f.key.trim())
        .map((f) => [resolve(f.key), resolve(f.value)] as [string, string]),
    };
  } else if (mode === 'multipart') {
    const fields: Extract<PreparedBody, { kind: 'multipart' }>['fields'] = [];
    for (const field of spec.body.multipart) {
      if (!field.enabled || !field.key.trim()) continue;
      if (field.kind === 'file') {
        const file = options.files?.get(field.id) ?? null;
        if (!file) {
          errors.push(
            field.fileName
              ? `Re-select the file "${field.fileName}" for form field "${field.key}" (files are not saved).`
              : `Choose a file for form field "${field.key}".`,
          );
        }
        fields.push({
          kind: 'file',
          name: resolve(field.key),
          file,
          fileName: file?.name ?? field.fileName ?? 'file',
          contentType: field.contentType,
        });
      } else {
        fields.push({ kind: 'text', name: resolve(field.key), value: resolve(field.value) });
      }
    }
    body = { kind: 'multipart', fields };
    if (hasHeader(headers, 'Content-Type')) {
      warnings.push(
        'A manual Content-Type header on a multipart body breaks the boundary parameter; remove it and the browser will set it.',
      );
    }
  }

  // Default Content-Type for text bodies unless the user set one.
  if (body.kind === 'text' && body.contentType && !hasHeader(headers, 'Content-Type')) {
    headers.push(['Content-Type', body.contentType]);
  }
  if (body.kind === 'urlencoded' && !hasHeader(headers, 'Content-Type')) {
    headers.push(['Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8']);
  }

  if (unresolved.size > 0) {
    warnings.unshift(
      `Unresolved variable${unresolved.size > 1 ? 's' : ''}: ${[...unresolved].map((n) => `{{${n}}}`).join(', ')}`,
    );
  }

  return {
    request: errors.length
      ? null
      : { method: spec.method, url, headers, body, settings: spec.settings },
    errors,
    warnings,
    unresolved: [...unresolved],
  };
}

/** Converts a prepared body into a fetch() BodyInit. */
export function toBodyInit(body: PreparedBody): BodyInit | undefined {
  switch (body.kind) {
    case 'none':
      return undefined;
    case 'text':
      return body.text;
    case 'urlencoded':
      return new URLSearchParams(body.fields).toString();
    case 'multipart': {
      const form = new FormData();
      for (const field of body.fields) {
        if (field.kind === 'text') form.append(field.name, field.value);
        else if (field.file) {
          const blob = field.contentType
            ? new Blob([field.file], { type: field.contentType })
            : field.file;
          form.append(field.name, blob, field.fileName);
        }
      }
      return form;
    }
  }
}
