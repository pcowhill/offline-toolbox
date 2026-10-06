// Authentication helpers. Each helper turns its configuration into request headers.
// New schemes (API key, digest, OAuth client-credentials …) can be added to AUTH_HELPERS
// without touching the request pipeline.
import type { AuthConfig, AuthType } from './types';
import { isOnlyVariableReferences } from './variables';

export interface AuthContext {
  /** Applies {{variable}} substitution and records unresolved names. */
  resolve: (value: string) => string;
}

export interface AuthHelper<T extends AuthConfig = AuthConfig> {
  type: T['type'];
  label: string;
  description: string;
  headers: (config: T, context: AuthContext) => Array<[string, string]>;
  /** Removes secrets before the request is saved (unless the user opted in). */
  stripSecrets: (config: T) => T;
}

/** UTF-8 safe base64 (btoa alone fails on non-Latin-1 characters). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const keepIfReference = (value: string) => (isOnlyVariableReferences(value) ? value : '');

const none: AuthHelper<{ type: 'none' }> = {
  type: 'none',
  label: 'No auth',
  description: 'No Authorization header is added. You can still add any header manually.',
  headers: () => [],
  stripSecrets: (config) => config,
};

const basic: AuthHelper<Extract<AuthConfig, { type: 'basic' }>> = {
  type: 'basic',
  label: 'Basic auth',
  description: 'Sends "Authorization: Basic base64(username:password)".',
  headers: (config, { resolve }) => [
    [
      'Authorization',
      `Basic ${base64Utf8(`${resolve(config.username)}:${resolve(config.password)}`)}`,
    ],
  ],
  stripSecrets: (config) =>
    config.saveCredentials ? config : { ...config, password: keepIfReference(config.password) },
};

const bearer: AuthHelper<Extract<AuthConfig, { type: 'bearer' }>> = {
  type: 'bearer',
  label: 'Bearer token',
  description: 'Sends "Authorization: Bearer <token>" (e.g. OAuth 2 access tokens, JWTs).',
  headers: (config, { resolve }) => {
    const prefix = (config.prefix ?? 'Bearer').trim();
    const token = resolve(config.token).trim();
    return [['Authorization', prefix ? `${prefix} ${token}` : token]];
  },
  stripSecrets: (config) =>
    config.saveCredentials ? config : { ...config, token: keepIfReference(config.token) },
};

export const AUTH_HELPERS: Record<AuthType, AuthHelper> = {
  none: none as AuthHelper,
  basic: basic as AuthHelper,
  bearer: bearer as AuthHelper,
};

export function defaultAuth(type: AuthType): AuthConfig {
  switch (type) {
    case 'basic':
      return { type: 'basic', username: '', password: '' };
    case 'bearer':
      return { type: 'bearer', token: '' };
    default:
      return { type: 'none' };
  }
}
