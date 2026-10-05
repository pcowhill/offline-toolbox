// Removes sensitive values before anything is written to browser storage or exported.
import { AUTH_HELPERS } from './auth';
import type { Collection, CollectionItem, Environment, RequestSpec } from './types';

/** Auth secrets are kept only if the user ticked "save credentials" for that request. */
export function stripRequestSecrets(spec: RequestSpec): RequestSpec {
  const helper = AUTH_HELPERS[spec.auth.type];
  return {
    ...spec,
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
