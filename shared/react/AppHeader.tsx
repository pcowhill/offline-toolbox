import { CircleHelp, House } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

interface AppHeaderProps {
  name: string;
  icon: string;
  /** Controls shown in the middle of the header (e.g. environment selector). */
  children?: ReactNode;
  /** Extra controls shown before the theme/help buttons. */
  actions?: ReactNode;
  onHelp?: () => void;
}

/** Common header: link back to the Offline Toolbox launcher, tool name, theme and help. */
export function AppHeader({ name, icon, children, actions, onHelp }: AppHeaderProps) {
  return (
    <header className="app-header">
      {/* "../" is the portal: tools live in sibling folders of the launcher. */}
      <a
        className="app-header__home"
        href="../"
        title="Back to Offline Toolbox"
        data-testid="home-link"
      >
        <House aria-hidden />
        <span className="app-header__home-label">Toolbox</span>
      </a>
      <span className="app-header__divider" aria-hidden />
      <h1 className="app-header__brand" style={{ margin: 0 }}>
        <img src={icon} alt="" />
        <span className="app-header__brand-name">{name}</span>
      </h1>
      <div className="app-header__center">{children}</div>
      <div className="app-header__actions">
        {actions}
        <ThemeToggle />
        {onHelp && (
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onHelp}
            title="Help (F1)"
            aria-label="Help"
            data-testid="help-button"
          >
            <CircleHelp aria-hidden />
          </button>
        )}
      </div>
    </header>
  );
}
