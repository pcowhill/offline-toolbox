import {
  ChevronDown,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
  Gauge,
  Images,
  Download,
  Scissors,
  TextSelect,
  X,
  FileUp,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { pickFiles } from '@shared/lib/download';
import { AppHeader } from '@shared/react/AppHeader';
import { HelpDialog } from '@shared/react/HelpDialog';
import { Menu, useMenu } from '@shared/react/Menu';
import { toast, Toasts } from '@shared/react/toasts';
import { useFileDrop } from '@shared/react/useDropZone';
import { useHotkeys } from '@shared/react/useHotkeys';
import iconUrl from '../icon.svg';
import {
  ImageExportDialog,
  ImagesDialog,
  OptimizeDialog,
  SplitDialog,
  TextDialog,
} from './components/dialogs';
import { Inspector } from './components/Inspector';
import { PageEditor } from './components/PageEditor';
import { PageGrid } from './components/PageGrid';
import { SignatureDialog } from './components/SignatureDialog';
import { TOOL_KEYS, Toolbar } from './components/Toolbar';
import { HELP_SECTIONS } from './help';
import { addPdfFiles, classifyFiles, exportPdf, extractEmbeddedImages } from './state/actions';
import { clearAll } from './state/registry';
import {
  closeAll,
  deletePages,
  redo,
  rotatePages,
  selectAll,
  clearSelection,
  setCurrentPage,
  setMode,
  setTool,
  setZoom,
  targetPageIds,
  undo,
  useStore,
} from './state/store';
import { clearThumbnails } from './state/thumbnails';

const ACCEPT = 'application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp';

export function App() {
  const pages = useStore((s) => s.pages);
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const currentPageId = useStore((s) => s.currentPageId);
  const selection = useStore((s) => s.selection);
  const [help, setHelp] = useState<{ open: boolean; section?: string }>({ open: false });
  const [imageFiles, setImageFiles] = useState<File[] | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [imageExport, setImageExport] = useState<string[] | null>(null);
  const [textPages, setTextPages] = useState<string[] | null>(null);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [thumbSize, setThumbSize] = useState(170);
  const menu = useMenu();
  const currentPage = pages.find((p) => p.id === currentPageId) ?? pages[0];

  const handleFiles = useCallback(async (files: File[]) => {
    const { pdfs, images, rejected } = await classifyFiles(files);
    if (rejected.length) toast(`Not a PDF or supported image: ${rejected.join(', ')}`, 'error');
    if (pdfs.length) await addPdfFiles(pdfs);
    if (images.length) setImageFiles(images);
  }, []);

  const openFiles = useCallback(async () => {
    const files = await pickFiles({ accept: ACCEPT, multiple: true });
    if (files.length) await handleFiles(files);
  }, [handleFiles]);

  const dragActive = useFileDrop(handleFiles, !busy);
  const scopeIds = () =>
    selection.length
      ? pages.filter((p) => selection.includes(p.id)).map((p) => p.id)
      : pages.map((p) => p.id);
  const scopeLabel = selection.length ? `${selection.length} selected page(s)` : 'all pages';

  useHotkeys({
    'Mod+Z': undo,
    'Mod+Shift+Z': redo,
    'Mod+Y': redo,
    'Mod+O': () => void openFiles(),
    'Mod+S': () => pages.length && void exportPdf(),
    'Mod+A': () => mode === 'organize' && selectAll(),
    'Mod+=': () => setZoom(useStore.getState().zoom * 1.2),
    'Mod+-': () => setZoom(useStore.getState().zoom / 1.2),
    F1: () => setHelp({ open: true }),
    Delete: () => mode === 'organize' && deletePages(targetPageIds()),
    '[': () => mode === 'organize' && rotatePages(targetPageIds(), -90),
    ']': () => mode === 'organize' && rotatePages(targetPageIds(), 90),
    Escape: () => {
      if (mode === 'organize') clearSelection();
      else setTool('select');
    },
    PageDown: () => {
      if (mode !== 'edit' || !currentPage) return;
      const next = pages[pages.indexOf(currentPage) + 1];
      if (next) setCurrentPage(next.id);
    },
    PageUp: () => {
      if (mode !== 'edit' || !currentPage) return;
      const previous = pages[pages.indexOf(currentPage) - 1];
      if (previous) setCurrentPage(previous.id);
    },
    ...Object.fromEntries(
      Object.entries(TOOL_KEYS).map(([key, tool]) => [key, () => mode === 'edit' && setTool(tool)]),
    ),
  });

  const hasPages = pages.length > 0;

  return (
    <div className="app">
      <AppHeader
        name="PDF Toolbox"
        icon={iconUrl}
        onHelp={() => setHelp({ open: true })}
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={openFiles}
              data-testid="open-files"
              title="Open or add PDFs and images (Ctrl+O)"
            >
              <FolderOpen aria-hidden />{' '}
              <span className="hide-sm">{hasPages ? 'Add files' : 'Open'}</span>
            </button>
            {hasPages && (
              <div className="btn-group">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void exportPdf()}
                  data-testid="export-pdf"
                  title="Export PDF (Ctrl+S)"
                >
                  <Download aria-hidden /> <span className="hide-sm">Export PDF</span>
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--icon"
                  aria-label="More export and conversion options"
                  onClick={(e) => menu.openBelow(e.currentTarget)}
                  data-testid="more-menu"
                >
                  <ChevronDown aria-hidden />
                </button>
              </div>
            )}
          </>
        }
      />
      {menu.menu && (
        <Menu
          x={menu.menu.x}
          y={menu.menu.y}
          onClose={menu.close}
          items={[
            {
              label: `Export ${selection.length ? 'selected pages' : 'all pages'} as PDF`,
              icon: <FileUp />,
              onSelect: () => void exportPdf(selection.length ? scopeIds() : undefined),
              testId: 'menu-export-selected',
              disabled: !selection.length,
            },
            {
              label: 'Split into several PDFs…',
              icon: <Scissors />,
              onSelect: () => setSplitOpen(true),
              testId: 'menu-split',
            },
            'separator',
            {
              label: `Pages → images (${scopeLabel})…`,
              icon: <FileImage />,
              onSelect: () => setImageExport(scopeIds()),
              testId: 'menu-page-images',
            },
            {
              label: 'Add images as pages…',
              icon: <FilePlus2 />,
              onSelect: async () => {
                const files = await pickFiles({ accept: 'image/*', multiple: true });
                if (files.length) setImageFiles(files);
              },
              testId: 'menu-add-images',
            },
            {
              label: `Extract text (${scopeLabel})…`,
              icon: <TextSelect />,
              onSelect: () => setTextPages(scopeIds()),
              testId: 'menu-extract-text',
            },
            {
              label: `Extract embedded images (${scopeLabel})`,
              icon: <Images />,
              onSelect: () => void extractEmbeddedImages(scopeIds()),
              testId: 'menu-extract-images',
            },
            {
              label: 'Reduce file size…',
              icon: <Gauge />,
              onSelect: () => setOptimizeOpen(true),
              testId: 'menu-optimize',
            },
            'separator',
            {
              label: 'Close all documents',
              icon: <X />,
              danger: true,
              onSelect: () => {
                closeAll();
                clearAll();
                clearThumbnails();
              },
              testId: 'menu-close-all',
            },
          ]}
        />
      )}

      {!hasPages ? (
        <Welcome
          onOpen={openFiles}
          onImages={async () => {
            const files = await pickFiles({ accept: 'image/*', multiple: true });
            if (files.length) setImageFiles(files);
          }}
          onHelp={(section) => setHelp({ open: true, section })}
        />
      ) : (
        <>
          <Toolbar onSignature={() => setSignatureOpen(true)} />
          {mode === 'organize' ? (
            <div className="organize">
              <PageGrid size={thumbSize} />
              <footer className="statusbar">
                <span>{pages.length} page(s)</span>
                <span className="spacer" />
                <label className="statusbar__zoom">
                  Thumbnail size
                  <input
                    type="range"
                    min={110}
                    max={300}
                    step={10}
                    value={thumbSize}
                    onChange={(e) => setThumbSize(Number(e.target.value))}
                    aria-label="Thumbnail size"
                  />
                </label>
                <button type="button" className="btn btn--sm" onClick={() => setMode('edit')}>
                  <FileText aria-hidden /> Edit page
                </button>
              </footer>
            </div>
          ) : (
            <div className="edit-layout">
              <div className="edit-layout__thumbs">
                <PageGrid size={110} compact />
              </div>
              {currentPage && <PageEditor key={currentPage.id} page={currentPage} />}
              <Inspector page={currentPage} />
            </div>
          )}
        </>
      )}

      {dragActive && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay__box">
            <FileUp />
            <p>Drop PDFs or images to add them</p>
          </div>
        </div>
      )}
      {busy && (
        <div className="busy-overlay" role="status" aria-live="polite" data-testid="busy">
          <div className="busy-overlay__box">
            <div className="busy-overlay__spinner" />
            <p>{busy.message}</p>
            {busy.progress !== undefined && <progress max={1} value={busy.progress} />}
          </div>
        </div>
      )}

      <HelpDialog
        open={help.open}
        onClose={() => setHelp({ open: false })}
        title="PDF Toolbox help"
        sections={HELP_SECTIONS}
        initialSection={help.section}
      />
      <ImagesDialog files={imageFiles} onClose={() => setImageFiles(null)} />
      <SplitDialog open={splitOpen} onClose={() => setSplitOpen(false)} />
      <ImageExportDialog pageIds={imageExport} onClose={() => setImageExport(null)} />
      <TextDialog pageIds={textPages} onClose={() => setTextPages(null)} />
      <OptimizeDialog open={optimizeOpen} onClose={() => setOptimizeOpen(false)} />
      <SignatureDialog open={signatureOpen} onClose={() => setSignatureOpen(false)} />
      <Toasts />
    </div>
  );
}

function Welcome({
  onOpen,
  onImages,
  onHelp,
}: {
  onOpen: () => void;
  onImages: () => void;
  onHelp: (section: string) => void;
}) {
  return (
    <main className="welcome" data-testid="welcome">
      <div className="welcome__drop">
        <FileUp className="welcome__icon" aria-hidden />
        <h2>Open PDFs to get started</h2>
        <p>
          Drag PDF files or images anywhere onto this window, or choose them from your computer.
        </p>
        <div className="toolbar" style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={onOpen}
            data-testid="welcome-open"
          >
            <FolderOpen aria-hidden /> Open PDF…
          </button>
          <button
            type="button"
            className="btn btn--lg"
            onClick={onImages}
            data-testid="welcome-images"
          >
            <FileImage aria-hidden /> Create PDF from images…
          </button>
        </div>
        <p className="welcome__privacy">
          🔒 Files are processed locally in this browser tab and are never uploaded.{' '}
          <button type="button" className="link-button" onClick={() => onHelp('local')}>
            Learn more
          </button>
        </p>
      </div>
      <ul className="welcome__features">
        <li>
          <strong>Organize</strong> merge, split, reorder, rotate, duplicate, delete and extract
          pages
        </li>
        <li>
          <strong>Annotate</strong> text, drawing, highlights, shapes, stamps, images and signatures
        </li>
        <li>
          <strong>Forms</strong> fill existing form fields and optionally flatten them
        </li>
        <li>
          <strong>Convert</strong> images → PDF, pages → PNG/JPEG, extract text and images
        </li>
        <li>
          <strong>Protect</strong> secure redaction (whiteout is visual only —{' '}
          <button type="button" className="link-button" onClick={() => onHelp('redaction')}>
            why?
          </button>
          )
        </li>
        <li>
          <strong>Optimize</strong> reduce file size with quality presets
        </li>
      </ul>
    </main>
  );
}
