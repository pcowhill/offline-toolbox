// Removes sensitive values before anything is written to browser storage or exported.
import { AUTH_HELPERS } from './auth';
import { looksSensitive } from './factory';
import type { Collection, CollectionItem, Environment, KeyValue, RequestSpec } from './types';
import { isOnlyVariableReferences } from './variables';

const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

/** Headers whose values are treated as credentials (Authorization, Cookie, X-API-Key, …). */
export function isSensitiveHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return CREDENTIAL_HEADERS.has(lower) || looksSensitive(lower);
}

/** Header rows whose literal values will not be saved with the request. */
export function unsavedSensitiveHeaders(spec: RequestSpec): KeyValue[] {
  if (spec.settings.saveSensitiveHeaders) return [];
  return spec.headers.filter(
    (h) => h.value && isSensitiveHeader(h.key) && !isOnlyVariableReferences(h.value),
  );
}

/**
 * Auth secrets are kept only if the user ticked "save credentials" for that request, and
 * credential-like header values only if "save sensitive header values" is enabled. Values that
 * are just {{variable}} references are always kept (they contain no secret).
 */
export function stripRequestSecrets(spec: RequestSpec): RequestSpec {
  const helper = AUTH_HELPERS[spec.auth.type];
  const unsaved = new Set(unsavedSensitiveHeaders(spec).map((h) => h.id));
  return {
    ...spec,
    headers: spec.headers.map((h) => (unsaved.has(h.id) ? { ...h, value: '' } : h)),
    auth: helper.stripSecrets(spec.auth),
    // File contents are never persisted — only the file name as a reminder.
    body: { ...spec.body, multipart: spec.body.multipart.map((f) => ({ ...f })) },
  };
}

function stripItem(item: CollectionItem): CollectionItem {
  return item.type === 'request'
    ? { ...item, request: stripRequestSecrets(item.request) }
    : { ...item, items: item.items.map(stripItem) };
}

export function stripCollectionSecrets(collection: Collection): Collection {
  return { ...collection, items: collection.items.map(stripItem) };
}

/** Values of variables not marked "save" are blanked. */
export function stripEnvironmentSecrets(
  environment: Environment,
  options: { includeSecretValues?: boolean } = {},
): Environment {
  return {
    ...environment,
    variables: environment.variables.map((variable) => {
      if (!variable.persist) return { ...variable, value: '' };
      if (variable.secret && options.includeSecretValues === false)
        return { ...variable, value: '' };
      return variable;
    }),
  };
}
