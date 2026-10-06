// Sending requests. The UI talks to the RequestTransport interface only, so a future version
// can add e.g. a LocalProxyTransport (forwarding through a user-run local proxy to avoid CORS)
// without changing request building or response handling.
import { toBodyInit, type PreparedRequest } from './request';

export interface ResponseData {
  status: number;
  statusText: string;
  /** Headers in received order; duplicate names are preserved where the browser exposes them. */
  headers: Array<[string, string]>;
  body: Uint8Array;
  /** URL of the final response (differs from the request URL after redirects). */
  url: string;
  redirected: boolean;
  durationMs: number;
  /** Body bytes plus an estimate of header bytes. */
  sizeBytes: number;
  type: ResponseType;
}

export type NetworkErrorKind =
  'cancelled' | 'timeout' | 'cors-or-network' | 'mixed-content' | 'unknown';

export class RequestError extends Error {
  readonly kind: NetworkErrorKind;
  readonly durationMs: number;
  readonly detail: string;

  constructor(kind: NetworkErrorKind, message: string, detail: string, durationMs: number) {
    super(message);
    this.name = 'RequestError';
    this.kind = kind;
    this.detail = detail;
    this.durationMs = durationMs;
  }
}

export interface RequestTransport {
  readonly id: string;
  readonly label: string;
  send(request: PreparedRequest, signal: AbortSignal): Promise<ResponseData>;
}

export interface PageContext {
  origin: string;
  protocol: string;
}

function currentPage(): PageContext {
  if (typeof location === 'undefined') return { origin: 'null', protocol: 'http:' };
  return { origin: location.origin, protocol: location.protocol };
}

/**
 * fetch() deliberately reports CORS failures, DNS failures, refused connections, TLS errors
 * and mixed-content blocks with the same opaque TypeError. Use what we know about the
 * request to pick the most likely explanation.
 */
export function classifyFetchError(
  error: unknown,
  requestUrl: string,
  context: { timedOut: boolean; cancelled: boolean; durationMs: number; page?: PageContext },
): RequestError {
  const page = context.page ?? currentPage();
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (context.timedOut) {
    return new RequestError('timeout', 'The request timed out.', raw, context.durationMs);
  }
  if (context.cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
    return new RequestError('cancelled', 'The request was cancelled.', raw, context.durationMs);
  }
  let target: URL | null;
  try {
    target = new URL(requestUrl);
  } catch {
    target = null;
  }
  if (target && page.protocol === 'https:' && target.protocol === 'http:') {
    return new RequestError(
      'mixed-content',
      'The browser blocked an insecure (http://) request from a secure (https://) page.',
      raw,
      context.durationMs,
    );
  }
  if (error instanceof TypeError) {
    return new RequestError(
      'cors-or-network',
      target && target.origin !== page.origin
        ? 'The request failed. The browser may be blocking it because of CORS, or the server could not be reached.'
        : 'The request failed: the server could not be reached.',
      raw,
      context.durationMs,
    );
  }
  return new RequestError(
    'unknown',
    error instanceof Error ? error.message : 'The request failed.',
    raw,
    context.durationMs,
  );
}

export class FetchTransport implements RequestTransport {
  readonly id = 'browser';
  readonly label = 'Browser (fetch)';

  async send(request: PreparedRequest, signal: AbortSignal): Promise<ResponseData> {
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      controller.abort();
    };
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort);
    const timeout =
      request.settings.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, request.settings.timeoutMs)
        : undefined;

    const headers = new Headers();
    for (const [name, value] of request.headers) {
      try {
        headers.append(name, value);
      } catch {
        // Invalid header value (e.g. a newline) — reported by prepareRequest validation.
      }
    }
    const body = toBodyInit(request.body);
    // fetch() derives multipart boundaries itself.
    if (request.body.kind === 'multipart') headers.delete('Content-Type');

    const started = performance.now();
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers,
        body,
        credentials: request.settings.credentials,
        redirect: request.settings.redirect,
        cache: 'no-store',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      const buffer = new Uint8Array(await response.arrayBuffer());
      const durationMs = performance.now() - started;
      const responseHeaders: Array<[string, string]> = [];
      response.headers.forEach((value, name) => responseHeaders.push([name, value]));
      const headerBytes = responseHeaders.reduce((sum, [n, v]) => sum + n.length + v.length + 4, 0);
      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: buffer,
        url: response.url || request.url,
        redirected: response.redirected,
        durationMs,
        sizeBytes: buffer.byteLength + headerBytes,
        type: response.type,
      };
    } catch (error) {
      throw classifyFetchError(error, request.url, {
        timedOut,
        cancelled: cancelled && !timedOut,
        durationMs: performance.now() - started,
      });
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export const defaultTransport: RequestTransport = new FetchTransport();
