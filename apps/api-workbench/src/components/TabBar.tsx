import { BookOpen, Plus, X } from 'lucide-react';
import { activateTab, closeTab, openNewTab, useStore } from '../state/store';
import { MethodBadge } from './MethodBadge';

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  return (
    <div className="tab-bar" role="tablist" aria-label="Open requests" data-testid="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-bar__tab${tab.id === activeTabId ? ' is-active' : ''}`}
          role="tab"
          aria-selected={tab.id === activeTabId}
          tabIndex={0}
          onClick={() => activateTab(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) closeTab(tab.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') activateTab(tab.id);
          }}
          title={tab.kind === 'request' ? tab.request.url || tab.title : tab.title}
          data-testid="request-tab"
        >
          {tab.kind === 'request' ? (
            <MethodBadge method={tab.request.method} small />
          ) : (
            <BookOpen className="tab-bar__icon" aria-hidden />
          )}
          <span className="tab-bar__title">{tab.title}</span>
          {tab.kind === 'request' && tab.dirty && (
            <span className="tab-bar__dirty" title="Unsaved changes" aria-label="Unsaved changes" />
          )}
          <button
            type="button"
            className="tab-bar__close"
            aria-label={`Close ${tab.title}`}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            <X aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm tab-bar__new"
        aria-label="New request tab (Alt+T)"
        title="New request tab (Alt+T)"
        onClick={() => openNewTab()}
        data-testid="new-tab"
      >
        <Plus aria-hidden />
      </button>
    </div>
  );
}
