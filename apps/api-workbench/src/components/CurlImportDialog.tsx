import { useState } from 'react';
import { Dialog } from '@shared/react/Dialog';
import { toast } from '@shared/react/toasts';
import { parseCurl } from '../core/curl';
import type { RequestSpec } from '../core/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (spec: RequestSpec) => void;
}

export function CurlImportDialog({ open, onClose, onImport }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    try {
      const { spec, warnings } = parseCurl(text);
      onImport(spec);
      if (warnings.length) toast(warnings.join('\n'), 'warning');
      else toast('Request imported from curl', 'success');
      setText('');
      setError(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import from curl"
      wide
      testId="curl-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={!text.trim()}
            data-testid="curl-import-confirm"
          >
            Import
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Paste a curl command. It replaces the request in the current tab. Supported:{' '}
        <code>-X -H -d --data-raw --data-urlencode -F -u -G -I -L</code>.
      </p>
      <textarea
        className="textarea textarea--mono"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "curl -X POST 'https://api.example.com/items' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"value\"}'"
        }
        aria-label="curl command"
        data-testid="curl-input"
        autoFocus
      />
      {error && <p className="danger-text">{error}</p>}
    </Dialog>
  );
}
