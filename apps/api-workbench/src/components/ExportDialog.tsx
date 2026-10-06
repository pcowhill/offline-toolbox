import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { downloadText } from '@shared/lib/download';
import { Dialog } from '@shared/react/Dialog';
import { toast } from '@shared/react/toasts';
import { createExport } from '../core/exchange';
import { useStore } from '../state/store';

interface Props {
  open: boolean;
  preselected?: string[];
  onClose: () => void;
}

/** Exports collections and environments to a JSON file for transfer to another computer. */
export function ExportDialog({ open, preselected, onClose }: Props) {
  const collections = useStore((s) => s.collections);
  const environments = useStore((s) => s.environments);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());
  const [selectedEnvironments, setSelectedEnvironments] = useState<Set<string>>(new Set());
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelectedCollections(new Set(preselected ?? collections.map((c) => c.id)));
      setSelectedEnvironments(new Set(preselected ? [] : environments.map((e) => e.id)));
      setIncludeSecrets(false);
    }
  }
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const doExport = () => {
    const data = createExport(
      collections.filter((c) => selectedCollections.has(c.id)),
      environments.filter((e) => selectedEnvironments.has(e.id)),
      { includeSecretValues: includeSecrets },
    );
    const date = new Date().toISOString().slice(0, 10);
    downloadText(
      JSON.stringify(data, null, 2),
      `api-workbench-export-${date}.json`,
      'application/json',
    );
    toast(
      `Exported ${data.collections.length} collection(s) and ${data.environments.length} environment(s)`,
      'success',
    );
    onClose();
  };
  const hasSecretVariables = environments.some(
    (e) => selectedEnvironments.has(e.id) && e.variables.some((v) => v.secret && v.persist),
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export collections & environments"
      testId="export-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={doExport}
            disabled={selectedCollections.size + selectedEnvironments.size === 0}
            data-testid="export-confirm"
          >
            Export JSON
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Creates a JSON file you can import with API Workbench on another computer. Values of
        variables marked "don't save" and unsaved credentials are never exported.
      </p>
      <div className="export-columns">
        <fieldset>
          <legend>Collections</legend>
          {collections.length === 0 && <p className="muted">None</p>}
          {collections.map((c) => (
            <label key={c.id} className="check">
              <input
                type="checkbox"
                checked={selectedCollections.has(c.id)}
                onChange={() => toggle(selectedCollections, c.id, setSelectedCollections)}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Environments</legend>
          {environments.length === 0 && <p className="muted">None</p>}
          {environments.map((e) => (
            <label key={e.id} className="check">
              <input
                type="checkbox"
                checked={selectedEnvironments.has(e.id)}
                onChange={() => toggle(selectedEnvironments, e.id, setSelectedEnvironments)}
              />
              {e.name}
            </label>
          ))}
        </fieldset>
      </div>
      {hasSecretVariables && (
        <>
          <label className="check" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
            />
            Include values of variables marked secret
          </label>
          {includeSecrets && (
            <div className="notice notice--warning" style={{ marginTop: 8 }}>
              <TriangleAlert aria-hidden />
              <div>
                <p>
                  The export file will contain secrets in plain text. Store and transfer it
                  accordingly.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
