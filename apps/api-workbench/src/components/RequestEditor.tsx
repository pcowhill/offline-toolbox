import {
  Ban,
  ChevronDown,
  ClipboardCopy,
  Copy,
  LoaderCircle,
  Save,
  Send,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { copyToClipboard } from '@shared/lib/download';
import { Menu, useMenu } from '@shared/react/Menu';
import { Tabs } from '@shared/react/Tabs';
import { toast } from '@shared/react/toasts';
import { cloneRequestSpec } from '../core/factory';
import { toCurl } from '../core/curl';
import { isForbiddenHeader, prepareRequest } from '../core/request';
import { unsavedSensitiveHeaders } from '../core/sanitize';
import { HTTP_METHODS, type HttpMethod, type KeyValue, type RequestSpec } from '../core/types';
import { paramsFromUrl, urlWithParams } from '../core/url';
import {
  cancelRequest,
  multipartFiles,
  openNewTab,
  saveTabRequest,
  sendRequest,
  updateRequest,
  useVariables,
  type RequestTab,
} from '../state/store';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { KeyValueEditor, VariableInput } from './KeyValueEditor';
import { SaveRequestDialog } from './SaveRequestDialog';
import { CurlImportDialog } from './CurlImportDialog';

type Section = 'params' | 'headers' | 'auth' | 'body' | 'settings';

const COMMON_HEADERS = [
  'Accept',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'If-Match',
  'If-None-Match',
  'Prefer',
  'X-API-Key',
  'X-Request-ID',
  'X-Correlation-ID',
];

const countEnabled = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key.trim()).length;

export function RequestEditor({ tab }: { tab: RequestTab }) {
  const [section, setSection] = useState<Section>('params');
  const [saveOpen, setSaveOpen] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);
  const moreMenu = useMenu();
  const variables = useVariables();
  const request = tab.request;
  const update = (fn: (r: RequestSpec) => RequestSpec) => updateRequest(tab.id, fn);

  const preview = useMemo(
    () => prepareRequest(request, variables, { files: multipartFiles }),
    [request, variables],
  );

  const onSave = () => {
    if (tab.savedRequestId) saveTabRequest(tab.id);
    else setSaveOpen(true);
  };

  const copyCurl = async () => {
    if (!preview.request) {
      toast(preview.errors.join('\n'), 'error');
      return;
    }
    const ok = await copyToClipboard(toCurl(preview.request));
    toast(
      ok ? 'curl command copied to the clipboard' : 'Could not access the clipboard',
      ok ? 'success' : 'error',
    );
  };

  const methodAllowsBody = request.method !== 'GET' && request.method !== 'HEAD';

  return (
    <section className="request-editor" aria-label="Request">
      <form
        className="url-bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (tab.sending) cancelRequest(tab.id);
          else void sendRequest(tab.id);
        }}
      >
        <select
          className={`select url-bar__method method-select method-select--${request.method.toLowerCase()}`}
          value={request.method}
          aria-label="HTTP method"
          data-testid="method-select"
          onChange={(e) => update((r) => ({ ...r, method: e.target.value as HttpMethod }))}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <VariableInput
          className="url-bar__url"
          value={request.url}
          placeholder="https://api.example.com/resource  or  {{baseUrl}}/resource"
          ariaLabel="Request URL"
          testId="url-input"
          onChange={(url) => update((r) => ({ ...r, url, params: paramsFromUrl(url, r.params) }))}
        />
        {tab.sending ? (
          <button
            type="submit"
            className="btn btn--lg"
            data-testid="cancel-button"
            title="Cancel request"
          >
            <Ban aria-hidden /> Cancel
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn--primary btn--lg"
            data-testid="send-button"
            title="Send (Ctrl+Enter)"
          >
            <Send aria-hidden /> Send
          </button>
        )}
        <div className="btn-group">
          <button
            type="button"
            className="btn btn--lg"
            onClick={onSave}
            title="Save (Ctrl+S)"
            data-testid="save-button"
          >
            <Save aria-hidden /> Save{tab.dirty && tab.savedRequestId ? ' •' : ''}
          </button>
          <button
            type="button"
            className="btn btn--lg btn--icon"
            aria-label="More request actions"
            data-testid="request-more"
            onClick={(e) => moreMenu.openBelow(e.currentTarget)}
          >
            <ChevronDown aria-hidden />
          </button>
        </div>
      </form>
      {moreMenu.menu && (
        <Menu
          x={moreMenu.menu.x}
          y={moreMenu.menu.y}
          onClose={moreMenu.close}
          items={[
            {
              label: 'Save as…',
              icon: <Save />,
              onSelect: () => setSaveOpen(true),
              testId: 'save-as',
            },
            {
              label: 'Duplicate in new tab',
              icon: <Copy />,
              onSelect: () => openNewTab(cloneRequestSpec(request), `${tab.title} (copy)`),
            },
            'separator',
            {
              label: 'Copy as curl',
              icon: <ClipboardCopy />,
              onSelect: () => void copyCurl(),
              testId: 'copy-curl',
            },
            {
              label: 'Import from curl…',
              icon: <Terminal />,
              onSelect: () => setCurlOpen(true),
              testId: 'import-curl',
            },
          ]}
        />
      )}

      <div className="url-preview" data-testid="url-preview">
        {preview.request ? (
          <span
            className="mono url-preview__url"
            title="Final URL after variable substitution and encoding"
          >
            {preview.request.url}
          </span>
        ) : request.url.trim() ? (
          <span className="danger-text">{preview.errors[0]}</span>
        ) : (
          <span className="muted">
            Tip: press Ctrl+Enter to send. Use {'{{variables}}'} from the selected environment.
          </span>
        )}
      </div>
      {preview.warnings.length > 0 && (
        <ul className="request-warnings" data-testid="request-warnings">
          {preview.warnings.map((w) => (
            <li key={w}>
              <TriangleAlert aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}

      <Tabs<Section>
        label="Request sections"
        value={section}
        onChange={setSection}
        items={[
          {
            id: 'params',
            label: 'Params',
            count: countEnabled(request.params),
            testId: 'tab-params',
          },
          {
            id: 'headers',
            label: 'Headers',
            count: countEnabled(request.headers),
            testId: 'tab-headers',
          },
          {
            id: 'auth',
            label: request.auth.type === 'none' ? 'Auth' : 'Auth •',
            testId: 'tab-auth',
          },
          {
            id: 'body',
            label: request.body.mode === 'none' ? 'Body' : 'Body •',
            testId: 'tab-body',
          },
          { id: 'settings', label: 'Settings', testId: 'tab-settings' },
        ]}
        trailing={
          tab.sending ? <LoaderCircle className="spinner" aria-label="Sending" /> : undefined
        }
      />
      <div className="request-editor__section">
        {section === 'params' && (
          <KeyValueEditor
            label="Query parameter"
            rows={request.params}
            testId="params-editor"
            onChange={(params) =>
              update((r) => ({ ...r, params, url: urlWithParams(r.url, params) }))
            }
          />
        )}
        {section === 'headers' && (
          <KeyValueEditor
            label="Header"
            rows={request.headers}
            testId="headers-editor"
            suggestions={COMMON_HEADERS}
            rowWarning={(row) =>
              row.key && isForbiddenHeader(row.key)
                ? 'Browsers do not let web pages set this header.'
                : undefined
            }
            onChange={(headers) => update((r) => ({ ...r, headers }))}
          />
        )}
        {section === 'headers' && unsavedSensitiveHeaders(request).length > 0 && (
          <p className="muted request-note" data-testid="sensitive-headers-note">
            Values of credential headers (
            {unsavedSensitiveHeaders(request)
              .map((h) => h.key)
              .join(', ')}
            ) are not saved with the request, in history or in exports. Use a {'{{variable}}'}{' '}
            instead, or allow saving them on the Settings tab.
          </p>
        )}
        {section === 'auth' && (
          <AuthEditor auth={request.auth} onChange={(auth) => update((r) => ({ ...r, auth }))} />
        )}
        {section === 'body' && (
          <BodyEditor
            body={request.body}
            methodAllowsBody={methodAllowsBody}
            onChange={(body) => update((r) => ({ ...r, body }))}
          />
        )}
        {section === 'settings' && <SettingsEditor request={request} onChange={update} />}
      </div>

      <SaveRequestDialog open={saveOpen} onClose={() => setSaveOpen(false)} tab={tab} />
      <CurlImportDialog
        open={curlOpen}
        onClose={() => setCurlOpen(false)}
        onImport={(spec) => update(() => spec)}
      />
    </section>
  );
}

function SettingsEditor({
  request,
  onChange,
}: {
  request: RequestSpec;
  onChange: (fn: (r: RequestSpec) => RequestSpec) => void;
}) {
  const settings = request.settings;
  const set = (patch: Partial<RequestSpec['settings']>) =>
    onChange((r) => ({ ...r, settings: { ...r.settings, ...patch } }));
  return (
    <div className="settings-editor">
      <div className="field">
        <label htmlFor="timeout">Timeout (seconds, 0 = none)</label>
        <input
          id="timeout"
          className="input"
          type="number"
          min={0}
          value={settings.timeoutMs / 1000}
          onChange={(e) => set({ timeoutMs: Math.max(0, Number(e.target.value) || 0) * 1000 })}
          style={{ width: 120 }}
        />
      </div>
      <div className="field">
        <label htmlFor="credentials">Cookies &amp; browser credentials</label>
        <select
          id="credentials"
          className="select"
          value={settings.credentials}
          onChange={(e) =>
            set({ credentials: e.target.value as RequestSpec['settings']['credentials'] })
          }
          style={{ maxWidth: 360 }}
        >
          <option value="omit">Never send (default)</option>
          <option value="same-origin">Same origin only</option>
          <option value="include">Include (server must allow credentials via CORS)</option>
        </select>
        <span className="field__hint">
          Controls whether the browser attaches its own cookies/HTTP-auth for the target site.
        </span>
      </div>
      <div className="field">
        <label htmlFor="redirect">Redirects</label>
        <select
          id="redirect"
          className="select"
          value={settings.redirect}
          onChange={(e) => set({ redirect: e.target.value as RequestSpec['settings']['redirect'] })}
          style={{ maxWidth: 360 }}
        >
          <option value="follow">Follow automatically</option>
          <option value="error">Treat a redirect as an error</option>
        </select>
        <span className="field__hint">
          Browsers do not let web pages inspect intermediate redirect responses.
        </span>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.saveSensitiveHeaders ?? false}
          onChange={(e) => set({ saveSensitiveHeaders: e.target.checked })}
          data-testid="save-sensitive-headers"
        />
        Save values of credential headers (Authorization, Cookie, API keys …) with this request —
        stored unencrypted
      </label>
    </div>
  );
}
