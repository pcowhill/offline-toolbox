#!/usr/bin/env node
// Minimal zero-dependency static file server for the built site (Node.js 18+).
//
//   node serve.mjs [directory] [--port 8080] [--host 127.0.0.1] [--base /offline-toolbox/]
//
// --base serves the site under a URL prefix, e.g. to mimic GitHub Pages project sites.
// Any other static server works just as well, for example:  python3 -m http.server 8080
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
};

export function startServer({ root, port = 8080, host = '127.0.0.1', base = '/' }) {
  const rootDir = path.resolve(root);
  const prefix = ('/' + base.replace(/^\/+|\/+$/g, '') + '/').replace('//', '/');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (prefix !== '/' && pathname + '/' === prefix) {
      res.writeHead(301, { Location: prefix + url.search }).end();
      return;
    }
    if (!pathname.startsWith(prefix)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const relative = pathname.slice(prefix.length);
    const filePath = path.resolve(rootDir, '.' + path.posix.normalize('/' + relative));
    if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname + '/' + url.search }).end();
        return;
      }
      const index = path.join(filePath, 'index.html');
      if (!fs.existsSync(index)) {
        res.writeHead(404).end('Not found');
        return;
      }
      return send(res, index, req.method);
    }
    send(res, filePath, req.method);
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

function send(res, filePath, method) {
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function parseArgs(argv) {
  const options = { root: path.dirname(new URL(import.meta.url).pathname) };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') options.port = Number(argv[++i]);
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--base') options.base = argv[++i];
    else positional.push(arg);
  }
  if (positional[0]) options.root = positional[0];
  return options;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const server = await startServer(options);
  const { address, port } = server.address();
  const base = options.base
    ? ('/' + options.base.replace(/^\/+|\/+$/g, '') + '/').replace('//', '/')
    : '/';
  console.log(`Serving ${path.resolve(options.root)}`);
  console.log(`  → http://${address}:${port}${base}`);
  console.log('Press Ctrl+C to stop.');
}
