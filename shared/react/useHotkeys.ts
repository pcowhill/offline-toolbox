import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

/** True when keyboard focus is in a text field, where single-key shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('.cm-editor')) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

/**
 * Normalises an event into "Mod+Shift+K" form. "Mod" is Ctrl on Windows/Linux and ⌘ on macOS.
 */
export function eventToHotkey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let key = event.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

/**
 * Global keyboard shortcuts. Shortcuts without a modifier are ignored while typing in a field;
 * shortcuts with Mod work everywhere.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const mapRef = useRef(map);
  mapRef.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('dialog[open]') && event.key !== 'F1') return;
      const hotkey = eventToHotkey(event);
      const handler = mapRef.current[hotkey];
      if (!handler) return;
      const hasModifier = hotkey.startsWith('Mod+') || /^F\d+$/.test(event.key);
      if (!hasModifier && isEditableTarget(event.target)) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
