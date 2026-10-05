import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeSchema,
  exampleFromSchema,
  groupOperationsByTag,
  importSpec,
  requestFromOperation,
  suggestedBaseUrl,
} from '../openapi';
import { prepareRequest } from '../request';

const fixtures = path.resolve(import.meta.dirname, '../../../../../tests/fixtures/openapi');
const yamlText = fs.readFileSync(path.join(fixtures, 'library-api.yaml'), 'utf8');
const swaggerText = fs.readFileSync(path.join(fixtures, 'inventory-swagger2.json'), 'utf8');

describe('OpenAPI 3 import', () => {
  const api = importSpec(yamlText, 'library-api.yaml');
  const op = (id: string) => api.operations.find((o) => o.operationId === id || o.summary === id)!;

  it('reads info, servers, tags and operations', () => {
    expect(api.title).toBe('Library API');
    expect(api.version).toBe('1.2.0');
    expect(api.specVersion).toBe('OpenAPI 3.0.3');
    expect(api.servers[0].url).toBe('http://127.0.0.1:4010/api');
    expect(suggestedBaseUrl(api)).toEqual({ url: 'http://127.0.0.1:4010/api', relative: false });
    expect(api.operations).toHaveLength(6);
    const groups = groupOperationsByTag(api);
    expect(groups.map((g) => [g.tag, g.operations.length])).toEqual([
      ['books', 4],
      ['members', 2],
    ]);
    expect(api.warnings).toEqual([]);
  });

  it('resolves parameters including $ref and path-level parameters', () => {
    expect(op('listBooks').parameters.map((p) => `${p.in}:${p.name}`)).toEqual([
      'query:limit',
      'query:author',
    ]);
    expect(op('getBook').parameters.map((p) => `${p.in}:${p.name}:${p.required}`)).toEqual([
      'path:bookId:true',
      'header:X-Request-Id:false',
    ]);
    expect(op('Remove a book').deprecated).toBe(true);
    expect(op('createBook').responses.map((r) => r.status)).toEqual(['201', '400']);
    expect(op('createBook').responses[1].content[0].contentType).toBe('application/problem+json');
  });

  it('generates examples from schemas (allOf, readOnly, recursion)', () => {
    const book = exampleFromSchema(api.document, { $ref: '#/components/schemas/Book' });
    expect(book).toEqual({
      title: 'Emma',
      author: 'Jane Austen',
      year: 1815,
      tags: ['string'],
      related: [{}],
    });
    const rows = describeSchema(api.document, { $ref: '#/components/schemas/Book' });
    expect(rows.find((r) => r.path === 'title')).toMatchObject({ required: true, type: 'string' });
    expect(rows.some((r) => r.type.includes('recursive'))).toBe(true);
  });

  it('turns an operation into an editable request', () => {
    const { spec, name } = requestFromOperation(api, op('listBooks'));
    expect(name).toBe('List books');
    expect(spec.method).toBe('GET');
    expect(spec.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['limit', '20', false],
      ['author', 'Austen', false],
    ]);
    expect(spec.url).toBe('{{baseUrl}}/books');
    expect(spec.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(spec.headers.map((h) => [h.key, h.value])).toEqual([['Accept', 'application/json']]);

    const vars = new Map([
      ['baseUrl', 'http://127.0.0.1:4010/api'],
      ['token', 't'],
    ]);
    expect(prepareRequest(spec, vars).request?.url).toBe('http://127.0.0.1:4010/api/books');
  });

  it('JSON, form and multipart bodies; path params become variables', () => {
    const create = requestFromOperation(api, op('createBook')).spec;
    expect(create.body.mode).toBe('json');
    expect(JSON.parse(create.body.json)).toEqual({
      title: 'Emma',
      author: 'Jane Austen',
      year: 1815,
      tags: ['string'],
    });

    const get = requestFromOperation(api, op('getBook'));
    expect(get.spec.url).toBe('{{baseUrl}}/books/{{bookId}}');
    expect(get.notes.join(' ')).toMatch(/\{\{bookId\}\}/);

    const login = requestFromOperation(api, op('Log in')).spec;
    expect(login.auth.type).toBe('none');
    expect(login.body.mode).toBe('urlencoded');
    expect(login.body.urlencoded.map((f) => [f.key, f.enabled])).toEqual([
      ['username', true],
      ['password', true],
      ['remember', false],
    ]);

    const avatar = requestFromOperation(api, op('Upload avatar')).spec;
    expect(avatar.body.mode).toBe('multipart');
    expect(avatar.body.multipart.map((f) => [f.key, f.kind])).toEqual([
      ['caption', 'text'],
      ['image', 'file'],
    ]);
  });

  it('rejects documents that are not OpenAPI', () => {
    expect(() => importSpec('{"hello": 1}', 'x.json')).toThrow(/Not an OpenAPI document/);
    expect(() => importSpec('a: [', 'x.yaml')).toThrow(/Invalid YAML/);
    expect(() => importSpec('{', 'x.json')).toThrow(/Invalid JSON/);
  });
});

describe('Swagger 2.0 import', () => {
  const api = importSpec(swaggerText, 'inventory.json');

  it('normalises host/basePath, body and formData parameters, apiKey security', () => {
    expect(api.specVersion).toBe('Swagger 2.0');
    expect(api.servers[0].url).toBe('http://127.0.0.1:4010/inv');
    const list = api.operations.find((o) => o.summary === 'List items')!;
    const listReq = requestFromOperation(api, list).spec;
    expect(listReq.params.map((p) => [p.key, p.value])).toEqual([['page', '1']]);
    expect(listReq.headers.map((h) => [h.key, h.value])).toEqual([
      ['Accept', 'application/json'],
      ['X-API-Key', '{{X_API_Key}}'],
    ]);

    const create = requestFromOperation(
      api,
      api.operations.find((o) => o.summary === 'Create item')!,
    ).spec;
    expect(JSON.parse(create.body.json)).toEqual({ sku: 'ABC-1', quantity: 1 });

    const upload = requestFromOperation(
      api,
      api.operations.find((o) => o.summary === 'Upload photo')!,
    ).spec;
    expect(upload.body.mode).toBe('multipart');
    expect(upload.body.multipart.map((f) => [f.key, f.kind, f.enabled])).toEqual([
      ['note', 'text', false],
      ['file', 'file', true],
    ]);
  });
});
