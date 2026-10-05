import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyValue, createRequestSpec } from '../factory';
import { prepareRequest } from '../request';
import { detectBodyKind, suggestFileName } from '../response';
import { FetchTransport, RequestError, classifyFetchError } from '../transport';

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/slow') {
      setTimeout(() => res.end('late'), 2000);
      return;
    }
    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/echo?from=redirect' }).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Custom': 'yes' });
      res.end(
        JSON.stringify({
          method: req.method,
          path: url.pathname,
          query: url.search,
          auth: req.headers.authorization ?? null,
          body,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('FetchTransport against a local mock server', () => {
  const transport = new FetchTransport();

  it('sends a request and captures status, headers, body, timing and size', async () => {
    const spec = createRequestSpec({
      method: 'POST',
      url: `${base}/echo?a=1`,
      params: [createKeyValue({ key: 'a', value: '1' })],
      auth: { type: 'bearer', token: 'tok' },
    });
    spec.body.mode = 'json';
    spec.body.json = '{"x":1}';
    const prepared = prepareRequest(spec, new Map()).request!;
    const response = await transport.send(prepared, new AbortController().signal);
    expect(response.status).toBe(201);
    expect(response.headers).toContainEqual(['x-custom', 'yes']);
    const json = JSON.parse(new TextDecoder().decode(response.body));
    expect(json).toEqual({
      method: 'POST',
      path: '/echo',
      query: '?a=1',
      auth: 'Bearer tok',
      body: '{"x":1}',
    });
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
    expect(response.sizeBytes).toBeGreaterThan(response.body.byteLength);
    expect(detectBodyKind('application/json', response.body)).toBe('json');
  });

  it('follows redirects and reports the final URL', async () => {
    const prepared = prepareRequest(
      createRequestSpec({ url: `${base}/redirect` }),
      new Map(),
    ).request!;
    const response = await transport.send(prepared, new AbortController().signal);
    expect(response.redirected).toBe(true);
    expect(response.url).toBe(`${base}/echo?from=redirect`);
  });

  it('cancels and times out', async () => {
    const prepared = prepareRequest(createRequestSpec({ url: `${base}/slow` }), new Map()).request!;
    const controller = new AbortController();
    const pending = transport.send(prepared, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });

    const timed = { ...prepared, settings: { ...prepared.settings, timeoutMs: 100 } };
    await expect(transport.send(timed, new AbortController().signal)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('classifies an unreachable server as a CORS-or-network failure', async () => {
    const prepared = prepareRequest(
      createRequestSpec({ url: 'http://127.0.0.1:1/' }),
      new Map(),
    ).request!;
    const error = await transport.send(prepared, new AbortController().signal).catch((e) => e);
    expect(error).toBeInstanceOf(RequestError);
    expect(error.kind).toBe('cors-or-network');
  });
});

describe('error classification', () => {
  const page = { origin: 'https://tools.example', protocol: 'https:' };
  it('mixed content vs. cross-origin vs. same-origin', () => {
    const err = new TypeError('Failed to fetch');
    expect(
      classifyFetchError(err, 'http://api.internal/x', {
        timedOut: false,
        cancelled: false,
        durationMs: 1,
        page,
      }).kind,
    ).toBe('mixed-content');
    const cross = classifyFetchError(err, 'https://api.other/x', {
      timedOut: false,
      cancelled: false,
      durationMs: 1,
      page,
    });
    expect(cross.kind).toBe('cors-or-network');
    expect(cross.message).toMatch(/CORS/);
    const same = classifyFetchError(err, 'https://tools.example/api', {
      timedOut: false,
      cancelled: false,
      durationMs: 1,
      page,
    });
    expect(same.message).not.toMatch(/CORS/);
  });
});

describe('response helpers', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it('detects body kinds', () => {
    expect(detectBodyKind(undefined, enc('{"a":1}'))).toBe('json');
    expect(detectBodyKind('text/html; charset=utf-8', enc('<p>'))).toBe('html');
    expect(detectBodyKind('application/atom+xml', enc('<feed/>'))).toBe('xml');
    expect(detectBodyKind('image/png', new Uint8Array([137, 80]))).toBe('image');
    expect(detectBodyKind('application/octet-stream', new Uint8Array([0, 1, 2]))).toBe('binary');
    expect(detectBodyKind('text/plain', new Uint8Array())).toBe('empty');
  });
  it('suggests file names', () => {
    expect(suggestFileName('http://h/files/report.pdf', [], 'binary')).toBe('report.pdf');
    expect(
      suggestFileName(
        'http://h/x',
        [['Content-Disposition', 'attachment; filename="data.csv"']],
        'text',
      ),
    ).toBe('data.csv');
    expect(suggestFileName('http://h/api/users', [], 'json')).toBe('users.json');
  });
});
