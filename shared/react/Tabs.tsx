import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  count?: number;
  testId?: string;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  trailing?: ReactNode;
}

/** Accessible tab list (arrow keys / Home / End move between tabs). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  trailing,
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next >= 0) {
      event.preventDefault();
      onChange(items[next].id);
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons?.[next]?.focus();
    }
  };
  return (
    <div
      className={`tabs${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label={label}
      ref={listRef}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="tabs__tab"
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          onClick={() => onChange(item.id)}
          data-testid={item.testId}
        >
          {item.label}
          {item.count !== undefined && item.count > 0 && (
            <span className="tabs__count">{item.count}</span>
          )}
        </button>
      ))}
      {trailing && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{trailing}</div>
      )}
    </div>
  );
}
