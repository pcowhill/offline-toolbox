import { describe, expect, it } from 'vitest';
import { parseCurl, shellSplit, toCurl } from '../curl';
import { createKeyValue, createRequestSpec } from '../factory';
import { compactJson, formatJson, maskVariablesForValidation, parseJson } from '../json';
import { prepareRequest } from '../request';

describe('JSON tools', () => {
  it('formats and compacts', () => {
    expect(formatJson('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(compactJson('{ "a" : 1 ,\n "b": true }')).toBe('{"a":1,"b":true}');
  });

  it('reports parse errors with line and column', () => {
    const result = parseJson('{\n  "a": 1,\n  "b": ]\n}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.line).toBe(3);
      expect(result.error.column).toBeGreaterThan(1);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
    expect(() => formatJson('{oops}')).toThrow(/line 1/);
  });

  it('masks bare variable references for validation only', () => {
    expect(parseJson(maskVariablesForValidation('{"n": {{limit}}, "s": "{{name}}"}')).ok).toBe(
      true,
    );
  });
});

describe('curl', () => {
  it('splits shell words', () => {
    expect(shellSplit(`curl -H 'A: b c' "x\\"y" $'a\\nb' plain\\ word \\\n -L`)).toEqual([
      'curl',
      '-H',
      'A: b c',
      'x"y',
      'a\nb',
      'plain word',
      '-L',
    ]);
  });

  it('parses a typical POST command', () => {
    const { spec, warnings } = parseCurl(
      `curl -X POST 'https://api.example.test/items?x=1' -H 'Content-Type: application/json' -H 'Authorization: Bearer tok' --data-raw '{"a":1}' -s`,
    );
    expect(spec.method).toBe('POST');
    expect(spec.url).toBe('https://api.example.test/items?x=1');
    expect(spec.params.map((p) => [p.key, p.value])).toEqual([['x', '1']]);
    expect(spec.auth).toEqual({ type: 'bearer', token: 'tok' });
    expect(spec.body.mode).toBe('json');
    expect(spec.body.json).toBe('{"a":1}');
    expect(spec.headers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('parses form data, basic auth and -G', () => {
    const form = parseCurl(`curl https://h/login -u bob:pw -d 'user=bob&remember=1'`).spec;
    expect(form.method).toBe('POST');
    expect(form.auth).toEqual({ type: 'basic', username: 'bob', password: 'pw' });
    expect(form.body.mode).toBe('urlencoded');
    expect(form.body.urlencoded.map((f) => [f.key, f.value])).toEqual([
      ['user', 'bob'],
      ['remember', '1'],
    ]);

    const get = parseCurl(`curl -G https://h/search --data-urlencode 'q=a b'`).spec;
    expect(get.method).toBe('GET');
    expect(get.url).toBe('https://h/search?q=a%20b');

    const multipart = parseCurl(`curl -F name=x -F file=@report.pdf https://h/upload`).spec;
    expect(multipart.body.mode).toBe('multipart');
    expect(multipart.body.multipart.map((f) => [f.key, f.kind, f.fileName])).toEqual([
      ['name', 'text', undefined],
      ['file', 'file', 'report.pdf'],
    ]);
  });

  it('rejects non-curl input', () => {
    expect(() => parseCurl('wget http://x')).toThrow(/must start with "curl"/);
    expect(() => parseCurl('curl -s')).toThrow(/No URL/);
  });

  it('exports a prepared request as curl and parses it back', () => {
    const spec = createRequestSpec({
      method: 'PATCH',
      url: 'https://h/items/1',
      headers: [createKeyValue({ key: 'X-Note', value: "it's" })],
    });
    spec.body.mode = 'json';
    spec.body.json = '{"done":true}';
    const prepared = prepareRequest(spec, new Map()).request!;
    const command = toCurl(prepared);
    expect(command).toContain(`-X PATCH`);
    expect(command).toContain(`'X-Note: it'\\''s'`);
    const back = parseCurl(command).spec;
    expect(back.method).toBe('PATCH');
    expect(back.body.json).toBe('{"done":true}');
    expect(back.headers.map((h) => [h.key, h.value])).toEqual([['X-Note', "it's"]]);
  });
});

describe('JSON error locator', () => {
  it('agrees with JSON.parse on validity', async () => {
    const { findJsonErrorOffset } = await import('../json');
    const valid = ['{}', '[]', '{"a":[1,2.5e3,-0,true,false,null,"\\u00e9\\n"]}', ' "x" ', '0'];
    const invalid: Array<[string, number]> = [
      ['{"a":1,}', 7],
      ['[1 2]', 3],
      ['{"a" 1}', 5],
      ['tru', 3],
      ['01', 1],
      ['"\\x"', 2],
      ['{} x', 3],
      ['', 0],
    ];
    for (const text of valid) expect(findJsonErrorOffset(text)).toBeNull();
    for (const [text, offset] of invalid) expect(findJsonErrorOffset(text)).toBe(offset);
  });
});

describe('lossless JSON', () => {
  it('keeps big integers, number formatting and duplicate keys', async () => {
    const { formatJson, compactJson, parseJsonTree } = await import('../json');
    const text =
      '{"id": 9007199254740993, "f": 1.50, "e": 1E+3, "dup": 1, "dup": 2, "s": "\\u00e9\\"", "a": [], "o": {}}';
    expect(compactJson(text)).toBe(
      '{"id":9007199254740993,"f":1.50,"e":1E+3,"dup":1,"dup":2,"s":"é\\"","a":[],"o":{}}',
    );
    expect(formatJson('[1,{"a":null}]')).toBe('[\n  1,\n  {\n    "a": null\n  }\n]');
    expect(parseJsonTree('true')).toEqual({ type: 'boolean', value: true });
    expect(() => parseJsonTree('{"a":}')).toThrow(/line 1/);
  });
});

describe('curl credentials', () => {
  it('moves an Authorization: Basic header into the Auth tab', () => {
    const header = Buffer.from('ana:s3cret').toString('base64');
    const { spec } = parseCurl(`curl https://h/ -H 'Authorization: Basic ${header}'`);
    expect(spec.auth).toEqual({ type: 'basic', username: 'ana', password: 's3cret' });
    expect(spec.headers).toEqual([]);
  });
});
