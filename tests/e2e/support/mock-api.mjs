// Local mock HTTP API used by the end-to-end tests (no external services are contacted).
import http from 'node:http';
import zlib from 'node:zlib';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*, Authorization',
  'Access-Control-Expose-Headers': 'X-Request-Echo, X-Mock-Server, Content-Disposition',
  'Access-Control-Max-Age': '600',
};

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Tiny solid-colour PNG generator. */
export function makePng(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function startMockApi(port = 0) {
  const books = [
    { id: 1, title: 'Emma', author: 'Jane Austen', year: 1815, isbn: '9007199254740993' },
    { id: 2, title: 'Persuasion', author: 'Jane Austen', year: 1817, isbn: '9007199254740995' },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const noCors = path.startsWith('/no-cors');
    const send = (status, body, headers = {}) => {
      res.writeHead(status, {
        ...(noCors ? {} : CORS),
        'X-Mock-Server': 'offline-toolbox',
        ...headers,
      });
      res.end(body);
    };
    if (req.method === 'OPTIONS' && !noCors) return send(204, '');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const echo = {
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
      };
      if (path === '/api/books' && req.method === 'GET') {
        const author = url.searchParams.get('author');
        // Hand-written JSON keeps the big integer exact.
        const list = books.filter((b) => !author || b.author.includes(author));
        const json =
          '[' +
          list
            .map(
              (b) =>
                `{"id":${b.id},"title":${JSON.stringify(b.title)},"author":${JSON.stringify(b.author)},"year":${b.year},"isbn":${b.isbn}}`,
            )
            .join(',') +
          ']';
        return send(200, json, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Request-Echo': req.headers['x-request-id'] ?? '',
        });
      }
      if (path === '/api/redirect') return send(302, '', { Location: '/api/echo?redirected=1' });
      if (path === '/api/image.png')
        return send(200, makePng(32, 16, [79, 70, 229]), { 'Content-Type': 'image/png' });
      if (path === '/api/page.html') {
        return send(
          200,
          '<!doctype html><html><body><h1>Hello from HTML</h1><script>document.title="executed"</script><img src="https://example.invalid/x.png"></body></html>',
          { 'Content-Type': 'text/html' },
        );
      }
      if (path === '/api/data.xml')
        return send(
          200,
          '<?xml version="1.0"?><catalog><book id="1"><title>Emma</title></book></catalog>',
          { 'Content-Type': 'application/xml' },
        );
      if (path === '/api/binary')
        return send(200, Buffer.from([0, 1, 2, 3, 255, 254]), {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="blob.bin"',
        });
      if (path === '/api/slow') {
        setTimeout(
          () => send(200, JSON.stringify({ slow: true }), { 'Content-Type': 'application/json' }),
          5000,
        );
        return;
      }
      if (path.startsWith('/api/status/'))
        return send(
          Number(path.split('/').pop()),
          JSON.stringify({ status: Number(path.split('/').pop()) }),
          { 'Content-Type': 'application/json' },
        );
      return send(200, JSON.stringify(echo), {
        'Content-Type': 'application/json',
        'X-Request-Echo': req.headers['x-request-id'] ?? '',
      });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const server = await startMockApi(Number(process.argv[2] ?? 4010));
  console.log(`Mock API on http://127.0.0.1:${server.address().port}`);
}
