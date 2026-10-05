/** Theme preference shared by every tool (same origin ⇒ same localStorage key). */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'offline-toolbox:theme';

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage may be unavailable (private mode); the choice still applies to this page.
  }
  applyThemePreference(preference);
}

export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

/** The theme actually in effect (resolves "system"). */
export function getEffectiveTheme(): 'light' | 'dark' {
  const preference = getThemePreference();
  if (preference !== 'system') return preference;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
}
