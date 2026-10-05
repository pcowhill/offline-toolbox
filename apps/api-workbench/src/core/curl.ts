// "Copy as curl" and "Import from curl" — helpful when moving between the terminal and the UI.
import { createKeyValue, createMultipartField, createRequestSpec } from './factory';
import type { PreparedRequest } from './request';
import { HTTP_METHODS, type HttpMethod, type RequestSpec } from './types';
import { paramsFromUrl } from './url';

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_\-./:=@%+,]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Renders a prepared (variable-resolved) request as a POSIX shell curl command. */
export function toCurl(request: PreparedRequest): string {
  const parts: string[] = ['curl'];
  if (request.method === 'HEAD') parts.push('--head');
  else if (request.method !== 'GET' || request.body.kind !== 'none')
    parts.push('-X', request.method);
  parts.push(shellQuote(request.url));
  for (const [name, value] of request.headers) {
    if (request.body.kind === 'multipart' && name.toLowerCase() === 'content-type') continue;
    parts.push('-H', shellQuote(`${name}: ${value}`));
  }
  const body = request.body;
  if (body.kind === 'text' && body.text !== '') parts.push('--data-raw', shellQuote(body.text));
  if (body.kind === 'urlencoded') {
    for (const [key, value] of body.fields) {
      parts.push('--data-urlencode', shellQuote(`${key}=${value}`));
    }
  }
  if (body.kind === 'multipart') {
    for (const field of body.fields) {
      if (field.kind === 'text') parts.push('-F', shellQuote(`${field.name}=${field.value}`));
      else parts.push('-F', shellQuote(`${field.name}=@${field.fileName}`));
    }
  }
  if (request.settings.redirect === 'follow') parts.push('-L');
  return parts.join(' ');
}

/** Splits a shell command line into words (handles quotes, escapes and line continuations). */
export function shellSplit(input: string): string[] {
  const words: string[] = [];
  let current = '';
  let hasWord = false;
  let quote: '"' | "'" | null = null;
  const text = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1]))
        current += text[++i];
      else current += ch;
      continue;
    }
    if (ch === '$' && text[i + 1] === "'") {
      // ANSI-C quoting $'...'
      i += 2;
      hasWord = true;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[++i];
          current += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
        } else current += text[i];
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      hasWord = true;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      current += text[++i];
      hasWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasWord) words.push(current);
      current = '';
      hasWord = false;
      continue;
    }
    current += ch;
    hasWord = true;
  }
  if (quote) throw new Error('Unterminated quote in curl command.');
  if (hasWord) words.push(current);
  return words;
}

const IGNORED_FLAGS_WITH_VALUE = new Set([
  '-o',
  '--output',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-w',
  '--write-out',
  '-x',
  '--proxy',
  '--cacert',
  '--cert',
  '--key',
  '-e',
  '--referer',
  '-b',
  '--cookie',
  '-c',
  '--cookie-jar',
  '-A',
  '--user-agent',
  '--retry',
  '-r',
  '--range',
  '--resolve',
  '--limit-rate',
]);

/**
 * Parses a curl command into a RequestSpec. Supports the flags people paste most often:
 * -X, -H, -d/--data*, --data-urlencode, -F, -u, -G, -I/--head, --url, -L, plus ignored flags.
 */
export function parseCurl(command: string): { spec: RequestSpec; warnings: string[] } {
  const words = shellSplit(command.trim());
  if (words[0] !== 'curl') throw new Error('The command must start with "curl".');
  const warnings: string[] = [];
  let method: string | null = null;
  let url = '';
  const headers: Array<[string, string]> = [];
  const data: string[] = [];
  const urlencoded: string[] = [];
  const form: string[] = [];
  let user: string | null = null;
  let getMode = false;
  let follow = false;

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const next = () => {
      if (i + 1 >= words.length) throw new Error(`Missing value after ${word}.`);
      return words[++i];
    };
    // Support --flag=value
    const eq = word.startsWith('--') ? word.indexOf('=') : -1;
    const flag = eq > 0 ? word.slice(0, eq) : word;
    const inline = eq > 0 ? word.slice(eq + 1) : null;
    const value = () => inline ?? next();
    switch (flag) {
      case '-X':
      case '--request':
        method = value().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const header = value();
        const colon = header.indexOf(':');
        if (colon > 0)
          headers.push([header.slice(0, colon).trim(), header.slice(colon + 1).trim()]);
        else warnings.push(`Ignored malformed header "${header}".`);
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
      case '--json': {
        const v = value();
        if (v.startsWith('@') && flag !== '--data-raw')
          warnings.push(`File references (${v}) cannot be imported; paste the content instead.`);
        data.push(v);
        if (flag === '--json') {
          headers.push(['Content-Type', 'application/json']);
          headers.push(['Accept', 'application/json']);
        }
        break;
      }
      case '--data-urlencode':
        urlencoded.push(value());
        break;
      case '-F':
      case '--form':
      case '--form-string':
        form.push(value());
        break;
      case '-u':
      case '--user':
        user = value();
        break;
      case '-G':
      case '--get':
        getMode = true;
        break;
      case '-I':
      case '--head':
        method = 'HEAD';
        break;
      case '--url':
        url = value();
        break;
      case '-L':
      case '--location':
        follow = true;
        break;
      default:
        if (IGNORED_FLAGS_WITH_VALUE.has(flag)) {
          if (inline === null) i++;
          warnings.push(`Ignored option ${flag}.`);
        } else if (flag.startsWith('-')) {
          if (
            ![
              '-s',
              '--silent',
              '-S',
              '--show-error',
              '-k',
              '--insecure',
              '-v',
              '--verbose',
              '-i',
              '--include',
              '--compressed',
              '-f',
              '--fail',
              '-sS',
              '-g',
              '--globoff',
            ].includes(flag)
          ) {
            warnings.push(`Ignored option ${flag}.`);
          }
        } else if (!url) {
          url = word;
        } else {
          warnings.push(`Ignored extra argument "${word}".`);
        }
    }
  }
  if (!url) throw new Error('No URL found in the curl command.');

  const hasBody = data.length > 0 || urlencoded.length > 0 || form.length > 0;
  let finalMethod = (method ?? (hasBody && !getMode ? 'POST' : 'GET')) as HttpMethod;
  if (!HTTP_METHODS.includes(finalMethod)) {
    warnings.push(`Method ${finalMethod} is not supported; using GET.`);
    finalMethod = 'GET';
  }

  const spec = createRequestSpec({ method: finalMethod });
  spec.settings.redirect = follow ? 'follow' : spec.settings.redirect;

  if (getMode && (data.length || urlencoded.length)) {
    const extra = [...data, ...urlencoded.map((v) => encodeUrlencodedArg(v))].join('&');
    url += (url.includes('?') ? '&' : '?') + extra;
  }
  spec.url = url;
  spec.params = paramsFromUrl(url, []);

  const contentType = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  spec.headers = headers.map(([key, value]) => createKeyValue({ key, value }));

  if (user !== null) {
    const colon = user.indexOf(':');
    spec.auth = {
      type: 'basic',
      username: colon >= 0 ? user.slice(0, colon) : user,
      password: colon >= 0 ? user.slice(colon + 1) : '',
    };
  }
  const bearer = headers.find(
    ([k, v]) => k.toLowerCase() === 'authorization' && /^bearer\s+/i.test(v),
  );
  const basic = headers.find(
    ([k, v]) => k.toLowerCase() === 'authorization' && /^basic\s+/i.test(v),
  );
  if (bearer && user === null) {
    spec.auth = { type: 'bearer', token: bearer[1].replace(/^bearer\s+/i, '') };
    spec.headers = spec.headers.filter((h) => h.key.toLowerCase() !== 'authorization');
  } else if (basic && user === null) {
    // Decode "Authorization: Basic …" into the Auth tab so the password is handled as a credential.
    try {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(basic[1].replace(/^basic\s+/i, '').trim()), (c) => c.charCodeAt(0)),
      );
      const colon = decoded.indexOf(':');
      if (colon >= 0) {
        spec.auth = {
          type: 'basic',
          username: decoded.slice(0, colon),
          password: decoded.slice(colon + 1),
        };
        spec.headers = spec.headers.filter((h) => h.key.toLowerCase() !== 'authorization');
      }
    } catch {
      // Not valid base64: keep the header as typed.
    }
  }

  if (!getMode) {
    if (form.length) {
      spec.body.mode = 'multipart';
      spec.body.multipart = form.map((entry) => {
        const eqIndex = entry.indexOf('=');
        const key = eqIndex >= 0 ? entry.slice(0, eqIndex) : entry;
        const val = eqIndex >= 0 ? entry.slice(eqIndex + 1) : '';
        if (val.startsWith('@')) {
          return createMultipartField({ key, kind: 'file', fileName: val.slice(1).split(';')[0] });
        }
        return createMultipartField({ key, value: val });
      });
      spec.headers = spec.headers.filter((h) => h.key.toLowerCase() !== 'content-type');
    } else if (
      urlencoded.length ||
      (data.length &&
        (contentType === '' || contentType.includes('x-www-form-urlencoded')) &&
        data.every(isFormLike))
    ) {
      spec.body.mode = 'urlencoded';
      const pairs = [...data.flatMap((d) => d.split('&')), ...urlencoded.map(encodeUrlencodedArg)];
      spec.body.urlencoded = pairs.filter(Boolean).map((pair) => {
        const eqIndex = pair.indexOf('=');
        const decode = (s: string) => {
          try {
            return decodeURIComponent(s.replace(/\+/g, ' '));
          } catch {
            return s;
          }
        };
        return createKeyValue({
          key: decode(eqIndex >= 0 ? pair.slice(0, eqIndex) : pair),
          value: decode(eqIndex >= 0 ? pair.slice(eqIndex + 1) : ''),
        });
      });
      spec.headers = spec.headers.filter((h) => h.key.toLowerCase() !== 'content-type');
    } else if (data.length) {
      const text = data.join('&');
      if (contentType.includes('json') || /^\s*[[{]/.test(text)) {
        spec.body.mode = 'json';
        spec.body.json = text;
        spec.headers = spec.headers.filter(
          (h) =>
            !(
              h.key.toLowerCase() === 'content-type' &&
              h.value.toLowerCase().startsWith('application/json')
            ),
        );
      } else {
        spec.body.mode = 'raw';
        spec.body.raw = text;
        if (contentType) {
          spec.body.rawContentType = contentType;
          spec.headers = spec.headers.filter((h) => h.key.toLowerCase() !== 'content-type');
        }
      }
    }
  }
  return { spec, warnings };
}

function isFormLike(value: string): boolean {
  return /^[^=&\s{[<]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(value);
}

/** curl --data-urlencode "name=value" encodes only the value part. */
function encodeUrlencodedArg(arg: string): string {
  const eq = arg.indexOf('=');
  if (eq < 0) return encodeURIComponent(arg);
  return `${arg.slice(0, eq)}=${encodeURIComponent(arg.slice(eq + 1))}`;
}
