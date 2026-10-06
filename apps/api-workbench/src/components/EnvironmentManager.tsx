import { Copy, Eye, EyeOff, Info, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { createId } from '@shared/lib/id';
import { Dialog } from '@shared/react/Dialog';
import { createVariable, looksSensitive } from '../core/factory';
import type { Environment, EnvironmentVariable } from '../core/types';
import {
  createNewEnvironment,
  deleteEnvironment,
  saveEnvironment,
  setActiveEnvironment,
  useStore,
} from '../state/store';

interface Props {
  open: boolean;
  onClose: () => void;
  initialEnvironmentId?: string | null;
}

/** Working copy of an environment where non-persisted values are filled in from memory. */
function workingCopy(environment: Environment, sessionValues: Record<string, string>): Environment {
  return {
    ...environment,
    variables: environment.variables.map((v) =>
      v.persist ? v : { ...v, value: sessionValues[v.id] ?? '' },
    ),
  };
}

export function EnvironmentManager({ open, onClose, initialEnvironmentId }: Props) {
  const environments = useStore((s) => s.environments);
  const sessionValues = useStore((s) => s.sessionValues);
  const activeEnvironmentId = useStore((s) => s.activeEnvironmentId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Environment | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [wasOpen, setWasOpen] = useState(false);

  const select = (env: Environment | undefined) => {
    setSelectedId(env?.id ?? null);
    setDraft(env ? workingCopy(env, sessionValues) : null);
    setRevealed(new Set());
  };

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open)
      select(
        environments.find((e) => e.id === (initialEnvironmentId ?? activeEnvironmentId)) ??
          environments[0],
      );
  }

  const dirty = (() => {
    if (!draft) return false;
    const original = environments.find((e) => e.id === draft.id);
    return (
      !original || JSON.stringify(workingCopy(original, sessionValues)) !== JSON.stringify(draft)
    );
  })();

  const commit = () => {
    if (!draft) return;
    const memory: Record<string, string> = {};
    const stored: Environment = {
      ...draft,
      name: draft.name.trim() || 'Untitled environment',
      variables: draft.variables
        .filter((v) => v.key.trim() || v.value)
        .map((v) => {
          if (v.persist) return v;
          memory[v.id] = v.value;
          return { ...v, value: '' };
        }),
    };
    saveEnvironment(stored, memory);
    setDraft(workingCopy(stored, { ...sessionValues, ...memory }));
  };

  const updateVariable = (id: string, patch: Partial<EnvironmentVariable>) =>
    setDraft((d) =>
      d ? { ...d, variables: d.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)) } : d,
    );

  const addVariable = (key = '') =>
    setDraft((d) => (d ? { ...d, variables: [...d.variables, createVariable({ key })] } : d));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Environments"
      wide
      testId="env-dialog"
      footer={
        <>
          <span className="dialog__footer-start muted">
            {dirty ? 'Unsaved changes' : draft ? 'All changes saved' : ''}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!dirty}
            onClick={commit}
            data-testid="env-save"
          >
            Save
          </button>
        </>
      }
    >
      <div className="env-manager">
        <div className="env-manager__list">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="env-new"
            onClick={() => {
              if (dirty) commit();
              const env = createNewEnvironment(`Environment ${environments.length + 1}`);
              select(env);
            }}
          >
            <Plus aria-hidden /> New environment
          </button>
          <ul>
            {environments.map((env) => (
              <li key={env.id}>
                <button
                  type="button"
                  className={`env-manager__item${env.id === selectedId ? ' is-active' : ''}`}
                  onClick={() => {
                    if (dirty) commit();
                    select(env);
                  }}
                >
                  <span>{env.name}</span>
                  {env.id === activeEnvironmentId && (
                    <span className="badge badge--success">active</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {environments.length === 0 && <p className="muted">No environments yet.</p>}
        </div>

        <div className="env-manager__detail">
          {!draft ? (
            <p className="muted">
              Create an environment such as "Development", "Testing" or "Local", then add variables
              like <code>baseUrl</code>.
            </p>
          ) : (
            <>
              <div className="env-manager__head">
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="env-name">Name</label>
                  <input
                    id="env-name"
                    className="input"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    data-testid="env-name"
                  />
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    commit();
                    setActiveEnvironment(draft.id);
                  }}
                  disabled={activeEnvironmentId === draft.id && !dirty}
                  data-testid="env-activate"
                >
                  Use this environment
                </button>
                <button
                  type="button"
                  className="btn btn--icon"
                  title="Duplicate environment"
                  aria-label="Duplicate environment"
                  onClick={() => {
                    const copy = createNewEnvironment(`${draft.name} (copy)`);
                    const variables = draft.variables.map((v) => ({ ...v, id: createId() }));
                    const memory: Record<string, string> = {};
                    const stored = {
                      ...copy,
                      variables: variables.map((v) => {
                        if (v.persist) return v;
                        memory[v.id] = v.value;
                        return { ...v, value: '' };
                      }),
                    };
                    saveEnvironment(stored, memory);
                    select(stored);
                  }}
                >
                  <Copy aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn--icon btn--danger"
                  title="Delete environment"
                  aria-label="Delete environment"
                  onClick={() => {
                    deleteEnvironment(draft.id);
                    select(environments.find((e) => e.id !== draft.id));
                  }}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>

              <table className="env-table" aria-label="Variables" data-testid="env-variables">
                <thead>
                  <tr>
                    <th>
                      <span className="visually-hidden">Enabled</span>
                    </th>
                    <th>Variable</th>
                    <th>Value</th>
                    <th title="Mask the value on screen">Secret</th>
                    <th title="Store the value in this browser. Unticked values are kept only until the page is closed.">
                      Save value
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.variables.map((v) => (
                    <tr key={v.id} className={v.enabled ? '' : 'is-disabled'}>
                      <td>
                        <input
                          type="checkbox"
                          checked={v.enabled}
                          aria-label={`Enable ${v.key}`}
                          onChange={(e) => updateVariable(v.id, { enabled: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          className="input input--mono"
                          value={v.key}
                          placeholder="baseUrl"
                          aria-label="Variable name"
                          data-testid="env-var-key"
                          onChange={(e) => {
                            const key = e.target.value;
                            // A brand-new variable that starts to look sensitive becomes secret by default.
                            const becameSensitive =
                              !v.value && looksSensitive(key) && !looksSensitive(v.key);
                            updateVariable(
                              v.id,
                              becameSensitive ? { key, secret: true, persist: false } : { key },
                            );
                          }}
                        />
                      </td>
                      <td>
                        <div className="env-table__value">
                          <input
                            className="input input--mono"
                            type={v.secret && !revealed.has(v.id) ? 'password' : 'text'}
                            value={v.value}
                            aria-label={`Value of ${v.key}`}
                            data-testid="env-var-value"
                            autoComplete="off"
                            onChange={(e) => updateVariable(v.id, { value: e.target.value })}
                            placeholder={!v.persist ? 'not saved — kept for this session' : ''}
                          />
                          {v.secret && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--icon btn--sm"
                              aria-label={revealed.has(v.id) ? 'Hide value' : 'Show value'}
                              onClick={() =>
                                setRevealed((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(v.id)) next.delete(v.id);
                                  else next.add(v.id);
                                  return next;
                                })
                              }
                            >
                              {revealed.has(v.id) ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="env-table__center">
                        <input
                          type="checkbox"
                          checked={v.secret}
                          aria-label={`${v.key} is secret`}
                          onChange={(e) =>
                            updateVariable(
                              v.id,
                              e.target.checked
                                ? { secret: true, persist: false }
                                : { secret: false },
                            )
                          }
                        />
                      </td>
                      <td className="env-table__center">
                        <input
                          type="checkbox"
                          checked={v.persist}
                          aria-label={`Save value of ${v.key}`}
                          data-testid="env-var-persist"
                          onChange={(e) => updateVariable(v.id, { persist: e.target.checked })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon btn--sm"
                          aria-label={`Remove ${v.key}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              variables: draft.variables.filter((x) => x.id !== v.id),
                            })
                          }
                        >
                          <Trash2 aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => addVariable()}
                  data-testid="env-add-var"
                >
                  <Plus aria-hidden /> Add variable
                </button>
                {!draft.variables.some((v) => v.key === 'baseUrl') && (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => addVariable('baseUrl')}
                  >
                    + baseUrl
                  </button>
                )}
              </div>
              <div className="notice notice--info" style={{ marginTop: 14 }}>
                <Info aria-hidden />
                <div>
                  <p>
                    Use variables as <code>{'{{name}}'}</code> in the URL, parameters, headers, auth
                    fields and bodies. Built-ins: <code>{'{{$timestamp}}'}</code>,{' '}
                    <code>{'{{$isoTimestamp}}'}</code>, <code>{'{{$randomUUID}}'}</code>.
                  </p>
                  <p>
                    <strong>Browser storage is not a secrets vault.</strong> Saved values are stored
                    unencrypted in this browser profile. Values with "Save value" unticked stay in
                    memory only and must be re-entered after reloading the page; they are never
                    exported.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
