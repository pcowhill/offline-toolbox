import { PanelLeft, Settings2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader } from '@shared/react/AppHeader';
import { HelpDialog } from '@shared/react/HelpDialog';
import { Toasts } from '@shared/react/toasts';
import { useHotkeys } from '@shared/react/useHotkeys';
import iconUrl from '../icon.svg';
import { EnvironmentManager } from './components/EnvironmentManager';
import { OperationView } from './components/OperationView';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer';
import { SaveRequestDialog } from './components/SaveRequestDialog';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { HELP_SECTIONS } from './help';
import {
  activeTab,
  cancelRequest,
  closeTab,
  openNewTab,
  saveTabRequest,
  sendRequest,
  setActiveEnvironment,
  useStore,
} from './state/store';

const SPLIT_KEY = 'api-workbench:split';
const SIDEBAR_KEY = 'api-workbench:sidebar';

function readNumber(key: string, fallback: number) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function App() {
  const ready = useStore((s) => s.ready);
  const persistent = useStore((s) => s.persistent);
  const tab = useStore((s) => activeTab(s));
  const environments = useStore((s) => s.environments);
  const activeEnvironmentId = useStore((s) => s.activeEnvironmentId);
  const [help, setHelp] = useState<{ open: boolean; section?: string }>({ open: false });
  const [envOpen, setEnvOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_KEY);
      return stored === null ? window.innerWidth > 900 : stored === '1';
    } catch {
      return true;
    }
  });
  const [split, setSplit] = useState(() => readNumber(SPLIT_KEY, 0.48));
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarOpen]);

  const openHelp = useCallback((section?: string) => setHelp({ open: true, section }), []);

  useHotkeys({
    'Mod+Enter': () => {
      if (tab?.kind === 'request') void sendRequest(tab.id);
    },
    'Mod+S': () => {
      if (tab?.kind !== 'request') return;
      if (tab.savedRequestId) saveTabRequest(tab.id);
      else setSaveOpen(true);
    },
    Escape: () => {
      if (tab?.kind !== 'request' || !tab.sending) return false;
      cancelRequest(tab.id);
    },
    'Alt+T': () => {
      openNewTab();
    },
    'Alt+W': () => {
      if (tab) closeTab(tab.id);
    },
    F1: () => openHelp(),
  });

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const main = mainRef.current;
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const onMove = (e: PointerEvent) => {
      const ratio = Math.min(0.85, Math.max(0.15, (e.clientY - rect.top) / rect.height));
      setSplit(ratio);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try {
        localStorage.setItem(SPLIT_KEY, String(splitRef.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const splitRef = useRef(split);
  splitRef.current = split;

  return (
    <div className="app">
      <AppHeader
        name="API Workbench"
        icon={iconUrl}
        onHelp={() => openHelp()}
        actions={
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={sidebarOpen}
            title="Toggle sidebar"
          >
            <PanelLeft aria-hidden />
          </button>
        }
      >
        <div className="env-picker">
          <label htmlFor="env-select" className="env-picker__label">
            Environment
          </label>
          <select
            id="env-select"
            className="select"
            value={activeEnvironmentId ?? ''}
            onChange={(e) => setActiveEnvironment(e.target.value || null)}
            data-testid="env-select"
          >
            <option value="">No environment</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => setEnvOpen(true)}
            aria-label="Manage environments"
            title="Manage environments"
            data-testid="manage-envs"
          >
            <Settings2 aria-hidden />
          </button>
        </div>
      </AppHeader>

      {!persistent && ready && (
        <div className="storage-banner" role="alert">
          <TriangleAlert aria-hidden /> Browser storage (IndexedDB) is unavailable — for example in
          some private-browsing modes. Collections, environments and history will be lost when this
          page is closed. Use Export to keep your work.
        </div>
      )}

      <div className={`layout${sidebarOpen ? '' : ' layout--no-sidebar'}`}>
        {sidebarOpen && <Sidebar />}
        <main className="main" ref={mainRef}>
          <TabBar />
          {!ready ? (
            <div className="main__loading muted">Loading…</div>
          ) : tab?.kind === 'request' ? (
            <div
              className="workspace"
              style={{
                gridTemplateRows: `minmax(160px, ${split}fr) 6px minmax(120px, ${1 - split}fr)`,
              }}
            >
              <RequestEditor key={tab.id} tab={tab} />
              <div
                className="workspace__divider"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize request and response panes"
                onPointerDown={startResize}
              />
              <ResponseViewer tab={tab} onHelp={openHelp} />
            </div>
          ) : tab?.kind === 'operation' ? (
            <OperationView key={tab.id} tab={tab} />
          ) : null}
        </main>
      </div>

      <HelpDialog
        open={help.open}
        onClose={() => setHelp({ open: false })}
        title="API Workbench help"
        sections={HELP_SECTIONS}
        initialSection={help.section}
      />
      <EnvironmentManager open={envOpen} onClose={() => setEnvOpen(false)} />
      {tab?.kind === 'request' && (
        <SaveRequestDialog open={saveOpen} onClose={() => setSaveOpen(false)} tab={tab} />
      )}
      <Toasts />
    </div>
  );
}
