import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FileUp,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  History as HistoryIcon,
  BookOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { pickFiles } from '@shared/lib/download';
import { formatRelativeTime } from '@shared/lib/format';
import { EmptyState } from '@shared/react/EmptyState';
import { Menu, useMenu, type MenuEntry } from '@shared/react/Menu';
import { Tabs } from '@shared/react/Tabs';
import { toast } from '@shared/react/toasts';
import { countRequests } from '../core/collections';
import { parseImport } from '../core/exchange';
import { createRequestSpec } from '../core/factory';
import { groupHistoryByDay } from '../core/history';
import { groupOperationsByTag, importSpec, type ApiSpec } from '../core/openapi';
import type { Collection, CollectionItem } from '../core/types';
import {
  addFolder,
  addSpec,
  clearHistory,
  createNewCollection,
  deleteCollection,
  deleteHistoryEntry,
  deleteItemFromCollections,
  deleteSpec,
  duplicateItemInCollections,
  importData,
  openHistoryEntry,
  openOperationTab,
  openSavedRequest,
  renameCollection,
  renameItemInCollections,
  saveTabRequest,
  setSidebarView,
  openNewTab,
  useStore,
  type SidebarView,
} from '../state/store';
import { ConfirmDialog, PromptDialog, type ConfirmState, type PromptState } from './dialogs';
import { ExportDialog } from './ExportDialog';
import { MethodBadge } from './MethodBadge';
import { MoveDialog } from './MoveDialog';

export function Sidebar() {
  const view = useStore((s) => s.sidebarView);
  const historyCount = useStore((s) => s.history.length);
  const specCount = useStore((s) => s.specs.length);
  return (
    <aside className="sidebar" aria-label="Library">
      <Tabs<SidebarView>
        label="Sidebar"
        value={view}
        onChange={setSidebarView}
        items={[
          { id: 'collections', label: 'Collections', testId: 'sidebar-collections' },
          { id: 'history', label: 'History', count: historyCount, testId: 'sidebar-history' },
          { id: 'specs', label: 'API specs', count: specCount, testId: 'sidebar-specs' },
        ]}
      />
      <div className="sidebar__content">
        {view === 'collections' && <CollectionsPanel />}
        {view === 'history' && <HistoryPanel />}
        {view === 'specs' && <SpecsPanel />}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------------------------------
// Collections

function CollectionsPanel() {
  const collections = useStore((s) => s.collections);
  const activeSavedId = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.kind === 'request' ? tab.savedRequestId : undefined;
  });
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState<{ collectionIds?: string[] } | null>(null);
  const menu = useMenu();
  const q = filter.trim().toLowerCase();

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doImport = async () => {
    const [file] = await pickFiles({ accept: '.json,application/json' });
    if (!file) return;
    try {
      const result = parseImport(await file.text());
      importData(result.collections, result.environments);
      const parts = [
        `${result.collections.length} collection(s)`,
        `${result.environments.length} environment(s)`,
      ];
      toast(
        `Imported ${parts.join(' and ')} from ${file.name}${result.warnings.length ? `\n${result.warnings.join('\n')}` : ''}`,
        result.warnings.length ? 'warning' : 'success',
      );
    } catch (error) {
      toast(`Import failed: ${(error as Error).message}`, 'error');
    }
  };

  const newRequestIn = (collectionId: string, folderId: string | null) => {
    const tabId = openNewTab(createRequestSpec(), 'New request');
    saveTabRequest(tabId, { location: { collectionId, folderId }, name: 'New request' });
  };

  const collectionMenu = (collection: Collection): MenuEntry[] => [
    {
      label: 'New request',
      icon: <FilePlus2 />,
      onSelect: () => newRequestIn(collection.id, null),
    },
    {
      label: 'New folder',
      icon: <FolderPlus />,
      onSelect: () =>
        setPrompt({
          title: 'New folder',
          label: 'Folder name',
          initial: 'New folder',
          onSubmit: (name) => addFolder(collection.id, null, name),
        }),
    },
    'separator',
    {
      label: 'Rename…',
      icon: <Pencil />,
      testId: 'menu-rename',
      onSelect: () =>
        setPrompt({
          title: 'Rename collection',
          label: 'Name',
          initial: collection.name,
          onSubmit: (name) => renameCollection(collection.id, name),
        }),
    },
    {
      label: 'Export…',
      icon: <Download />,
      onSelect: () => setExportOpen({ collectionIds: [collection.id] }),
    },
    'separator',
    {
      label: 'Delete',
      icon: <Trash2 />,
      danger: true,
      testId: 'menu-delete',
      onSelect: () =>
        setConfirm({
          title: 'Delete collection',
          message: `Delete "${collection.name}" and its ${countRequests(collection.items)} request(s)? This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
          onConfirm: () => deleteCollection(collection.id),
        }),
    },
  ];

  const itemMenu = (collection: Collection, item: CollectionItem): MenuEntry[] => [
    ...(item.type === 'folder'
      ? ([
          {
            label: 'New request',
            icon: <FilePlus2 />,
            onSelect: () => newRequestIn(collection.id, item.id),
          },
          {
            label: 'New folder',
            icon: <FolderPlus />,
            onSelect: () =>
              setPrompt({
                title: 'New folder',
                label: 'Folder name',
                initial: 'New folder',
                onSubmit: (name) => addFolder(collection.id, item.id, name),
              }),
          },
          'separator',
        ] as MenuEntry[])
      : []),
    {
      label: 'Rename…',
      icon: <Pencil />,
      testId: 'menu-rename',
      onSelect: () =>
        setPrompt({
          title: `Rename ${item.type}`,
          label: 'Name',
          initial: item.name,
          onSubmit: (name) => renameItemInCollections(item.id, name),
        }),
    },
    {
      label: 'Duplicate',
      icon: <Copy />,
      testId: 'menu-duplicate',
      onSelect: () => duplicateItemInCollections(item.id),
    },
    {
      label: 'Move to…',
      icon: <FolderInput />,
      testId: 'menu-move',
      onSelect: () => setMoveId(item.id),
    },
    'separator',
    {
      label: 'Delete',
      icon: <Trash2 />,
      danger: true,
      testId: 'menu-delete',
      onSelect: () =>
        setConfirm({
          title: `Delete ${item.type}`,
          message: `Delete "${item.name}"${item.type === 'folder' ? ` and its ${countRequests(item.items)} request(s)` : ''}?`,
          confirmLabel: 'Delete',
          danger: true,
          onConfirm: () => deleteItemFromCollections(item.id),
        }),
    },
  ];

  const [menuItems, setMenuItems] = useState<MenuEntry[]>([]);
  const openMenu = (event: MouseEvent, items: MenuEntry[]) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuItems(items);
    menu.openAt(event.clientX, event.clientY);
  };

  const matches = (item: CollectionItem): boolean =>
    !q ||
    item.name.toLowerCase().includes(q) ||
    (item.type === 'request' && item.request.url.toLowerCase().includes(q)) ||
    (item.type === 'folder' && item.items.some(matches));

  const renderItems = (collection: Collection, items: CollectionItem[], depth: number) =>
    items.filter(matches).map((item) => {
      const isOpen = q ? true : !collapsed.has(item.id);
      if (item.type === 'folder') {
        return (
          <li key={item.id}>
            <div
              className="tree-row"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => toggle(item.id)}
              onContextMenu={(e) => openMenu(e, itemMenu(collection, item))}
              role="treeitem"
              aria-expanded={isOpen}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(item.id);
                }
              }}
            >
              {isOpen ? (
                <ChevronDown className="tree-row__chevron" />
              ) : (
                <ChevronRight className="tree-row__chevron" />
              )}
              <FolderIcon className="tree-row__icon" aria-hidden />
              <span className="tree-row__label">{item.name}</span>
              <RowMenuButton
                label={item.name}
                onClick={(e) => openMenu(e, itemMenu(collection, item))}
              />
            </div>
            {isOpen && <ul role="group">{renderItems(collection, item.items, depth + 1)}</ul>}
          </li>
        );
      }
      return (
        <li key={item.id}>
          <div
            className={`tree-row${activeSavedId === item.id ? ' is-active' : ''}`}
            style={{ paddingLeft: 22 + depth * 14 }}
            onClick={() => openSavedRequest(item.id)}
            onContextMenu={(e) => openMenu(e, itemMenu(collection, item))}
            role="treeitem"
            tabIndex={0}
            data-testid="saved-request"
            onKeyDown={(e) => {
              if (e.key === 'Enter') openSavedRequest(item.id);
              if (e.key === 'F2')
                setPrompt({
                  title: 'Rename request',
                  label: 'Name',
                  initial: item.name,
                  onSubmit: (name) => renameItemInCollections(item.id, name),
                });
              if (e.key === 'Delete') deleteItemFromCollections(item.id);
            }}
            title={item.request.url}
          >
            <MethodBadge method={item.request.method} small />
            <span className="tree-row__label">{item.name}</span>
            <RowMenuButton
              label={item.name}
              onClick={(e) => openMenu(e, itemMenu(collection, item))}
            />
          </div>
        </li>
      );
    });

  return (
    <div className="panel">
      <div className="panel__toolbar">
        <button
          type="button"
          className="btn btn--sm"
          data-testid="new-collection"
          onClick={() =>
            setPrompt({
              title: 'New collection',
              label: 'Collection name',
              initial: 'My collection',
              confirmLabel: 'Create',
              onSubmit: (name) => createNewCollection(name),
            })
          }
        >
          <Plus aria-hidden /> New
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={doImport}
          data-testid="import-collections"
          title="Import an API Workbench export or a Postman v2 collection"
        >
          <FileUp aria-hidden /> Import
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setExportOpen({})}
          data-testid="export-collections"
          disabled={!collections.length && !useStore.getState().environments.length}
        >
          <Download aria-hidden /> Export
        </button>
      </div>
      {collections.length > 0 && (
        <input
          className="input panel__filter"
          placeholder="Filter requests…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter requests"
        />
      )}
      {collections.length === 0 ? (
        <EmptyState icon={FolderIcon} title="No collections yet" testId="collections-empty">
          Save a request with <kbd>Ctrl</kbd>+<kbd>S</kbd> or create a collection. Use Import to
          load an export from another computer.
        </EmptyState>
      ) : (
        <ul className="tree" role="tree" aria-label="Collections" data-testid="collections-tree">
          {collections.map((collection) => {
            const isOpen = q ? true : !collapsed.has(collection.id);
            return (
              <li key={collection.id}>
                <div
                  className="tree-row tree-row--collection"
                  onClick={() => toggle(collection.id)}
                  onContextMenu={(e) => openMenu(e, collectionMenu(collection))}
                  role="treeitem"
                  aria-expanded={isOpen}
                  tabIndex={0}
                  data-testid="collection-row"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(collection.id);
                    }
                  }}
                >
                  {isOpen ? (
                    <ChevronDown className="tree-row__chevron" />
                  ) : (
                    <ChevronRight className="tree-row__chevron" />
                  )}
                  <span className="tree-row__label">{collection.name}</span>
                  <span className="tree-row__count">{countRequests(collection.items)}</span>
                  <RowMenuButton
                    label={collection.name}
                    onClick={(e) => openMenu(e, collectionMenu(collection))}
                  />
                </div>
                {isOpen && (
                  <ul role="group">
                    {renderItems(collection, collection.items, 1)}
                    {collection.items.length === 0 && (
                      <li className="tree-empty">Empty — save a request here.</li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {menu.menu && <Menu x={menu.menu.x} y={menu.menu.y} items={menuItems} onClose={menu.close} />}
      <PromptDialog state={prompt} onClose={() => setPrompt(null)} />
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      <MoveDialog itemId={moveId} onClose={() => setMoveId(null)} />
      <ExportDialog
        open={!!exportOpen}
        preselected={exportOpen?.collectionIds}
        onClose={() => setExportOpen(null)}
      />
    </div>
  );
}

function RowMenuButton({ label, onClick }: { label: string; onClick: (e: MouseEvent) => void }) {
  return (
    <button
      type="button"
      className="tree-row__menu btn btn--ghost btn--icon btn--sm"
      aria-label={`Actions for ${label}`}
      onClick={onClick}
      data-testid="row-menu"
    >
      <MoreHorizontal aria-hidden />
    </button>
  );
}

// ------------------------------------------------------------------------------------------
// History

function HistoryPanel() {
  const history = useStore((s) => s.history);
  const [filter, setFilter] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const q = filter.trim().toLowerCase();
  const groups = useMemo(
    () =>
      groupHistoryByDay(
        q
          ? history.filter((h) => h.url.toLowerCase().includes(q) || h.method.toLowerCase() === q)
          : history,
      ),
    [history, q],
  );
  if (!history.length) {
    return (
      <EmptyState icon={HistoryIcon} title="No history yet" testId="history-empty">
        Every request you send is listed here (newest first, up to 200 entries). Credentials are not
        stored.
      </EmptyState>
    );
  }
  return (
    <div className="panel">
      <div className="panel__toolbar">
        <input
          className="input"
          placeholder="Filter history…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter history"
        />
        <button
          type="button"
          className="btn btn--sm btn--danger"
          data-testid="clear-history"
          onClick={() =>
            setConfirm({
              title: 'Clear history',
              message: `Delete all ${history.length} history entries?`,
              confirmLabel: 'Clear all',
              danger: true,
              onConfirm: clearHistory,
            })
          }
        >
          Clear
        </button>
      </div>
      <div className="history" data-testid="history-list">
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className="history__day">{group.label}</h3>
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.id} className="history__item" data-testid="history-item">
                  <button
                    type="button"
                    className="history__open"
                    onClick={() => openHistoryEntry(entry.id)}
                    title={`${entry.method} ${entry.url}\n${new Date(entry.timestamp).toLocaleString()}`}
                  >
                    <MethodBadge method={entry.method} small />
                    <span className="history__url">{entry.url}</span>
                    <span className="history__meta">
                      {entry.status !== undefined ? (
                        <span
                          className={`status-chip status-chip--${Math.floor(entry.status / 100)}xx`}
                        >
                          {entry.status}
                        </span>
                      ) : (
                        <span className="status-chip status-chip--err" title={entry.error}>
                          ERR
                        </span>
                      )}
                      <span>{formatRelativeTime(entry.timestamp)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm history__delete"
                    aria-label="Delete history entry"
                    onClick={() => deleteHistoryEntry(entry.id)}
                  >
                    <X aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// OpenAPI specs

function SpecsPanel() {
  const specs = useStore((s) => s.specs);
  const activeOperationId = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.kind === 'operation' ? tab.operationId : undefined;
  });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const q = filter.trim().toLowerCase();

  const doImport = async () => {
    const files = await pickFiles({
      accept: '.json,.yaml,.yml,application/json,application/yaml,text/yaml',
      multiple: true,
    });
    for (const file of files) {
      try {
        const spec = importSpec(await file.text(), file.name);
        addSpec(spec);
        toast(
          `Imported "${spec.title}" — ${spec.operations.length} operation(s)${spec.warnings.length ? `\n${spec.warnings.slice(0, 5).join('\n')}` : ''}`,
          spec.warnings.length ? 'warning' : 'success',
        );
      } catch (error) {
        toast(`${file.name}: ${(error as Error).message}`, 'error');
      }
    }
  };

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="panel">
      <div className="panel__toolbar">
        <button type="button" className="btn btn--sm" onClick={doImport} data-testid="import-spec">
          <FileUp aria-hidden /> Import OpenAPI…
        </button>
      </div>
      {specs.length === 0 ? (
        <EmptyState icon={BookOpen} title="No API specifications" testId="specs-empty">
          Import a local OpenAPI 3.x or Swagger 2.0 file (JSON or YAML) to browse its endpoints and
          turn them into requests.
        </EmptyState>
      ) : (
        <>
          <input
            className="input panel__filter"
            placeholder="Filter operations…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter operations"
          />
          <div className="specs">
            {specs.map((spec) => (
              <SpecTree
                key={spec.id}
                spec={spec}
                query={q}
                collapsed={collapsed}
                toggle={toggle}
                activeOperationId={activeOperationId}
                onDelete={() =>
                  setConfirm({
                    title: 'Remove specification',
                    message: `Remove "${spec.title}" from API Workbench?`,
                    confirmLabel: 'Remove',
                    danger: true,
                    onConfirm: () => deleteSpec(spec.id),
                  })
                }
              />
            ))}
          </div>
        </>
      )}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function SpecTree({
  spec,
  query,
  collapsed,
  toggle,
  activeOperationId,
  onDelete,
}: {
  spec: ApiSpec;
  query: string;
  collapsed: Set<string>;
  toggle: (key: string) => void;
  activeOperationId?: string;
  onDelete: () => void;
}) {
  const groups = useMemo(() => groupOperationsByTag(spec), [spec]);
  const isOpen = query ? true : !collapsed.has(spec.id);
  return (
    <section className="spec" data-testid="spec">
      <div className="spec__header">
        <button
          type="button"
          className="spec__toggle"
          onClick={() => toggle(spec.id)}
          aria-expanded={isOpen}
        >
          {isOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          <span className="spec__title">{spec.title}</span>
        </button>
        <span className="badge" title={spec.specVersion}>
          {spec.version || spec.specVersion}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label={`Remove ${spec.title}`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
        </button>
      </div>
      {isOpen && (
        <div className="spec__body">
          <p className="spec__meta muted">
            {spec.specVersion} · {spec.operations.length} operations · {spec.fileName}
          </p>
          {groups.map((group) => {
            const ops = group.operations.filter(
              (op) =>
                !query ||
                op.path.toLowerCase().includes(query) ||
                (op.summary ?? '').toLowerCase().includes(query) ||
                op.method.toLowerCase() === query,
            );
            if (!ops.length) return null;
            const key = `${spec.id}:${group.tag}`;
            const groupOpen = query ? true : !collapsed.has(key);
            return (
              <div key={group.tag} className="spec__group">
                <button
                  type="button"
                  className="spec__tag"
                  onClick={() => toggle(key)}
                  aria-expanded={groupOpen}
                  title={group.description}
                >
                  {groupOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                  {group.tag}
                  <span className="tree-row__count">{ops.length}</span>
                </button>
                {groupOpen && (
                  <ul>
                    {ops.map((op) => (
                      <li key={op.id}>
                        <button
                          type="button"
                          className={`operation-row${activeOperationId === op.id ? ' is-active' : ''}${op.deprecated ? ' is-deprecated' : ''}`}
                          onClick={() =>
                            openOperationTab(spec.id, op.id, `${op.method} ${op.path}`)
                          }
                          title={op.summary}
                          data-testid="operation-row"
                        >
                          <MethodBadge method={op.method} small />
                          <span className="operation-row__path mono">{op.path}</span>
                          {op.summary && (
                            <span className="operation-row__summary">{op.summary}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
