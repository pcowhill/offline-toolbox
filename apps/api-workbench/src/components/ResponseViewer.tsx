import { openSearchPanel } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { ArrowRight, ClipboardCopy, Download, LoaderCircle, Search, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { copyToClipboard, downloadBytes } from '@shared/lib/download';
import { formatBytes, formatDuration } from '@shared/lib/format';
import { EmptyState } from '@shared/react/EmptyState';
import { Tabs } from '@shared/react/Tabs';
import { toast } from '@shared/react/toasts';
import { parseJsonTree, prettyJson, type JsonNode } from '../core/json';
import {
  decodeText,
  detectBodyKind,
  headerValue,
  parseContentType,
  statusCategory,
  suggestFileName,
  type BodyKind,
} from '../core/response';
import type { ResponseData } from '../core/transport';
import { cancelRequest, type RequestTab } from '../state/store';
import { CodeEditor, type EditorLanguage } from './CodeEditor';
import { ErrorPanel } from './ErrorPanel';
import { JsonTree } from './JsonTree';

type Section = 'body' | 'headers' | 'request';
type BodyView = 'pretty' | 'raw' | 'tree' | 'preview';

const LANGUAGE: Record<BodyKind, EditorLanguage> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  text: 'text',
  image: 'text',
  binary: 'text',
  empty: 'text',
};

/** XML/HTML pretty printer good enough for reading API responses (no reflow of text nodes). */
function prettyMarkup(text: string): string {
  if (text.length > 2_000_000 || /\n\s+</.test(text.slice(0, 2000))) return text;
  let depth = 0;
  return text
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^<\/[^>]+>$/.test(trimmed)) depth = Math.max(0, depth - 1);
      const out = '  '.repeat(depth) + trimmed;
      if (
        /^<[^!?/][^>]*[^/]>$/.test(trimmed) &&
        !/^<(br|hr|img|input|meta|link)\b/i.test(trimmed) &&
        !trimmed.includes('</')
      )
        depth++;
      return out;
    })
    .join('\n');
}

function hexDump(bytes: Uint8Array, limit = 1024): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, limit); offset += 16) {
    const chunk = bytes.subarray(offset, Math.min(offset + 16, bytes.length));
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, (b) =>
      b >= 32 && b < 127 ? String.fromCharCode(b) : '.',
    ).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > limit) lines.push(`… ${formatBytes(bytes.length - limit)} more`);
  return lines.join('\n');
}

const PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

export function ResponseViewer({
  tab,
  onHelp,
}: {
  tab: RequestTab;
  onHelp: (section: string) => void;
}) {
  if (tab.sending) {
    return (
      <div className="response response--empty" data-testid="response-loading">
        <EmptyState icon={LoaderCircle} title="Sending request…">
          <button type="button" className="btn" onClick={() => cancelRequest(tab.id)}>
            Cancel
          </button>
        </EmptyState>
      </div>
    );
  }
  if (tab.error) {
    return (
      <div className="response">
        <ErrorPanel error={tab.error} onHelp={onHelp} />
      </div>
    );
  }
  if (!tab.response) {
    return (
      <div className="response response--empty">
        <EmptyState icon={Send} title="No response yet" testId="response-empty">
          Enter a URL and press <kbd>Send</kbd> or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>. The response
          status, timing, headers and body appear here.
        </EmptyState>
      </div>
    );
  }
  return (
    <ResponseContent
      key={`${tab.id}:${tab.response.durationMs}`}
      tab={tab}
      response={tab.response}
    />
  );
}

function ResponseContent({ tab, response }: { tab: RequestTab; response: ResponseData }) {
  const contentTypeHeader = headerValue(response.headers, 'content-type');
  const { charset, mime } = parseContentType(contentTypeHeader);
  const kind = useMemo(
    () => detectBodyKind(contentTypeHeader, response.body),
    [contentTypeHeader, response.body],
  );
  const isText = kind === 'json' || kind === 'xml' || kind === 'html' || kind === 'text';
  const rawText = useMemo(
    () => (isText ? decodeText(response.body, charset) : ''),
    [isText, response.body, charset],
  );
  const jsonTree = useMemo<JsonNode | null>(() => {
    if (kind !== 'json') return null;
    try {
      return parseJsonTree(rawText);
    } catch {
      return null;
    }
  }, [kind, rawText]);
  const pretty = useMemo(() => {
    if (kind === 'json') {
      try {
        return prettyJson(rawText);
      } catch {
        return rawText;
      }
    }
    if (kind === 'xml' || kind === 'html') return prettyMarkup(rawText);
    return rawText;
  }, [kind, rawText]);

  const [section, setSection] = useState<Section>('body');
  const [view, setView] = useState<BodyView>(kind === 'image' ? 'preview' : 'pretty');
  const [query, setQuery] = useState('');
  const [wrap, setWrap] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const imageUrl = useMemo(
    () =>
      kind === 'image'
        ? URL.createObjectURL(new Blob([response.body as BlobPart], { type: mime || 'image/*' }))
        : null,
    [kind, response.body, mime],
  );
  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );

  const category = statusCategory(response.status);
  const views: Array<{ id: BodyView; label: string }> = [];
  if (isText) views.push({ id: 'pretty', label: 'Pretty' }, { id: 'raw', label: 'Raw' });
  if (jsonTree) views.push({ id: 'tree', label: 'Tree' });
  if (kind === 'html' || kind === 'image') views.push({ id: 'preview', label: 'Preview' });
  const activeView = views.some((v) => v.id === view) ? view : (views[0]?.id ?? 'raw');

  const download = () => {
    downloadBytes(
      response.body,
      suggestFileName(response.url, response.headers, kind),
      mime || 'application/octet-stream',
    );
  };
  const copy = async () => {
    const text = activeView === 'pretty' ? pretty : rawText;
    const ok = await copyToClipboard(text);
    toast(ok ? 'Response copied' : 'Could not access the clipboard', ok ? 'success' : 'error');
  };
  const openSearch = () => {
    const editor = bodyRef.current?.querySelector<HTMLElement>('.cm-editor');
    const cm = editor && EditorView.findFromDOM(editor);
    if (cm) {
      openSearchPanel(cm);
      return;
    }
    bodyRef.current?.querySelector<HTMLInputElement>('.response__search')?.focus();
  };

  return (
    <div className="response" data-testid="response">
      <div className="response__status">
        <span className={`status-badge status-badge--${category}`} data-testid="response-status">
          {response.status} {response.statusText}
        </span>
        <span
          className="response__metric"
          data-testid="response-time"
          title="Time until the full body was received"
        >
          {formatDuration(response.durationMs)}
        </span>
        <span
          className="response__metric"
          data-testid="response-size"
          title="Body bytes plus approximate header bytes"
        >
          {formatBytes(response.sizeBytes)}
        </span>
        {response.redirected && (
          <span
            className="response__redirect"
            data-testid="response-redirect"
            title="The request was redirected"
          >
            <ArrowRight aria-hidden /> <span className="mono">{response.url}</span>
          </span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={openSearch}
          disabled={!isText}
          title="Search (Ctrl+F in the body)"
          data-testid="response-search"
        >
          <Search aria-hidden /> Search
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={copy}
          disabled={!isText}
          data-testid="response-copy"
        >
          <ClipboardCopy aria-hidden /> Copy
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={download}
          data-testid="response-download"
        >
          <Download aria-hidden /> Save
        </button>
      </div>
      <Tabs<Section>
        label="Response sections"
        value={section}
        onChange={setSection}
        items={[
          { id: 'body', label: 'Body', testId: 'response-tab-body' },
          {
            id: 'headers',
            label: 'Headers',
            count: response.headers.length,
            testId: 'response-tab-headers',
          },
          { id: 'request', label: 'Request sent', testId: 'response-tab-request' },
        ]}
        trailing={
          section === 'body' && views.length > 1 ? (
            <div className="btn-group" role="group" aria-label="Body view">
              {views.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="btn btn--sm"
                  aria-pressed={activeView === v.id}
                  onClick={() => setView(v.id)}
                  data-testid={`view-${v.id}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      <div className="response__body" ref={bodyRef}>
        {section === 'body' && (
          <>
            {kind === 'empty' && (
              <EmptyState title="Empty body">
                The response has no body ({mime || 'no content type'}).
              </EmptyState>
            )}
            {isText && (activeView === 'pretty' || activeView === 'raw') && (
              <div className="response__code">
                <div className="response__code-toolbar">
                  <span className="muted">
                    {mime || 'unknown type'}
                    {charset ? ` · ${charset}` : ''}
                  </span>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={wrap}
                      onChange={(e) => setWrap(e.target.checked)}
                    />{' '}
                    Wrap lines
                  </label>
                </div>
                <CodeEditor
                  value={activeView === 'pretty' ? pretty : rawText}
                  language={activeView === 'pretty' ? LANGUAGE[kind] : 'text'}
                  readOnly
                  lineWrapping={wrap}
                  ariaLabel="Response body"
                  testId="response-body"
                />
              </div>
            )}
            {activeView === 'tree' && jsonTree && (
              <div className="response__tree">
                <input
                  className="input response__search"
                  placeholder="Filter keys and values…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search JSON"
                  data-testid="tree-search"
                />
                <JsonTree root={jsonTree} query={query} />
              </div>
            )}
            {activeView === 'preview' && kind === 'image' && imageUrl && (
              <div className="response__image">
                <img src={imageUrl} alt="Response body" data-testid="response-image" />
              </div>
            )}
            {activeView === 'preview' && kind === 'html' && (
              <div className="response__html">
                <p className="muted">
                  Sandboxed preview: scripts, forms and external resources are blocked.
                </p>
                <iframe
                  title="HTML preview"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">${rawText}`}
                />
              </div>
            )}
            {kind === 'binary' && (
              <div className="response__binary">
                <EmptyState
                  icon={Download}
                  title={`Binary content (${formatBytes(response.body.length)})`}
                >
                  {mime || 'Unknown type'} — use <strong>Save</strong> to download it.
                </EmptyState>
                <pre className="response__hex">{hexDump(response.body)}</pre>
              </div>
            )}
          </>
        )}
        {section === 'headers' && (
          <>
            <HeaderTable headers={response.headers} testId="response-headers" />
            {response.type === 'cors' && (
              <p className="muted" style={{ padding: '0 12px' }}>
                For cross-origin responses browsers only expose basic headers plus those the server
                lists in <code>Access-Control-Expose-Headers</code>.
              </p>
            )}
          </>
        )}
        {section === 'request' && tab.sent && (
          <div className="sent-request">
            <p className="mono sent-request__line">
              <strong>{tab.sent.method}</strong> {tab.sent.url}
            </p>
            <HeaderTable headers={tab.sent.headers} testId="sent-headers" />
            <p className="muted">
              The browser adds further headers itself (User-Agent, Origin, Accept-Encoding …) and
              may strip forbidden ones.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function HeaderTable({ headers, testId }: { headers: Array<[string, string]>; testId: string }) {
  if (!headers.length)
    return (
      <p className="muted" style={{ padding: 12 }}>
        No headers.
      </p>
    );
  return (
    <table className="header-table" data-testid={testId}>
      <tbody>
        {headers.map(([name, value], i) => (
          <tr key={`${name}-${i}`}>
            <th scope="row">{name}</th>
            <td className="mono">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
