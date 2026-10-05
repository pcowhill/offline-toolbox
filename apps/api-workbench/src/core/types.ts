// Data model of API Workbench. Everything here is plain JSON so it can be persisted in
// IndexedDB and exported/imported between (possibly air-gapped) computers.

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export type MultipartFieldKind = 'text' | 'file';

export interface MultipartField extends KeyValue {
  kind: MultipartFieldKind;
  /** Name of the chosen file (the file itself is held in memory only, never persisted). */
  fileName?: string;
  contentType?: string;
}

export type BodyMode = 'none' | 'raw' | 'json' | 'urlencoded' | 'multipart';

export interface RequestBody {
  mode: BodyMode;
  /** Text for mode "raw". */
  raw: string;
  rawContentType: string;
  /** Text for mode "json". Kept separately so switching modes does not lose work. */
  json: string;
  urlencoded: KeyValue[];
  multipart: MultipartField[];
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string; saveCredentials?: boolean }
  | { type: 'bearer'; token: string; prefix?: string; saveCredentials?: boolean };

export type AuthType = AuthConfig['type'];

export interface RequestSettings {
  /** 0 = no timeout. */
  timeoutMs: number;
  /** Whether the browser sends cookies / HTTP auth for cross-origin requests. */
  credentials: 'omit' | 'same-origin' | 'include';
  redirect: 'follow' | 'error';
}

export interface RequestSpec {
  method: HttpMethod;
  /** URL exactly as shown in the URL bar (query string kept in sync with `params`). */
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  auth: AuthConfig;
  body: RequestBody;
  settings: RequestSettings;
}

export interface SavedRequest {
  type: 'request';
  id: string;
  name: string;
  request: RequestSpec;
  description?: string;
}

export interface Folder {
  type: 'folder';
  id: string;
  name: string;
  items: CollectionItem[];
}

export type CollectionItem = SavedRequest | Folder;

export interface Collection {
  id: string;
  name: string;
  description?: string;
  items: CollectionItem[];
  createdAt: number;
  updatedAt: number;
}

export interface EnvironmentVariable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  /** Mask the value in the UI. */
  secret: boolean;
  /**
   * Save the value in this browser's storage. When false the value lives only in memory
   * for the current session and is never written to disk or included in exports.
   */
  persist: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  method: HttpMethod;
  /** URL as entered (with {{variables}} unresolved, so secrets in variables are not stored). */
  url: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  sizeBytes?: number;
  error?: string;
  request: RequestSpec;
}
