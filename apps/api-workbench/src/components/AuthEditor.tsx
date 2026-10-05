import { Info } from 'lucide-react';
import { AUTH_HELPERS, defaultAuth } from '../core/auth';
import type { AuthConfig, AuthType } from '../core/types';
import { VariableInput } from './KeyValueEditor';

interface AuthEditorProps {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
}

export function AuthEditor({ auth, onChange }: AuthEditorProps) {
  const helper = AUTH_HELPERS[auth.type];
  return (
    <div className="auth-editor" data-testid="auth-editor">
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="auth-type">Type</label>
        <select
          id="auth-type"
          className="select"
          value={auth.type}
          onChange={(e) => onChange(defaultAuth(e.target.value as AuthType))}
        >
          {Object.values(AUTH_HELPERS).map((h) => (
            <option key={h.type} value={h.type}>
              {h.label}
            </option>
          ))}
        </select>
      </div>
      <p className="muted auth-editor__description">{helper.description}</p>

      {auth.type === 'basic' && (
        <div className="auth-editor__grid">
          <div className="field">
            <label>Username</label>
            <VariableInput
              value={auth.username}
              ariaLabel="Username"
              onChange={(username) => onChange({ ...auth, username })}
              testId="auth-username"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <VariableInput
              value={auth.password}
              type={auth.password.includes('{{') ? 'text' : 'password'}
              ariaLabel="Password"
              onChange={(password) => onChange({ ...auth, password })}
              testId="auth-password"
            />
          </div>
        </div>
      )}
      {auth.type === 'bearer' && (
        <div className="auth-editor__grid">
          <div className="field">
            <label>Token</label>
            <VariableInput
              value={auth.token}
              type={auth.token.includes('{{') ? 'text' : 'password'}
              placeholder="e.g. {{token}}"
              ariaLabel="Token"
              onChange={(token) => onChange({ ...auth, token })}
              testId="auth-token"
            />
          </div>
          <div className="field">
            <label>Prefix</label>
            <input
              className="input"
              value={auth.prefix ?? 'Bearer'}
              aria-label="Token prefix"
              onChange={(e) => onChange({ ...auth, prefix: e.target.value })}
            />
          </div>
        </div>
      )}
      {(auth.type === 'basic' || auth.type === 'bearer') && (
        <>
          <label className="check" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={auth.saveCredentials ?? false}
              onChange={(e) => onChange({ ...auth, saveCredentials: e.target.checked })}
            />
            Save credentials with this request (stored unencrypted in this browser and included in
            exports)
          </label>
          <div className="notice notice--info" style={{ marginTop: 12 }}>
            <Info aria-hidden />
            <div>
              <p>
                By default credentials are kept only while this tab is open; saved requests and
                history keep everything except the secret. Tip: reference an environment variable
                such as <code>{'{{token}}'}</code> — references are always saved, and you choose per
                variable whether its value is stored.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
