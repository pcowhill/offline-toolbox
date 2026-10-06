import type { ComponentType, ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}

export function EmptyState({ icon: Icon, title, children, actions, testId }: EmptyStateProps) {
  return (
    <div className="empty-state" data-testid={testId}>
      {Icon && <Icon className="empty-state__icon" aria-hidden />}
      <p className="empty-state__title">{title}</p>
      {children && <div className="empty-state__text">{children}</div>}
      {actions && (
        <div className="toolbar" style={{ justifyContent: 'center', marginTop: 8 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
