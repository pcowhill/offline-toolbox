import { describe, expect, it } from 'vitest';
import { base64Utf8 } from '../auth';
import { createKeyValue, createMultipartField, createRequestSpec } from '../factory';
import { prepareRequest, toBodyInit } from '../request';

const vars = new Map([
  ['baseUrl', 'https://api.example.test'],
  ['token', 'abc123'],
  ['id', '42'],
]);

describe('prepareRequest', () => {
  it('constructs URL, params, headers and auth with variable substitution', () => {
    const spec = createRequestSpec({
      method: 'GET',
      url: '{{baseUrl}}/users/{{id}}?expand=true',
      params: [
        createKeyValue({ key: 'expand', value: 'true' }),
        createKeyValue({ key: 'skip', value: '1', enabled: false }),
      ],
      headers: [
        createKeyValue({ key: 'X-Trace', value: 'id-{{id}}' }),
        createKeyValue({ key: 'X-Off', value: '1', enabled: false }),
      ],
      auth: { type: 'bearer', token: '{{token}}' },
    });
    const result = prepareRequest(spec, vars);
    expect(result.errors).toEqual([]);
    expect(result.request?.url).toBe('https://api.example.test/users/42?expand=true');
    expect(result.request?.headers).toEqual([
      ['X-Trace', 'id-42'],
      ['Authorization', 'Bearer abc123'],
    ]);
  });

  it('generates basic auth headers (UTF-8 safe)', () => {
    const spec = createRequestSpec({
      url: 'http://h/',
      auth: { type: 'basic', username: 'aladdin', password: 'opensesame' },
    });
    expect(prepareRequest(spec, vars).request?.headers).toEqual([
      ['Authorization', 'Basic YWxhZGRpbjpvcGVuc2VzYW1l'],
    ]);
    expect(base64Utf8('ü:ß')).toBe(Buffer.from('ü:ß', 'utf8').toString('base64'));
  });

  it('lets an explicit Authorization header win over the auth tab, with a warning', () => {
    const spec = createRequestSpec({
      url: 'http://h/',
      headers: [createKeyValue({ key: 'Authorization', value: 'Custom x' })],
      auth: { type: 'bearer', token: 't' },
    });
    const result = prepareRequest(spec, vars);
    expect(result.request?.headers).toEqual([['Authorization', 'Custom x']]);
    expect(result.warnings.join(' ')).toMatch(/overrides the Auth tab/);
  });

  it('reports unresolved variables as warnings', () => {
    const result = prepareRequest(createRequestSpec({ url: 'http://h/{{missing}}' }), vars);
    expect(result.unresolved).toEqual(['missing']);
    expect(result.warnings[0]).toMatch(/Unresolved variable: \{\{missing\}\}/);
  });

  it('fails clearly on empty or invalid URLs and header names', () => {
    expect(prepareRequest(createRequestSpec({ url: '' }), vars).errors).toEqual(['Enter a URL.']);
    expect(prepareRequest(createRequestSpec({ url: 'http://' }), vars).errors[0]).toMatch(
      /not a valid URL/,
    );
    const bad = createRequestSpec({
      url: 'http://h',
      headers: [createKeyValue({ key: 'Bad Header', value: '1' })],
    });
    expect(prepareRequest(bad, vars).errors[0]).toMatch(/not a valid header name/);
  });

  it('warns about headers browsers forbid', () => {
    const spec = createRequestSpec({
      url: 'http://h',
      headers: [createKeyValue({ key: 'Host', value: 'x' })],
    });
    expect(prepareRequest(spec, vars).warnings.join(' ')).toMatch(
      /do not allow scripts to set the "Host"/,
    );
  });

  it('JSON body: adds Content-Type, substitutes variables and validates', () => {
    const spec = createRequestSpec({ method: 'POST', url: 'http://h' });
    spec.body.mode = 'json';
    spec.body.json = '{"id": {{id}}, "token": "{{token}}"}';
    const result = prepareRequest(spec, vars);
    expect(result.request?.body).toEqual({
      kind: 'text',
      text: '{"id": 42, "token": "abc123"}',
      contentType: 'application/json',
    });
    expect(result.request?.headers).toContainEqual(['Content-Type', 'application/json']);
    expect(result.warnings).toEqual([]);

    spec.body.json = '{"broken": }';
    expect(prepareRequest(spec, vars).warnings.join(' ')).toMatch(/not valid JSON/);
  });

  it('respects a user-provided Content-Type for raw bodies', () => {
    const spec = createRequestSpec({
      method: 'PUT',
      url: 'http://h',
      headers: [createKeyValue({ key: 'content-type', value: 'text/csv' })],
    });
    spec.body.mode = 'raw';
    spec.body.raw = 'a,b';
    const headers = prepareRequest(spec, vars).request?.headers;
    expect(headers).toEqual([['content-type', 'text/csv']]);
  });

  it('drops bodies for GET with a warning', () => {
    const spec = createRequestSpec({ method: 'GET', url: 'http://h' });
    spec.body.mode = 'json';
    spec.body.json = '{}';
    const result = prepareRequest(spec, vars);
    expect(result.request?.body.kind).toBe('none');
    expect(result.warnings.join(' ')).toMatch(/cannot send a body with GET/);
  });

  it('urlencoded body', async () => {
    const spec = createRequestSpec({ method: 'POST', url: 'http://h' });
    spec.body.mode = 'urlencoded';
    spec.body.urlencoded = [
      createKeyValue({ key: 'name', value: 'a b&c' }),
      createKeyValue({ key: 'id', value: '{{id}}' }),
    ];
    const result = prepareRequest(spec, vars);
    expect(toBodyInit(result.request!.body)).toBe('name=a+b%26c&id=42');
    expect(result.request?.headers).toContainEqual([
      'Content-Type',
      'application/x-www-form-urlencoded;charset=UTF-8',
    ]);
  });

  it('multipart body with text and file fields', async () => {
    const spec = createRequestSpec({ method: 'POST', url: 'http://h' });
    spec.body.mode = 'multipart';
    const fileField = createMultipartField({ key: 'upload', kind: 'file', fileName: 'a.txt' });
    spec.body.multipart = [
      createMultipartField({ key: 'title', value: 'Report {{id}}' }),
      fileField,
    ];

    const missing = prepareRequest(spec, vars);
    expect(missing.errors[0]).toMatch(/Re-select the file "a.txt"/);

    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const result = prepareRequest(spec, vars, { files: new Map([[fileField.id, file]]) });
    const form = toBodyInit(result.request!.body) as FormData;
    expect(form.get('title')).toBe('Report 42');
    expect(await (form.get('upload') as File).text()).toBe('hello');
  });
});
