import { FileUp, X } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from '@shared/react/toasts';
import { pickFiles } from '@shared/lib/download';
import { createKeyValue, createMultipartField } from '../core/factory';
import {
  compactJson,
  describeJsonError,
  formatJson,
  maskVariablesForValidation,
  parseJson,
} from '../core/json';
import type { BodyMode, MultipartField, RequestBody } from '../core/types';
import { multipartFiles } from '../state/store';
import { CodeEditor, type EditorLanguage } from './CodeEditor';
import { KeyValueEditor, VariableInput } from './KeyValueEditor';

const MODES: Array<{ id: BodyMode; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'Raw text' },
  { id: 'urlencoded', label: 'Form URL-encoded' },
  { id: 'multipart', label: 'Multipart form' },
];

const RAW_TYPES = [
  'text/plain',
  'application/xml',
  'text/xml',
  'text/html',
  'text/csv',
  'application/javascript',
  'application/x-ndjson',
];

function rawLanguage(type: string): EditorLanguage {
  if (type.includes('xml')) return 'xml';
  if (type.includes('html')) return 'html';
  if (type.includes('json')) return 'json';
  return 'text';
}

interface BodyEditorProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
  methodAllowsBody: boolean;
}

export function BodyEditor({ body, onChange, methodAllowsBody }: BodyEditorProps) {
  const jsonStatus = useMemo(() => {
    if (body.mode !== 'json' || !body.json.trim()) return null;
    const direct = parseJson(body.json);
    if (direct.ok) return { ok: true, message: 'Valid JSON' };
    const masked = parseJson(maskVariablesForValidation(body.json));
    if (masked.ok) return { ok: true, message: 'Valid JSON (with variables)' };
    return { ok: false, message: describeJsonError(direct.error) };
  }, [body.mode, body.json]);

  const reformat = (fn: (text: string) => string) => {
    try {
      onChange({ ...body, json: fn(body.json) });
    } catch (error) {
      toast(`Cannot format: ${(error as Error).message}`, 'error');
    }
  };

  return (
    <div className="body-editor">
      <div className="body-editor__modes" role="radiogroup" aria-label="Body type">
        {MODES.map((mode) => (
          <label key={mode.id} className="check">
            <input
              type="radio"
              name="body-mode"
              checked={body.mode === mode.id}
              onChange={() => onChange({ ...body, mode: mode.id })}
            />
            {mode.label}
          </label>
        ))}
      </div>
      {!methodAllowsBody && body.mode !== 'none' && (
        <p className="body-editor__hint warning-text">
          GET and HEAD requests cannot carry a body in browsers; it will not be sent.
        </p>
      )}

      {body.mode === 'none' && <p className="muted body-editor__hint">This request has no body.</p>}

      {body.mode === 'json' && (
        <div className="body-editor__code">
          <div className="body-editor__toolbar">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => reformat((t) => formatJson(t))}
              data-testid="json-format"
            >
              Format
            </button>
            <button type="button" className="btn btn--sm" onClick={() => reformat(compactJson)}>
              Compact
            </button>
            {jsonStatus && (
              <span
                className={`badge ${jsonStatus.ok ? 'badge--success' : 'badge--danger'}`}
                data-testid="json-status"
              >
                {jsonStatus.message}
              </span>
            )}
          </div>
          <CodeEditor
            value={body.json}
            onChange={(json) => onChange({ ...body, json })}
            language="json"
            lint
            variables
            placeholder={'{\n  "name": "value"\n}'}
            ariaLabel="JSON body"
            testId="json-body-editor"
          />
        </div>
      )}

      {body.mode === 'raw' && (
        <div className="body-editor__code">
          <div className="body-editor__toolbar">
            <label className="muted" htmlFor="raw-content-type">
              Content-Type
            </label>
            <input
              id="raw-content-type"
              className="input input--mono"
              style={{ width: 240 }}
              list="raw-content-types"
              value={body.rawContentType}
              onChange={(e) => onChange({ ...body, rawContentType: e.target.value })}
            />
            <datalist id="raw-content-types">
              {RAW_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <CodeEditor
            value={body.raw}
            onChange={(raw) => onChange({ ...body, raw })}
            language={rawLanguage(body.rawContentType)}
            variables
            lineWrapping
            ariaLabel="Raw body"
            testId="raw-body-editor"
          />
        </div>
      )}

      {body.mode === 'urlencoded' && (
        <KeyValueEditor
          label="Form field"
          rows={body.urlencoded}
          onChange={(urlencoded) => onChange({ ...body, urlencoded })}
          createRow={(p) => createKeyValue(p)}
          testId="urlencoded-editor"
        />
      )}

      {body.mode === 'multipart' && (
        <KeyValueEditor<MultipartField>
          label="Multipart field"
          rows={body.multipart}
          onChange={(multipart) => onChange({ ...body, multipart })}
          createRow={(p) => createMultipartField(p)}
          allowBulk={false}
          testId="multipart-editor"
          renderExtra={(row, update) => (
            <select
              className="select"
              aria-label="Field type"
              value={row.kind}
              onChange={(e) => update({ kind: e.target.value as MultipartField['kind'] })}
              style={{ width: 80 }}
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>
          )}
          renderValue={(row, update) =>
            row.kind === 'file' ? (
              <FileCell field={row} update={update} />
            ) : (
              <VariableInput
                value={row.value}
                ariaLabel="Multipart value"
                placeholder="Value"
                onChange={(value) => update({ value })}
              />
            )
          }
        />
      )}
    </div>
  );
}

function FileCell({
  field,
  update,
}: {
  field: MultipartField;
  update: (patch: Partial<MultipartField>) => void;
}) {
  const file = multipartFiles.get(field.id);
  return (
    <div className="file-cell">
      <button
        type="button"
        className="btn btn--sm"
        onClick={async () => {
          const [chosen] = await pickFiles();
          if (!chosen) return;
          multipartFiles.set(field.id, chosen);
          update({ fileName: chosen.name, contentType: chosen.type || undefined });
        }}
      >
        <FileUp aria-hidden /> {file ? 'Change…' : 'Choose file…'}
      </button>
      <span
        className={`file-cell__name${!file && field.fileName ? ' warning-text' : ''}`}
        title={!file && field.fileName ? 'Files are not saved; choose it again.' : undefined}
      >
        {file
          ? `${file.name} (${file.size.toLocaleString()} bytes)`
          : field.fileName
            ? `${field.fileName} — re-select`
            : 'No file'}
      </span>
      {file && (
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Clear file"
          onClick={() => {
            multipartFiles.delete(field.id);
            update({ fileName: undefined });
          }}
        >
          <X aria-hidden />
        </button>
      )}
    </div>
  );
}
