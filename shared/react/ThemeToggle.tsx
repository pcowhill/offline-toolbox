import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import {
  getThemePreference,
  nextThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../lib/theme';

const LABELS: Record<ThemePreference, string> = {
  system: 'Theme: follow system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference);
  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon"
      title={`${LABELS[preference]} (click to change)`}
      aria-label={LABELS[preference]}
      onClick={() => {
        const next = nextThemePreference(preference);
        setThemePreference(next);
        setPreference(next);
      }}
    >
      <Icon aria-hidden />
    </button>
  );
}
