import '@shared/styles/base.css';
import './portal.css';
import {
  getThemePreference,
  nextThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@shared/lib/theme';

const LABELS: Record<ThemePreference, string> = {
  system: 'Theme: system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

const button = document.getElementById('theme-toggle');
const label = document.getElementById('theme-label');
let preference = getThemePreference();
if (label) label.textContent = LABELS[preference];
button?.addEventListener('click', () => {
  preference = nextThemePreference(preference);
  setThemePreference(preference);
  if (label) label.textContent = LABELS[preference];
});
