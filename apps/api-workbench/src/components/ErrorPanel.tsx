import { CircleHelp, ShieldAlert, TriangleAlert } from 'lucide-react';
import { formatDuration } from '@shared/lib/format';
import type { RequestTab } from '../state/store';

interface Props {
  error: NonNullable<RequestTab['error']>;
  onHelp: (section: string) => void;
}

/** Explains failed requests — most importantly the browser CORS restriction. */
export function ErrorPanel({ error, onHelp }: Props) {
  if (error.kind === 'cancelled') {
    return (
      <div className="error-panel" data-testid="error-panel">
        <div className="notice notice--info">
          <TriangleAlert aria-hidden />
          <div>
            <p>The request was cancelled.</p>
          </div>
        </div>
      </div>
    );
  }
  const isCors = error.kind === 'cors-or-network';
  return (
    <div className="error-panel" data-testid="error-panel" data-error-kind={error.kind}>
      <div className="notice notice--danger">
        {isCors ? <ShieldAlert aria-hidden /> : <TriangleAlert aria-hidden />}
        <div>
          <p>
            <strong>{error.message}</strong>
          </p>
          {isCors && (
            <>
              <p data-testid="cors-explanation">
                The browser may be blocking this request because the API does not allow cross-origin
                browser requests (CORS). Command-line clients such as curl and desktop applications
                such as Postman are not subject to the same browser CORS restrictions.
              </p>
              <p>
                For security reasons the browser does not tell web pages which of these happened:
              </p>
              <ul>
                <li>
                  <strong>CORS:</strong> the server did not answer with{' '}
                  <code>Access-Control-Allow-Origin</code> for this page's origin (
                  <code>{location.origin}</code>), or rejected the preflight <code>OPTIONS</code>{' '}
                  request.
                </li>
                <li>
                  <strong>Unreachable server:</strong> wrong host or port, server not running, DNS
                  failure, firewall.
                </li>
                <li>
                  <strong>TLS problem:</strong> an untrusted or self-signed certificate. Open the
                  URL directly in a browser tab once to inspect/accept it.
                </li>
              </ul>
              <p>The browser's developer tools console (F12) usually shows the precise reason.</p>
            </>
          )}
          {error.kind === 'mixed-content' && (
            <p>
              This page was loaded over https:// and browsers refuse plain http:// requests from
              secure pages. Serve API Workbench over http:// (e.g. from a local static server) or
              call the API over https://.
            </p>
          )}
          {error.kind === 'timeout' && (
            <p>Increase the timeout on the request's Settings tab if the server is slow.</p>
          )}
          <p className="muted mono error-panel__detail">
            {error.url} · {formatDuration(error.durationMs)} · {error.detail}
          </p>
          <p>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onHelp('cors')}
              data-testid="cors-help"
            >
              <CircleHelp aria-hidden /> Troubleshooting CORS
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
