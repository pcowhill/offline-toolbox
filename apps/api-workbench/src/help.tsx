import type { HelpSection } from '@shared/react/HelpDialog';

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    content: (
      <>
        <p>
          API Workbench is a browser-based HTTP client for everyday REST work — an alternative to
          typing curl commands. It is a static web page: there is no server component and nothing is
          installed.
        </p>
        <ol>
          <li>
            Pick a method and enter a URL (the scheme defaults to <code>http://</code>).
          </li>
          <li>
            Add query parameters, headers, authentication and a body using the tabs below the URL.
          </li>
          <li>
            Press <strong>Send</strong> (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>). Status, time, size,
            headers and body appear below.
          </li>
          <li>
            Save the request into a collection with <kbd>Ctrl</kbd>+<kbd>S</kbd>.
          </li>
        </ol>
        <p>
          The query string in the URL bar and the <em>Params</em> table stay in sync. Values are
          shown readable in the URL bar and percent-encoded when sent; the line below the URL shows
          exactly what will be requested.
        </p>
        <p>
          Coming from the terminal? Use the ▾ menu next to Save: <em>Import from curl…</em> turns a
          pasted curl command into a request, and <em>Copy as curl</em> does the reverse.
        </p>
      </>
    ),
  },
  {
    id: 'cors',
    title: 'CORS & failed requests',
    content: (
      <>
        <p>
          Because API Workbench runs inside a web browser, the browser's{' '}
          <strong>same-origin policy</strong> applies. When the page (for example{' '}
          <code>http://tools.intranet:8080</code>) calls an API on another origin, the browser only
          lets the page read the response if the API answers with suitable{' '}
          <strong>CORS (Cross-Origin Resource Sharing)</strong> headers.
        </p>
        <p>
          <strong>
            The browser may be blocking a request because the API does not allow cross-origin
            browser requests. Command-line clients such as curl and desktop applications such as
            Postman are not subject to the same browser CORS restrictions.
          </strong>
        </p>
        <h4>What the API must send</h4>
        <ul>
          <li>
            <code>Access-Control-Allow-Origin: &lt;the origin serving API Workbench&gt;</code> (or{' '}
            <code>*</code>).
          </li>
          <li>
            For "non-simple" requests (custom headers such as <code>Authorization</code>, JSON
            bodies, PUT/PATCH/DELETE) the browser first sends an <code>OPTIONS</code> preflight; the
            API must answer it with <code>Access-Control-Allow-Methods</code> and{' '}
            <code>Access-Control-Allow-Headers</code>.
          </li>
          <li>
            To read custom response headers: <code>Access-Control-Expose-Headers</code>.
          </li>
          <li>
            For cookies (Settings → "Include"): <code>Access-Control-Allow-Credentials: true</code>{' '}
            and a specific origin.
          </li>
        </ul>
        <h4>Telling CORS from other failures</h4>
        <p>
          Browsers deliberately report CORS errors, refused connections, DNS failures and
          certificate errors identically to the page. Open the browser developer tools (
          <kbd>F12</kbd>) → Console/Network: the exact reason is shown there.
        </p>
        <h4>Options</h4>
        <ul>
          <li>
            Enable CORS on the API (often a configuration switch) for the origin where you host the
            toolbox.
          </li>
          <li>
            Host the toolbox on the same origin as the API (same scheme, host and port) — then CORS
            does not apply.
          </li>
          <li>
            Self-signed HTTPS certificates: open the API URL in a normal tab once and accept the
            certificate.
          </li>
          <li>
            Pages served over <code>https://</code> (like GitHub Pages) cannot call plain{' '}
            <code>http://</code> APIs (mixed content). Serve the toolbox over http:// on your
            network for http:// APIs.
          </li>
        </ul>
        <p>
          API Workbench intentionally uses no insecure workarounds (no public CORS proxies, no
          disabled browser security). The request layer is designed so an optional local proxy could
          be added in a future version.
        </p>
        <h4>Forbidden headers</h4>
        <p>
          Browsers do not allow pages to set some headers (for example <code>Host</code>,{' '}
          <code>Cookie</code>, <code>Origin</code>, <code>Content-Length</code>). They are marked in
          the Headers table and ignored when sending.
        </p>
      </>
    ),
  },
  {
    id: 'collections',
    title: 'Collections',
    content: (
      <>
        <p>
          Collections group saved requests, optionally in folders. They are stored locally in this
          browser (IndexedDB) for this site's address — a different browser, profile or URL starts
          empty.
        </p>
        <ul>
          <li>
            <strong>Save</strong> (<kbd>Ctrl</kbd>+<kbd>S</kbd>) updates the saved request linked to
            the tab; the first save asks for a name and collection.
          </li>
          <li>
            Right-click (or use the ⋯ button on) a collection, folder or request to rename,
            duplicate, move or delete it.
          </li>
          <li>
            <strong>Export</strong> writes collections and environments to a JSON file;{' '}
            <strong>Import</strong> reads it on another computer. Imports never overwrite — they add
            copies.
          </li>
          <li>Postman v2.0/v2.1 collection files can also be imported (scripts are ignored).</li>
        </ul>
        <p>
          Credentials typed directly into the Auth tab are <em>not</em> saved unless you tick "Save
          credentials with this request". The same applies to values of credential headers such as{' '}
          <code>Authorization</code>, <code>Cookie</code> or <code>X-API-Key</code> (allow saving
          them on the request's Settings tab if you want). Prefer variables such as{' '}
          <code>{'{{token}}'}</code>.
        </p>
      </>
    ),
  },
  {
    id: 'variables',
    title: 'Environments & variables',
    content: (
      <>
        <p>
          An environment is a named set of variables, e.g. <em>Development</em>, <em>Testing</em>{' '}
          and <em>Local</em> each defining <code>baseUrl</code>. Choose the active environment in
          the header; reference variables as <code>{'{{baseUrl}}/api/users'}</code> in the URL,
          parameters, headers, auth fields and bodies.
        </p>
        <ul>
          <li>
            Recognised variables are highlighted;{' '}
            <span className="var-token var-token--unresolved">{'{{unresolved}}'}</span> ones are
            shown in red and listed above the request.
          </li>
          <li>Variables may reference other variables.</li>
          <li>
            Built-in dynamic values: <code>{'{{$timestamp}}'}</code>,{' '}
            <code>{'{{$isoTimestamp}}'}</code>, <code>{'{{$randomUUID}}'}</code>,{' '}
            <code>{'{{$randomInt}}'}</code>.
          </li>
        </ul>
        <h4>Sensitive values</h4>
        <p>
          Each variable has two switches: <strong>Secret</strong> masks the value on screen, and{' '}
          <strong>Save value</strong> decides whether the value is written to browser storage.
          Variables whose name looks sensitive (token, password, secret, key …) default to secret
          and <em>not saved</em>: their value lives in memory until the page is closed and is never
          exported. Tick "Save value" only if you accept the value being stored.
        </p>
        <p>
          <strong>Local browser storage is not a secrets vault.</strong> Anything saved is stored
          unencrypted in your browser profile and can be read by anyone with access to it.
        </p>
      </>
    ),
  },
  {
    id: 'openapi',
    title: 'OpenAPI import',
    content: (
      <>
        <p>
          Import a local OpenAPI 3.x or Swagger 2.0 specification (JSON or YAML) from the{' '}
          <em>API specs</em> sidebar tab. Endpoints are grouped by tag; selecting one shows its
          parameters, request body schema, responses and authentication.
        </p>
        <p>
          <strong>Create request</strong> turns the operation into an editable request: the URL
          becomes <code>{'{{baseUrl}}/path'}</code>, path parameters become variables (
          <code>{'{{id}}'}</code>), query and header parameters are pre-filled (optional ones
          disabled), a JSON example body is generated from the schema, and bearer/basic/ API-key
          security is mapped to the Auth tab or a header using variables.
        </p>
        <p>
          Specifications are treated purely as data: nothing in them is executed and external{' '}
          <code>$ref</code> URLs are never fetched (only references within the file are resolved).
          Imported specifications are kept in this browser until you remove them.
        </p>
      </>
    ),
  },
  {
    id: 'history',
    title: 'History',
    content: (
      <p>
        Every sent request is recorded with method, URL (with variables unresolved), time and
        status. The newest 200 entries are kept. Click an entry to reopen it in a new tab; delete
        single entries with ×, or clear all. Response bodies and unsaved credentials are not stored
        in history.
      </p>
    ),
  },
  {
    id: 'keyboard',
    title: 'Keyboard shortcuts',
    content: (
      <ul>
        <li>
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> — send the request
        </li>
        <li>
          <kbd>Esc</kbd> — cancel a running request
        </li>
        <li>
          <kbd>Ctrl</kbd>+<kbd>S</kbd> — save
        </li>
        <li>
          <kbd>Alt</kbd>+<kbd>T</kbd> — new tab, <kbd>Alt</kbd>+<kbd>W</kbd> — close tab
        </li>
        <li>
          <kbd>Ctrl</kbd>+<kbd>F</kbd> inside an editor or the response body — search
        </li>
        <li>
          <kbd>F1</kbd> — this help
        </li>
        <li>
          In the collection tree: <kbd>Enter</kbd> open, <kbd>F2</kbd> rename, <kbd>Delete</kbd>{' '}
          delete
        </li>
      </ul>
    ),
  },
  {
    id: 'privacy',
    title: 'Privacy',
    content: (
      <>
        <p>
          API Workbench never sends your URLs, headers, credentials, bodies or responses to any
          service run by this project — there is no such service. There is no analytics or
          telemetry.
        </p>
        <p>
          The only network traffic is the request you explicitly send to the URL you entered. The
          page's Content-Security-Policy prevents it from loading code, fonts or images from
          anywhere else.
        </p>
        <p>
          Collections, environments (values you chose to save), history and imported specifications
          are stored in this browser's IndexedDB for this site. Clear them from the app, or by
          clearing the site data in your browser settings.
        </p>
      </>
    ),
  },
];
