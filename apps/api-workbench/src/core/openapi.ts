// OpenAPI 3.x / Swagger 2.0 import. Specifications are treated purely as data: nothing in
// them is executed, fetched or rendered as HTML. Only local "#/..." references are resolved.
import { createId } from '@shared/lib/id';
import { parse as parseYaml } from 'yaml';
import { createKeyValue, createMultipartField, createRequestSpec } from './factory';
import { HTTP_METHODS, type HttpMethod, type RequestSpec } from './types';
import { urlWithParams } from './url';

type Json = Record<string, unknown>;
export type Schema = Json;

export interface ApiServer {
  url: string;
  description?: string;
}

export interface ApiParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required: boolean;
  description?: string;
  deprecated?: boolean;
  schema?: Schema;
  example?: unknown;
}

export interface ApiMediaType {
  contentType: string;
  schema?: Schema;
  example?: unknown;
}

export interface ApiRequestBody {
  required: boolean;
  description?: string;
  content: ApiMediaType[];
}

export interface ApiResponse {
  status: string;
  description?: string;
  content: ApiMediaType[];
}

export interface SecurityScheme {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect' | 'mutualTLS' | string;
  scheme?: string;
  name?: string;
  in?: string;
  description?: string;
}

export interface ApiOperation {
  id: string;
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: ApiResponse[];
  /** Alternative requirement sets, each listing scheme names. Empty list = no auth. */
  security: string[][];
}

export interface ApiSpec {
  id: string;
  fileName: string;
  importedAt: number;
  specVersion: string;
  title: string;
  version: string;
  description?: string;
  servers: ApiServer[];
  tags: Array<{ name: string; description?: string }>;
  operations: ApiOperation[];
  securitySchemes: Record<string, SecurityScheme>;
  warnings: string[];
  /** Original (parsed) document, kept for resolving schema references on demand. */
  document: Json;
}

const MAX_SPEC_BYTES = 25 * 1024 * 1024;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Parses JSON or YAML text. */
export function parseSpecText(text: string): Json {
  if (text.length > MAX_SPEC_BYTES)
    throw new Error('The specification file is too large (limit 25 MB).');
  const trimmed = text.trimStart();
  let data: unknown;
  if (trimmed.startsWith('{')) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON: ${(error as Error).message}`, { cause: error });
    }
  } else {
    try {
      // maxAliasCount guards against "billion laughs" alias expansion.
      data = parseYaml(text, { maxAliasCount: 1000, prettyErrors: true });
    } catch (error) {
      throw new Error(`Invalid YAML: ${(error as Error).message}`, { cause: error });
    }
  }
  if (!isObject(data)) throw new Error('The file does not contain an OpenAPI/Swagger object.');
  return data;
}

/** Resolves a local JSON pointer such as "#/components/schemas/Pet". */
export function resolvePointer(document: Json, ref: string): unknown {
  if (!ref.startsWith('#')) return undefined;
  const parts = ref
    .slice(1)
    .split('/')
    .filter((p, i) => i > 0 || p !== '')
    .map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = document;
  for (const part of parts) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Json)[part];
  }
  return current;
}

/** Follows $ref chains (shallowly) for parameters, bodies, responses and schemas. */
export function deref<T = Json>(
  document: Json,
  value: unknown,
  seen = new Set<string>(),
): T | undefined {
  if (!isObject(value)) return value as T | undefined;
  const ref = str(value.$ref);
  if (!ref) return value as T;
  if (seen.has(ref)) return undefined;
  seen.add(ref);
  const target = resolvePointer(document, ref);
  if (target === undefined) return undefined;
  return deref<T>(document, target, seen);
}

function refName(value: unknown): string | undefined {
  return isObject(value) && typeof value.$ref === 'string'
    ? value.$ref.split('/').pop()
    : undefined;
}

// ------------------------------------------------------------------------------------------
// Normalisation

export function normalizeSpec(document: Json, fileName = 'spec'): ApiSpec {
  const warnings: string[] = [];
  const isSwagger2 = typeof document.swagger === 'string' && document.swagger.startsWith('2');
  const openapi = str(document.openapi);
  if (!isSwagger2 && !openapi) {
    throw new Error('Not an OpenAPI document: missing "openapi" (3.x) or "swagger" (2.0) field.');
  }
  if (openapi && !openapi.startsWith('3'))
    warnings.push(`OpenAPI version ${openapi} is not fully supported.`);
  const info = isObject(document.info) ? document.info : {};

  const servers: ApiServer[] = isSwagger2 ? swagger2Servers(document) : openapiServers(document);
  const securitySchemes = isSwagger2
    ? swagger2SecuritySchemes(document)
    : openapiSecuritySchemes(document);
  const globalSecurity = securityRequirements(document.security);

  const operations: ApiOperation[] = [];
  const paths = isObject(document.paths) ? document.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const pathItem = deref<Json>(document, rawItem);
    if (!isObject(pathItem)) continue;
    const sharedParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const method of HTTP_METHODS) {
      const rawOp = pathItem[method.toLowerCase()];
      if (!isObject(rawOp)) continue;
      try {
        operations.push(
          isSwagger2
            ? swagger2Operation(document, method, path, rawOp, sharedParams, globalSecurity)
            : openapiOperation(document, method, path, rawOp, sharedParams, globalSecurity),
        );
      } catch (error) {
        warnings.push(`${method} ${path}: ${(error as Error).message}`);
      }
    }
    if (isObject(pathItem.trace))
      warnings.push(`TRACE ${path} was skipped (not supported by browsers).`);
  }

  const declaredTags = Array.isArray(document.tags)
    ? document.tags
        .filter(isObject)
        .map((t) => ({ name: String(t.name ?? ''), description: str(t.description) }))
    : [];
  const tagNames = new Set(declaredTags.map((t) => t.name));
  for (const op of operations) {
    for (const tag of op.tags) {
      if (!tagNames.has(tag)) {
        tagNames.add(tag);
        declaredTags.push({ name: tag, description: undefined });
      }
    }
  }

  return {
    id: createId(),
    fileName,
    importedAt: Date.now(),
    specVersion: isSwagger2 ? `Swagger ${String(document.swagger)}` : `OpenAPI ${openapi}`,
    title: str(info.title) ?? fileName,
    version: str(info.version) ?? '',
    description: str(info.description),
    servers,
    tags: declaredTags,
    operations,
    securitySchemes,
    warnings,
    document,
  };
}

export function importSpec(text: string, fileName: string): ApiSpec {
  return normalizeSpec(parseSpecText(text), fileName);
}

function securityRequirements(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((req) => Object.keys(req));
}

function openapiServers(document: Json): ApiServer[] {
  const servers = Array.isArray(document.servers) ? document.servers.filter(isObject) : [];
  return servers.map((server) => {
    let url = str(server.url) ?? '';
    const variables = isObject(server.variables) ? server.variables : {};
    for (const [name, variable] of Object.entries(variables)) {
      const def = isObject(variable) ? variable.default : undefined;
      url = url.replaceAll(`{${name}}`, def === undefined ? `{${name}}` : String(def));
    }
    return { url, description: str(server.description) };
  });
}

function swagger2Servers(document: Json): ApiServer[] {
  const host = str(document.host);
  const basePath = str(document.basePath) ?? '';
  const schemes = Array.isArray(document.schemes) ? document.schemes.map(String) : [];
  if (!host) return basePath ? [{ url: basePath }] : [];
  const list = schemes.length ? schemes : ['https'];
  return list.map((scheme) => ({ url: `${scheme}://${host}${basePath}`.replace(/\/$/, '') }));
}

function openapiSecuritySchemes(document: Json): Record<string, SecurityScheme> {
  const components = isObject(document.components) ? document.components : {};
  const schemes = isObject(components.securitySchemes) ? components.securitySchemes : {};
  const out: Record<string, SecurityScheme> = {};
  for (const [name, raw] of Object.entries(schemes)) {
    const scheme = deref<Json>(document, raw);
    if (!isObject(scheme)) continue;
    out[name] = {
      type: String(scheme.type ?? ''),
      scheme: str(scheme.scheme)?.toLowerCase(),
      name: str(scheme.name),
      in: str(scheme.in),
      description: str(scheme.description),
    };
  }
  return out;
}

function swagger2SecuritySchemes(document: Json): Record<string, SecurityScheme> {
  const defs = isObject(document.securityDefinitions) ? document.securityDefinitions : {};
  const out: Record<string, SecurityScheme> = {};
  for (const [name, scheme] of Object.entries(defs)) {
    if (!isObject(scheme)) continue;
    if (scheme.type === 'basic')
      out[name] = { type: 'http', scheme: 'basic', description: str(scheme.description) };
    else
      out[name] = {
        type: String(scheme.type ?? ''),
        name: str(scheme.name),
        in: str(scheme.in),
        description: str(scheme.description),
      };
  }
  return out;
}

function mergeParameters(document: Json, shared: unknown[], own: unknown[]): Json[] {
  const map = new Map<string, Json>();
  for (const raw of [...shared, ...own]) {
    const param = deref<Json>(document, raw);
    if (!isObject(param) || typeof param.name !== 'string') continue;
    map.set(`${String(param.in)}:${param.name}`, param);
  }
  return [...map.values()];
}

function operationBase(method: HttpMethod, path: string, op: Json, globalSecurity: string[][]) {
  return {
    id: createId(),
    method,
    path,
    operationId: str(op.operationId),
    summary: str(op.summary),
    description: str(op.description),
    tags: Array.isArray(op.tags) && op.tags.length ? op.tags.map(String) : ['default'],
    deprecated: op.deprecated === true,
    security: op.security !== undefined ? securityRequirements(op.security) : globalSecurity,
  };
}

function toParameter(param: Json, schema: Schema | undefined): ApiParameter {
  const location = ['query', 'header', 'path', 'cookie'].includes(String(param.in))
    ? (param.in as ApiParameter['in'])
    : 'query';
  const examples = isObject(param.examples)
    ? Object.values(param.examples).find(isObject)
    : undefined;
  return {
    name: String(param.name),
    in: location,
    required: param.required === true || location === 'path',
    description: str(param.description),
    deprecated: param.deprecated === true,
    schema,
    example: param.example ?? examples?.value ?? (schema ? schema.example : undefined),
  };
}

function mediaTypes(document: Json, content: unknown): ApiMediaType[] {
  if (!isObject(content)) return [];
  return Object.entries(content).map(([contentType, raw]) => {
    const media = isObject(raw) ? raw : {};
    const examples = isObject(media.examples)
      ? Object.values(media.examples)
          .map((e) => deref<Json>(document, e))
          .find(isObject)
      : undefined;
    return {
      contentType,
      schema: isObject(media.schema) ? (media.schema as Schema) : undefined,
      example: media.example ?? examples?.value,
    };
  });
}

function openapiOperation(
  document: Json,
  method: HttpMethod,
  path: string,
  op: Json,
  shared: unknown[],
  globalSecurity: string[][],
): ApiOperation {
  const params = mergeParameters(
    document,
    shared,
    Array.isArray(op.parameters) ? op.parameters : [],
  );
  const requestBodyRaw = deref<Json>(document, op.requestBody);
  const responses = isObject(op.responses) ? op.responses : {};
  return {
    ...operationBase(method, path, op, globalSecurity),
    parameters: params.map((p) =>
      toParameter(p, isObject(p.schema) ? (p.schema as Schema) : undefined),
    ),
    requestBody: isObject(requestBodyRaw)
      ? {
          required: requestBodyRaw.required === true,
          description: str(requestBodyRaw.description),
          content: mediaTypes(document, requestBodyRaw.content),
        }
      : undefined,
    responses: Object.entries(responses).map(([status, raw]) => {
      const response = deref<Json>(document, raw) ?? {};
      return {
        status,
        description: str(response.description),
        content: mediaTypes(document, response.content),
      };
    }),
  };
}

function swagger2Operation(
  document: Json,
  method: HttpMethod,
  path: string,
  op: Json,
  shared: unknown[],
  globalSecurity: string[][],
): ApiOperation {
  const params = mergeParameters(
    document,
    shared,
    Array.isArray(op.parameters) ? op.parameters : [],
  );
  const consumes = (
    Array.isArray(op.consumes)
      ? op.consumes
      : Array.isArray(document.consumes)
        ? document.consumes
        : ['application/json']
  ).map(String);
  const produces = (
    Array.isArray(op.produces)
      ? op.produces
      : Array.isArray(document.produces)
        ? document.produces
        : ['application/json']
  ).map(String);

  const parameters: ApiParameter[] = [];
  let requestBody: ApiRequestBody | undefined;
  const formFields: Json[] = [];
  for (const param of params) {
    if (param.in === 'body') {
      requestBody = {
        required: param.required === true,
        description: str(param.description),
        content: consumes.map((contentType) => ({
          contentType,
          schema: isObject(param.schema) ? (param.schema as Schema) : undefined,
          example: param['x-example'],
        })),
      };
    } else if (param.in === 'formData') {
      formFields.push(param);
    } else {
      // Swagger 2 puts type/format/enum directly on the parameter.
      const { name: _n, in: _i, required: _r, description: _d, ...schema } = param;
      parameters.push(toParameter(param, schema as Schema));
    }
  }
  if (formFields.length) {
    const hasFile = formFields.some((f) => f.type === 'file');
    const properties: Json = {};
    for (const field of formFields) {
      properties[String(field.name)] =
        field.type === 'file'
          ? { type: 'string', format: 'binary' }
          : { ...field, name: undefined, in: undefined };
    }
    requestBody = {
      required: formFields.some((f) => f.required === true),
      content: [
        {
          contentType: hasFile
            ? 'multipart/form-data'
            : (consumes.find((c) => c.includes('form')) ?? 'application/x-www-form-urlencoded'),
          schema: {
            type: 'object',
            properties,
            required: formFields.filter((f) => f.required === true).map((f) => String(f.name)),
          },
        },
      ],
    };
  }
  const responses = isObject(op.responses) ? op.responses : {};
  return {
    ...operationBase(method, path, op, globalSecurity),
    parameters,
    requestBody,
    responses: Object.entries(responses).map(([status, raw]) => {
      const response = deref<Json>(document, raw) ?? {};
      const schema = isObject(response.schema) ? (response.schema as Schema) : undefined;
      const examples = isObject(response.examples) ? response.examples : {};
      return {
        status,
        description: str(response.description),
        content:
          schema || Object.keys(examples).length
            ? produces.map((contentType) => ({
                contentType,
                schema,
                example: examples[contentType],
              }))
            : [],
      };
    }),
  };
}

// ------------------------------------------------------------------------------------------
// Schemas: example generation and a readable summary

const MAX_DEPTH = 8;

/** Produces a plausible example value from a JSON schema (OpenAPI flavour). */
export function exampleFromSchema(
  document: Json,
  schemaInput: unknown,
  depth = 0,
  seen: string[] = [],
): unknown {
  if (!isObject(schemaInput)) return null;
  const ref = str(schemaInput.$ref);
  if (ref) {
    if (seen.includes(ref) || depth > MAX_DEPTH) return {};
    return exampleFromSchema(document, resolvePointer(document, ref), depth + 1, [...seen, ref]);
  }
  const schema = schemaInput;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (depth > MAX_DEPTH) return null;

  if (Array.isArray(schema.allOf)) {
    const merged: Json = {};
    let nonObject: unknown;
    for (const part of schema.allOf) {
      const value = exampleFromSchema(document, part, depth + 1, seen);
      if (isObject(value)) Object.assign(merged, value);
      else if (value !== null && value !== undefined) nonObject = value;
    }
    return Object.keys(merged).length ? merged : (nonObject ?? {});
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length)
      return exampleFromSchema(document, options[0], depth + 1, seen);
  }

  let type = schema.type;
  if (Array.isArray(type)) type = type.find((t) => t !== 'null') ?? type[0];
  if (!type) type = isObject(schema.properties) ? 'object' : schema.items ? 'array' : 'string';

  switch (type) {
    case 'object': {
      const out: Json = {};
      const properties = isObject(schema.properties) ? schema.properties : {};
      for (const [name, prop] of Object.entries(properties)) {
        if (isObject(prop) && prop.readOnly === true) continue;
        out[name] = exampleFromSchema(document, prop, depth + 1, seen);
      }
      if (!Object.keys(out).length && isObject(schema.additionalProperties)) {
        out.key = exampleFromSchema(document, schema.additionalProperties, depth + 1, seen);
      }
      return out;
    }
    case 'array':
      return schema.items ? [exampleFromSchema(document, schema.items, depth + 1, seen)] : [];
    case 'integer':
      return typeof schema.minimum === 'number' ? Math.ceil(schema.minimum) : 0;
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      switch (schema.format) {
        case 'date-time':
          return '2024-01-01T00:00:00Z';
        case 'date':
          return '2024-01-01';
        case 'email':
          return 'user@example.com';
        case 'uuid':
          return '00000000-0000-0000-0000-000000000000';
        case 'uri':
        case 'url':
          return 'https://example.com';
        case 'binary':
          return '';
        default:
          return 'string';
      }
  }
}

export interface SchemaRow {
  path: string;
  depth: number;
  type: string;
  required: boolean;
  description?: string;
  ref?: string;
}

/** Flattens a schema into rows for a readable property table (depth-limited, cycle-safe). */
export function describeSchema(document: Json, schemaInput: unknown, maxRows = 300): SchemaRow[] {
  const rows: SchemaRow[] = [];
  const visit = (
    schemaRaw: unknown,
    path: string,
    depth: number,
    required: boolean,
    seen: string[],
  ) => {
    if (rows.length >= maxRows || !isObject(schemaRaw)) return;
    const name = refName(schemaRaw);
    const ref = str(schemaRaw.$ref);
    if (ref && seen.includes(ref)) {
      rows.push({ path, depth, type: `${name} (recursive)`, required, ref: name });
      return;
    }
    const schema = ref ? deref<Json>(document, schemaRaw) : schemaRaw;
    if (!isObject(schema)) {
      rows.push({ path, depth, type: name ? `${name} (unresolved)` : 'unknown', required });
      return;
    }
    const nextSeen = ref ? [...seen, ref] : seen;
    let type = Array.isArray(schema.type) ? schema.type.join(' | ') : str(schema.type);
    if (!type)
      type = schema.properties
        ? 'object'
        : schema.items
          ? 'array'
          : schema.allOf
            ? 'allOf'
            : schema.oneOf
              ? 'oneOf'
              : schema.anyOf
                ? 'anyOf'
                : 'any';
    if (schema.format) type += ` (${String(schema.format)})`;
    if (Array.isArray(schema.enum))
      type += ` enum: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
    if (type.startsWith('array') && isObject(schema.items)) {
      const itemName = refName(schema.items);
      if (itemName) type = `array of ${itemName}`;
    }
    if (path)
      rows.push({
        path,
        depth,
        type: name && !type.includes(name) ? `${name} · ${type}` : type,
        required,
        description: str(schema.description),
        ref: name,
      });
    if (depth > MAX_DEPTH) return;
    const requiredSet = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    if (isObject(schema.properties)) {
      for (const [prop, child] of Object.entries(schema.properties)) {
        visit(
          child,
          path ? `${path}.${prop}` : prop,
          path ? depth + 1 : depth,
          requiredSet.has(prop),
          nextSeen,
        );
      }
    }
    if (isObject(schema.items)) visit(schema.items, `${path}[]`, depth + 1, false, nextSeen);
    for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
      const list = schema[key];
      if (Array.isArray(list))
        list.forEach((part, i) =>
          visit(
            part,
            key === 'allOf' ? path : `${path}<${key} ${i + 1}>`,
            depth + (key === 'allOf' ? 0 : 1),
            required,
            nextSeen,
          ),
        );
    }
  };
  visit(schemaInput, '', 0, false, []);
  return rows;
}

// ------------------------------------------------------------------------------------------
// Operation → editable request

function exampleString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export interface RequestFromOperation {
  spec: RequestSpec;
  name: string;
  notes: string[];
}

export function preferredMediaType(content: ApiMediaType[]): ApiMediaType | undefined {
  return (
    content.find((c) => c.contentType === 'application/json') ??
    content.find((c) => c.contentType.includes('json')) ??
    content.find((c) => c.contentType === 'application/x-www-form-urlencoded') ??
    content.find((c) => c.contentType === 'multipart/form-data') ??
    content[0]
  );
}

export function requestFromOperation(api: ApiSpec, operation: ApiOperation): RequestFromOperation {
  const notes: string[] = [];
  const spec = createRequestSpec({ method: operation.method });
  const path = operation.path.replace(/\{([^}]+)\}/g, (_m, name: string) => `{{${name}}}`);
  const pathParams = operation.parameters.filter((p) => p.in === 'path');
  if (pathParams.length) {
    notes.push(
      `Path parameters became variables: ${pathParams.map((p) => `{{${p.name}}}`).join(', ')}. Define them in your environment or edit the URL.`,
    );
  }
  const base = '{{baseUrl}}';
  spec.params = operation.parameters
    .filter((p) => p.in === 'query')
    .map((p) =>
      createKeyValue({
        key: p.name,
        value: exampleString(
          p.example ?? (p.schema ? exampleFromSchema(api.document, p.schema) : ''),
        ),
        enabled: p.required,
        description: p.description,
      }),
    );
  spec.url = urlWithParams(`${base}${path}`, spec.params);
  spec.headers = operation.parameters
    .filter((p) => p.in === 'header')
    .map((p) =>
      createKeyValue({
        key: p.name,
        value: exampleString(
          p.example ?? (p.schema ? exampleFromSchema(api.document, p.schema) : ''),
        ),
        enabled: p.required,
        description: p.description,
      }),
    );
  if (operation.parameters.some((p) => p.in === 'cookie')) {
    notes.push('Cookie parameters cannot be set by browser scripts and were skipped.');
  }

  // Accept header from the first successful response's media type.
  const success = operation.responses.find((r) => r.status.startsWith('2'));
  const responseType = success && preferredMediaType(success.content);
  if (responseType && !spec.headers.some((h) => h.key.toLowerCase() === 'accept')) {
    spec.headers.push(createKeyValue({ key: 'Accept', value: responseType.contentType }));
  }

  // Body
  const media = operation.requestBody && preferredMediaType(operation.requestBody.content);
  if (media) {
    const example = media.example ?? exampleFromSchema(api.document, media.schema);
    const type = media.contentType;
    if (type.includes('json')) {
      spec.body.mode = 'json';
      spec.body.json = JSON.stringify(example ?? {}, null, 2);
      if (type !== 'application/json')
        spec.headers.push(createKeyValue({ key: 'Content-Type', value: type }));
    } else if (type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data') {
      const schema = deref<Json>(api.document, media.schema) ?? {};
      const properties = isObject(schema.properties) ? schema.properties : {};
      const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
      const values = isObject(example) ? example : {};
      if (type === 'multipart/form-data') {
        spec.body.mode = 'multipart';
        spec.body.multipart = Object.entries(properties).map(([name, prop]) => {
          const resolved = deref<Json>(api.document, prop) ?? {};
          const isFile =
            resolved.format === 'binary' ||
            resolved.type === 'file' ||
            (resolved.type === 'array' &&
              isObject(resolved.items) &&
              resolved.items.format === 'binary');
          return createMultipartField({
            key: name,
            kind: isFile ? 'file' : 'text',
            value: isFile ? '' : exampleString(values[name]),
            enabled: required.size === 0 || required.has(name),
          });
        });
      } else {
        spec.body.mode = 'urlencoded';
        spec.body.urlencoded = Object.keys(properties).map((name) =>
          createKeyValue({
            key: name,
            value: exampleString(values[name]),
            enabled: required.size === 0 || required.has(name),
          }),
        );
      }
    } else {
      spec.body.mode = 'raw';
      spec.body.rawContentType = type;
      spec.body.raw =
        typeof example === 'string'
          ? example
          : example === undefined || example === null
            ? ''
            : JSON.stringify(example, null, 2);
    }
  }

  // Security
  const requirement = operation.security.find((set) => set.length > 0);
  if (requirement) {
    const schemeName = requirement[0];
    const scheme = api.securitySchemes[schemeName];
    if (scheme?.type === 'http' && scheme.scheme === 'basic') {
      spec.auth = { type: 'basic', username: '{{username}}', password: '{{password}}' };
    } else if (
      (scheme?.type === 'http' && scheme.scheme === 'bearer') ||
      scheme?.type === 'oauth2' ||
      scheme?.type === 'openIdConnect'
    ) {
      spec.auth = { type: 'bearer', token: '{{token}}' };
      if (scheme.type !== 'http')
        notes.push(
          `"${schemeName}" uses ${scheme.type}; obtain an access token separately and set {{token}}.`,
        );
    } else if (scheme?.type === 'apiKey' && scheme.name) {
      const variable = `{{${scheme.name.replace(/[^A-Za-z0-9_]/g, '_')}}}`;
      if (scheme.in === 'header')
        spec.headers.push(createKeyValue({ key: scheme.name, value: variable }));
      else if (scheme.in === 'query') {
        spec.params.push(createKeyValue({ key: scheme.name, value: variable }));
        spec.url = urlWithParams(spec.url, spec.params);
      } else
        notes.push(
          `API key "${scheme.name}" is sent in a cookie, which browsers do not allow scripts to set.`,
        );
    } else if (scheme) {
      notes.push(`Security scheme "${schemeName}" (${scheme.type}) must be configured manually.`);
    }
  }

  const name =
    operation.summary || operation.operationId || `${operation.method} ${operation.path}`;
  return { spec, name, notes };
}

/** Base URL suggestion for {{baseUrl}} (first server). Relative URLs are flagged. */
export function suggestedBaseUrl(api: ApiSpec): { url: string; relative: boolean } | null {
  const server = api.servers[0];
  if (!server?.url) return null;
  const url = server.url.replace(/\/+$/, '');
  return { url, relative: !/^https?:\/\//i.test(url) };
}

export function groupOperationsByTag(
  api: ApiSpec,
): Array<{ tag: string; description?: string; operations: ApiOperation[] }> {
  return api.tags
    .map((tag) => ({
      tag: tag.name,
      description: tag.description,
      operations: api.operations.filter((op) => op.tags.includes(tag.name)),
    }))
    .filter((group) => group.operations.length > 0);
}
