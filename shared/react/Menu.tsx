import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}

export type MenuEntry = MenuItem | 'separator';

interface MenuProps {
  /** Viewport coordinates of the anchor point. */
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/** Lightweight popup / context menu positioned in viewport coordinates. */
export function Menu({ x, y, items, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
        );
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="menu" role="menu" style={position}>
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={`sep-${index}`} className="menu__separator" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
            disabled={item.disabled}
            data-testid={item.testId}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/** Helper hook: state for a menu opened at the mouse position or below a button. */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; key?: string } | null>(null);
  return {
    menu,
    openAt: (x: number, y: number, key?: string) => setMenu({ x, y, key }),
    openBelow: (element: HTMLElement, key?: string) => {
      const rect = element.getBoundingClientRect();
      setMenu({ x: rect.left, y: rect.bottom + 4, key });
    },
    close: () => setMenu(null),
  };
}
