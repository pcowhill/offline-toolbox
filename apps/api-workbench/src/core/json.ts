// JSON validation and formatting with human-friendly error locations.

export interface JsonError {
  message: string;
  line: number;
  column: number;
  offset: number;
}

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: JsonError };

export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Locates the first syntax error with a small strict JSON scanner. Engines word their
 * JSON.parse errors differently and some omit the position entirely.
 */
export function findJsonErrorOffset(text: string): number | null {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const literal = (word: string) => {
    for (const ch of word) {
      if (text[i] !== ch) fail();
      i++;
    }
  };
  const string = () => {
    i++; // opening quote
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return;
      }
      if (ch === '\\') {
        i++;
        if (text[i] === 'u') {
          for (let k = 1; k <= 4; k++)
            if (!/[0-9a-fA-F]/.test(text[i + k] ?? '')) {
              i += k;
              fail();
            }
          i += 5;
        } else if ('"\\/bfnrt'.includes(text[i] ?? '')) i++;
        else fail();
      } else if (ch < ' ') fail();
      else i++;
    }
    fail();
  };
  const number = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) fail();
    i += match![0].length;
  };
  const value = (depth: number): void => {
    if (depth > 512) fail();
    ws();
    const ch = text[i];
    if (ch === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        string();
        ws();
        if (text[i] !== ':') fail();
        i++;
        value(depth + 1);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return;
        }
        fail();
      }
    } else if (ch === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        value(depth + 1);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return;
        }
        fail();
      }
    } else if (ch === '"') string();
    else if (ch === 't') literal('true');
    else if (ch === 'f') literal('false');
    else if (ch === 'n') literal('null');
    else if (ch === '-' || (ch >= '0' && ch <= '9')) number();
    else fail();
  };
  try {
    value(0);
    ws();
    if (i < text.length) fail();
    return null;
  } catch (offset) {
    return typeof offset === 'number' ? Math.min(offset, text.length) : 0;
  }
}

/** Extracts the character offset from JSON.parse error messages across browser engines. */
function errorOffset(message: string, text: string): number {
  const scanned = findJsonErrorOffset(text);
  if (scanned !== null) return scanned;
  const position = /position\s+(\d+)/i.exec(message);
  if (position) return Number(position[1]);
  const lineCol = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (lineCol) {
    const line = Number(lineCol[1]);
    const column = Number(lineCol[2]);
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
    return offset + column - 1;
  }
  if (/unexpected end/i.test(message)) return text.length;
  return 0;
}

export function parseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const offset = errorOffset(raw, text);
    const { line, column } = lineColumnAt(text, offset);
    // Normalise engine-specific wording: drop the trailing "in JSON at position N…" part.
    const message = raw
      .replace(/^JSON\.parse:\s*/i, '')
      .replace(/,\s*"[\s\S]*" is not valid JSON$/, '')
      .replace(/\s*(in JSON )?at position \d+.*$/i, '')
      .replace(/\s*at line \d+ column \d+.*$/i, '')
      .trim();
    return { ok: false, error: { message: message || 'Invalid JSON', line, column, offset } };
  }
}

export function describeJsonError(error: JsonError): string {
  return `${error.message} (line ${error.line}, column ${error.column})`;
}

export function formatJson(text: string, indent = 2): string {
  return prettyJson(text, indent);
}

export function compactJson(text: string): string {
  return prettyJson(text, 0);
}

/**
 * JSON bodies may contain {{variables}} in places where a JSON value is expected
 * (e.g. "count": {{limit}}). For validation, replace such bare references with a placeholder.
 */
export function maskVariablesForValidation(text: string): string {
  return text.replace(/\{\{\s*[^{}]+?\s*\}\}/g, (match, offset: number, whole: string) => {
    // Inside a string literal? Count unescaped quotes before the match.
    let quotes = 0;
    for (let i = 0; i < offset; i++) {
      if (whole[i] === '\\') {
        i++;
        continue;
      }
      if (whole[i] === '"') quotes++;
    }
    if (quotes % 2 === 1) return match;
    return '0'.padEnd(match.length, ' ');
  });
}

// ------------------------------------------------------------------------------------------
// Lossless JSON tree. JSON.parse turns 64-bit ids such as 9007199254740993 into rounded
// doubles; for an API client that is unacceptable, so formatting and the tree view work on a
// tree that keeps every number's original text (and duplicate keys).

export type JsonNode =
  | { type: 'object'; entries: Array<[string, JsonNode]> }
  | { type: 'array'; items: JsonNode[] }
  | { type: 'string'; value: string }
  | { type: 'number'; raw: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' };

export function parseJsonTree(text: string): JsonNode {
  const errorAt = findJsonErrorOffset(text);
  if (errorAt !== null) {
    const result = parseJson(text);
    const { line, column } = lineColumnAt(text, errorAt);
    throw new Error(
      result.ok ? `Invalid JSON (line ${line}, column ${column})` : describeJsonError(result.error),
    );
  }
  let i = 0;
  const ws = () => {
    while (
      i < text.length &&
      (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')
    )
      i++;
  };
  const readString = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') {
      if (text[i] === '\\') i++;
      i++;
    }
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): JsonNode => {
    ws();
    const ch = text[i];
    if (ch === '{') {
      i++;
      const entries: Array<[string, JsonNode]> = [];
      ws();
      if (text[i] === '}') {
        i++;
        return { type: 'object', entries };
      }
      for (;;) {
        ws();
        const key = readString();
        ws();
        i++; // colon
        entries.push([key, value()]);
        ws();
        if (text[i++] === '}') return { type: 'object', entries };
      }
    }
    if (ch === '[') {
      i++;
      const items: JsonNode[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return { type: 'array', items };
      }
      for (;;) {
        items.push(value());
        ws();
        if (text[i++] === ']') return { type: 'array', items };
      }
    }
    if (ch === '"') return { type: 'string', value: readString() };
    if (ch === 't') {
      i += 4;
      return { type: 'boolean', value: true };
    }
    if (ch === 'f') {
      i += 5;
      return { type: 'boolean', value: false };
    }
    if (ch === 'n') {
      i += 4;
      return { type: 'null' };
    }
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400))!;
    i += match[0].length;
    return { type: 'number', raw: match[0] };
  };
  return value();
}

export function stringifyJsonTree(node: JsonNode, indent = 2, level = 0): string {
  const pad = indent > 0 ? '\n' + ' '.repeat(indent * (level + 1)) : '';
  const close = indent > 0 ? '\n' + ' '.repeat(indent * level) : '';
  const sep = indent > 0 ? ': ' : ':';
  switch (node.type) {
    case 'object':
      if (!node.entries.length) return '{}';
      return `{${node.entries.map(([k, v]) => `${pad}${JSON.stringify(k)}${sep}${stringifyJsonTree(v, indent, level + 1)}`).join(',')}${close}}`;
    case 'array':
      if (!node.items.length) return '[]';
      return `[${node.items.map((v) => `${pad}${stringifyJsonTree(v, indent, level + 1)}`).join(',')}${close}]`;
    case 'string':
      return JSON.stringify(node.value);
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
  }
}

/** Lossless pretty-print (keeps big numbers and duplicate keys exactly as sent). */
export function prettyJson(text: string, indent = 2): string {
  return stringifyJsonTree(parseJsonTree(text), indent);
}
