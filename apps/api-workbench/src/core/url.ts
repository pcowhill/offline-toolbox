// URL ⇄ query-parameter table synchronisation and final URL construction.
import { createKeyValue } from './factory';
import type { KeyValue } from './types';

/** Decodes percent-escapes, leaving malformed sequences as typed. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Encodes only what would break the query-string structure in the URL bar, so the bar stays
 * readable ("q=hello world" rather than "q=hello%20world"). Final encoding happens at send time.
 */
function displayEncode(value: string, isKey: boolean): string {
  let out = value.replace(/%/g, '%25').replace(/&/g, '%26').replace(/#/g, '%23');
  if (isKey) out = out.replace(/=/g, '%3D');
  return out;
}

export interface SplitUrl {
  base: string;
  query: string | null;
  hash: string;
}

export function splitUrl(url: string): SplitUrl {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return { base: withoutHash, query: null, hash };
  return { base: withoutHash.slice(0, queryIndex), query: withoutHash.slice(queryIndex + 1), hash };
}

export function parseQuery(query: string): Array<{ key: string; value: string }> {
  if (!query) return [];
  return query
    .split('&')
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf('=');
      return eq < 0
        ? { key: safeDecode(part), value: '' }
        : { key: safeDecode(part.slice(0, eq)), value: safeDecode(part.slice(eq + 1)) };
    });
}

/**
 * Called when the user edits the URL bar: replaces the enabled parameters with those parsed
 * from the URL while keeping disabled rows (which are not part of the URL) and row ids/
 * descriptions where the key still matches.
 */
export function paramsFromUrl(url: string, previous: KeyValue[]): KeyValue[] {
  const { query } = splitUrl(url);
  const parsed = parseQuery(query ?? '');
  const enabledPrevious = previous.filter((p) => p.enabled);
  const disabled = previous.filter((p) => !p.enabled);
  const result: KeyValue[] = parsed.map((entry, index) => {
    const existing = enabledPrevious[index];
    return existing
      ? { ...existing, key: entry.key, value: entry.value }
      : createKeyValue({ key: entry.key, value: entry.value });
  });
  // Keep disabled rows at their relative positions (appended after enabled ones).
  return [...result, ...disabled];
}

export function serializeQueryForDisplay(params: KeyValue[]): string {
  return params
    .filter((p) => p.enabled && (p.key !== '' || p.value !== ''))
    .map((p) =>
      p.value === '' && !p.key.includes('=')
        ? displayEncode(p.key, true)
        : `${displayEncode(p.key, true)}=${displayEncode(p.value, false)}`,
    )
    .join('&');
}

/** Called when the user edits the parameter table: rewrites the URL's query string. */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const query = serializeQueryForDisplay(params);
  return query ? `${base}?${query}${hash}` : `${base}${hash}`;
}

/** Adds "http://" when no scheme was typed (like curl and Postman do). */
export function ensureScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `http:${trimmed}`;
  return `http://${trimmed}`;
}

/**
 * Builds the final, fully encoded URL from an already variable-substituted base and params.
 * Throws a descriptive error when the result is not a valid http(s) URL.
 */
export function buildFinalUrl(base: string, params: Array<{ key: string; value: string }>): string {
  const withScheme = ensureScheme(base);
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`"${withScheme || base}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http:// and https:// URLs are supported (got ${parsed.protocol}).`);
  }
  const query = params
    .filter((p) => p.key !== '' || p.value !== '')
    .map((p) =>
      p.value === ''
        ? encodeURIComponent(p.key)
        : `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`,
    )
    .join('&');
  parsed.hash = '';
  parsed.search = '';
  const text = parsed.toString();
  return query ? `${text}?${query}` : text;
}
