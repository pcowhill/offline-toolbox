// Interpreting response bodies for display.

export type BodyKind = 'json' | 'xml' | 'html' | 'text' | 'image' | 'binary' | 'empty';

export function headerValue(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}

export function parseContentType(value: string | undefined): { mime: string; charset?: string } {
  if (!value) return { mime: '' };
  const [mime, ...params] = value.split(';');
  let charset: string | undefined;
  for (const param of params) {
    const [key, val] = param.split('=');
    if (key?.trim().toLowerCase() === 'charset' && val) charset = val.trim().replace(/^"|"$/g, '');
  }
  return { mime: mime.trim().toLowerCase(), charset };
}

/** Heuristic: is this byte sequence plausibly text? */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 2048);
  if (sample.length === 0) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
  }
  return suspicious / sample.length < 0.05;
}

export function detectBodyKind(contentType: string | undefined, bytes: Uint8Array): BodyKind {
  if (bytes.length === 0) return 'empty';
  const { mime } = parseContentType(contentType);
  if (mime === 'application/json' || mime.endsWith('+json') || mime === 'text/json') return 'json';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime.endsWith('/xml') || mime.endsWith('+xml')) return 'xml';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.startsWith('text/') ||
    mime === 'application/javascript' ||
    mime === 'application/x-www-form-urlencoded'
  ) {
    return 'text';
  }
  if (!looksLikeText(bytes)) return 'binary';
  // Unknown/missing type: sniff content.
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      JSON.parse(new TextDecoder().decode(bytes));
      return 'json';
    } catch {
      return 'text';
    }
  }
  if (/^<!doctype html|^<html/i.test(head)) return 'html';
  if (head.startsWith('<?xml') || head.startsWith('<')) return 'xml';
  return 'text';
}

export function decodeText(bytes: Uint8Array, charset?: string): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Suggests a download file name from Content-Disposition, the URL and the content type. */
export function suggestFileName(
  url: string,
  headers: Array<[string, string]>,
  kind: BodyKind,
): string {
  const disposition = headerValue(headers, 'content-disposition');
  if (disposition) {
    const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
    const name = star ? decodeURIComponentSafe(star[1].trim()) : plain?.[1]?.trim();
    if (name) return name;
  }
  let last: string;
  try {
    last = decodeURIComponentSafe(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    last = '';
  }
  const extension: Record<BodyKind, string> = {
    json: '.json',
    xml: '.xml',
    html: '.html',
    text: '.txt',
    image: '',
    binary: '.bin',
    empty: '.txt',
  };
  if (last && /\.[a-z0-9]{1,8}$/i.test(last)) return last;
  return `${last || 'response'}${extension[kind]}`;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function statusCategory(
  status: number,
): 'info' | 'success' | 'redirect' | 'client-error' | 'server-error' {
  if (status < 200) return 'info';
  if (status < 300) return 'success';
  if (status < 400) return 'redirect';
  if (status < 500) return 'client-error';
  return 'server-error';
}
