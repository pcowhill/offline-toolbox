import { FilePlus2, Info, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@shared/react/EmptyState';
import { toast } from '@shared/react/toasts';
import {
  describeSchema,
  exampleFromSchema,
  requestFromOperation,
  suggestedBaseUrl,
  type ApiMediaType,
  type ApiSpec,
  type Schema,
} from '../core/openapi';
import { createVariable } from '../core/factory';
import {
  activeEnvironment,
  createNewEnvironment,
  openNewTab,
  saveEnvironment,
  setActiveEnvironment,
  useStore,
  useVariables,
  type OperationTab,
} from '../state/store';
import { MethodBadge } from './MethodBadge';

function SchemaTable({
  document,
  schema,
}: {
  document: Record<string, unknown>;
  schema: Schema | undefined;
}) {
  const rows = useMemo(() => (schema ? describeSchema(document, schema) : []), [document, schema]);
  if (!schema) return null;
  if (!rows.length) {
    const example = exampleFromSchema(document, schema);
    return <pre className="schema-example">{JSON.stringify(example, null, 2)}</pre>;
  }
  return (
    <table className="schema-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.path}-${i}`}>
            <td className="mono" style={{ paddingLeft: 8 + row.depth * 14 }}>
              {row.path.split('.').pop()}
              {row.required && (
                <span className="required" title="required">
                  *
                </span>
              )}
            </td>
            <td className="mono muted">{row.type}</td>
            <td>{row.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MediaBlock({
  document,
  media,
}: {
  document: Record<string, unknown>;
  media: ApiMediaType;
}) {
  const [showExample, setShowExample] = useState(false);
  return (
    <div className="media-block">
      <div className="media-block__head">
        <code>{media.contentType}</code>
        {media.schema && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setShowExample(!showExample)}
          >
            {showExample ? 'Show schema' : 'Show example'}
          </button>
        )}
      </div>
      {showExample || !media.schema ? (
        <pre className="schema-example">
          {JSON.stringify(media.example ?? exampleFromSchema(document, media.schema), null, 2) ??
            '(no example)'}
        </pre>
      ) : (
        <SchemaTable document={document} schema={media.schema} />
      )}
    </div>
  );
}

export function OperationView({ tab }: { tab: OperationTab }) {
  const spec = useStore((s) => s.specs.find((sp) => sp.id === tab.specId));
  const operation = spec?.operations.find((op) => op.id === tab.operationId);
  const variables = useVariables();
  if (!spec || !operation) {
    return (
      <EmptyState title="Operation not found">The specification may have been removed.</EmptyState>
    );
  }
  const base = suggestedBaseUrl(spec);
  const hasBaseUrl = variables.has('baseUrl');

  const createRequest = () => {
    const { spec: request, name, notes } = requestFromOperation(spec, operation);
    openNewTab(request, name);
    if (notes.length) toast(notes.join('\n'), 'info', 8000);
  };

  return (
    <div className="operation-view" data-testid="operation-view">
      <header className="operation-view__header">
        <div className="operation-view__title">
          <MethodBadge method={operation.method} />
          <code className="operation-view__path">{operation.path}</code>
          {operation.deprecated && <span className="badge badge--warning">deprecated</span>}
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={createRequest}
          data-testid="create-request"
        >
          <FilePlus2 aria-hidden /> Create request
        </button>
      </header>
      {operation.summary && <h2 className="operation-view__summary">{operation.summary}</h2>}
      <p className="muted operation-view__meta">
        {spec.title} {spec.version && `v${spec.version}`} ·{' '}
        {operation.operationId ?? 'no operationId'} · tags: {operation.tags.join(', ')}
      </p>
      {operation.description && (
        <p className="operation-view__description">{operation.description}</p>
      )}

      {!hasBaseUrl && base && <BaseUrlNotice spec={spec} url={base.url} relative={base.relative} />}

      {operation.security.length > 0 && (
        <section>
          <h3>Authentication</h3>
          <ul className="plain-list">
            {operation.security.map((set, i) => (
              <li key={i}>
                {set.map((name) => {
                  const scheme = spec.securitySchemes[name];
                  return (
                    <span key={name} className="badge" style={{ marginRight: 6 }}>
                      {name}:{' '}
                      {scheme
                        ? `${scheme.type}${scheme.scheme ? ` ${scheme.scheme}` : ''}${scheme.in ? ` in ${scheme.in} "${scheme.name}"` : ''}`
                        : 'unknown scheme'}
                    </span>
                  );
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Parameters</h3>
        {operation.parameters.length === 0 ? (
          <p className="muted">No parameters.</p>
        ) : (
          <table className="schema-table" data-testid="operation-parameters">
            <thead>
              <tr>
                <th>Name</th>
                <th>In</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {operation.parameters.map((p) => (
                <tr key={`${p.in}:${p.name}`}>
                  <td className="mono">
                    {p.name}
                    {p.required && (
                      <span className="required" title="required">
                        *
                      </span>
                    )}
                  </td>
                  <td>{p.in}</td>
                  <td className="mono muted">
                    {String(
                      p.schema?.type ??
                        (p.schema?.$ref ? String(p.schema.$ref).split('/').pop() : ''),
                    )}
                    {p.schema?.format ? ` (${String(p.schema.format)})` : ''}
                  </td>
                  <td>
                    {p.description}
                    {p.example !== undefined && (
                      <span className="muted">
                        {' '}
                        Example: <code>{JSON.stringify(p.example)}</code>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {operation.requestBody && (
        <section>
          <h3>
            Request body {operation.requestBody.required && <span className="badge">required</span>}
          </h3>
          {operation.requestBody.description && <p>{operation.requestBody.description}</p>}
          {operation.requestBody.content.map((media) => (
            <MediaBlock key={media.contentType} document={spec.document} media={media} />
          ))}
        </section>
      )}

      <section>
        <h3>Responses</h3>
        {operation.responses.map((response) => (
          <details
            key={response.status}
            className="response-doc"
            open={response.status.startsWith('2')}
          >
            <summary>
              <span className={`status-chip status-chip--${response.status[0]}xx`}>
                {response.status}
              </span>{' '}
              {response.description}
            </summary>
            {response.content.length === 0 ? (
              <p className="muted">No body.</p>
            ) : (
              response.content.map((media) => (
                <MediaBlock key={media.contentType} document={spec.document} media={media} />
              ))
            )}
          </details>
        ))}
      </section>
    </div>
  );
}

function BaseUrlNotice({ spec, url, relative }: { spec: ApiSpec; url: string; relative: boolean }) {
  const apply = () => {
    const env = activeEnvironment() ?? createNewEnvironment(spec.title);
    const existing = env.variables.find((v) => v.key === 'baseUrl');
    const variables = existing
      ? env.variables.map((v) =>
          v.key === 'baseUrl' ? { ...v, value: url, enabled: true, persist: true } : v,
        )
      : [...env.variables, createVariable({ key: 'baseUrl', value: url })];
    saveEnvironment({ ...env, variables }, {});
    setActiveEnvironment(env.id);
    toast(`Set {{baseUrl}} = ${url} in environment "${env.name}"`, 'success');
  };
  return (
    <div className="notice notice--info" style={{ margin: '12px 0' }}>
      <Info aria-hidden />
      <div>
        <p>
          Requests created from this specification use <code>{'{{baseUrl}}'}</code>. The active
          environment has no
          <code> baseUrl</code> yet. The specification's first server is <code>{url}</code>
          {relative && ' (a relative URL — prefix it with the host that serves the API)'}.
        </p>
        <p>
          <button
            type="button"
            className="btn btn--sm"
            onClick={apply}
            data-testid="apply-base-url"
          >
            <Save aria-hidden /> Set baseUrl in{' '}
            {activeEnvironment() ? 'active environment' : 'a new environment'}
          </button>
        </p>
      </div>
    </div>
  );
}
