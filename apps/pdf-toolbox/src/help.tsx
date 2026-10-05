import type { HelpSection } from '@shared/react/HelpDialog';

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    content: (
      <>
        <p>
          PDF Toolbox works like a small desktop PDF editor that runs entirely in your browser. Open
          one or more PDFs (or images) with <strong>Open</strong> or by dragging files onto the
          window. All pages appear as thumbnails in <strong>Organize</strong> mode; double-click a
          page to <strong>Edit</strong> it.
        </p>
        <p>
          Nothing changes in your original files. When you are done, use <strong>Export PDF</strong>{' '}
          (<kbd>Ctrl</kbd>+<kbd>S</kbd>) to download a new PDF containing the current pages and
          edits.
        </p>
      </>
    ),
  },
  {
    id: 'local',
    title: 'Privacy & local processing',
    content: (
      <>
        <p>
          All processing — opening, rendering, editing, converting and exporting — happens on your
          computer, inside this browser tab. <strong>Files are never uploaded</strong>, file names
          are never sent anywhere, and there is no analytics or telemetry. The page's
          Content-Security-Policy blocks network access to other hosts.
        </p>
        <p>
          Open documents live only in the tab's memory. They are not saved to browser storage;
          closing or reloading the tab discards them. Downloaded results are saved wherever your
          browser saves downloads.
        </p>
      </>
    ),
  },
  {
    id: 'operations',
    title: 'Supported operations',
    content: (
      <>
        <h4>Pages (Organize mode)</h4>
        <ul>
          <li>Merge/combine: open several PDFs — their pages are appended; reorder freely.</li>
          <li>
            Reorder by dragging thumbnails (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+arrow keys).
          </li>
          <li>
            Select with click, <kbd>Ctrl</kbd>+click and <kbd>Shift</kbd>+click; <kbd>Ctrl</kbd>+
            <kbd>A</kbd> selects all.
          </li>
          <li>Rotate, duplicate and delete selected pages.</li>
          <li>
            Export selected pages only (extract), or split into several PDFs by page count or
            ranges.
          </li>
        </ul>
        <h4>Editing (Edit mode)</h4>
        <ul>
          <li>
            Text boxes, freehand drawing, highlights, rectangles, ellipses, lines, arrows, stamps,
            images and signatures.
          </li>
          <li>
            Move, resize, restyle (colour, size, line width, opacity, font, alignment) and delete
            items; undo/redo everything.
          </li>
          <li>
            Fill existing form fields (text, checkbox, radio, dropdown) directly on the page or in
            the Form panel; optionally flatten them on export.
          </li>
        </ul>
        <h4>Conversion & tools (More menu)</h4>
        <ul>
          <li>
            Images → PDF: PNG, JPEG and other browser-readable formats (WebP, GIF, BMP) become pages
            (A4, Letter or image size).
          </li>
          <li>Pages → images: PNG or JPEG at 72–300 dpi.</li>
          <li>Extract text from pages that contain real text.</li>
          <li>
            Extract embedded images (JPEG and common lossless images; exotic encodings are reported,
            not guessed).
          </li>
          <li>Reduce file size with three presets.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'redaction',
    title: 'Whiteout vs. redaction',
    content: (
      <>
        <p>
          <strong>Whiteout</strong> draws an opaque (white) box on top of the page. It is useful to
          cover something visually, for example before typing replacement text over it.{' '}
          <strong>The original content stays in the file</strong>: it can still be selected, copied,
          searched, or revealed by removing the box in another editor. Never use whiteout to hide
          sensitive information.
        </p>
        <p>
          <strong>Redact</strong> marks areas for secure removal. When you export, every page that
          has a redaction mark is re-created as an image (200 dpi) in which the marked areas are
          solid black. The page's original text, fonts, images, links and form data are not copied
          into the exported file, so nothing under the black boxes can be recovered from it. The
          trade-offs: text on redacted pages is no longer selectable or searchable, the pages may be
          larger, and the document's form fields are flattened.
        </p>
        <p>
          Always check the exported file before sharing it. Redaction only applies to what you mark
          — review every page.
        </p>
      </>
    ),
  },
  {
    id: 'text',
    title: 'Editing existing text',
    content: (
      <>
        <p>
          PDF Toolbox does <strong>not</strong> edit the existing text of a PDF. In a PDF, text is
          usually stored as individually positioned glyphs, split into fragments, using embedded
          (often subsetted) fonts — changing it reliably is not generally possible without the
          original document.
        </p>
        <p>Instead, existing content is treated as the page background. To change a word:</p>
        <ol>
          <li>
            Cover it with a <strong>Whiteout</strong> box (or a text box with a white background).
          </li>
          <li>
            Add a <strong>Text box</strong> with the replacement text on top.
          </li>
        </ol>
        <p>
          This is a visual change: the original text remains in the file underneath (see Whiteout
          vs. redaction). Added text uses the standard PDF fonts (Helvetica, Times, Courier), which
          cover Western European characters only.
        </p>
      </>
    ),
  },
  {
    id: 'ocr',
    title: 'Scanned documents (no OCR)',
    content: (
      <p>
        Scanned PDFs contain pictures of pages without a text layer. Text extraction can only return
        text that already exists in the PDF, so scanned pages yield no text — PDF Toolbox tells you
        when a page appears to be image-only. Optical character recognition (OCR) is not included in
        this version.
      </p>
    ),
  },
  {
    id: 'signatures',
    title: 'Signatures',
    content: (
      <p>
        The signature tool places a picture of your signature (drawn, typed or uploaded) on the
        page. This is a visual mark like a signature on paper — it is <strong>not</strong> a
        cryptographic digital signature and does not prove who signed the document or that it was
        not changed afterwards. Certificate-based signing is not supported.
      </p>
    ),
  },
  {
    id: 'limits',
    title: 'Limits & large files',
    content: (
      <>
        <p>
          Everything runs within the memory available to one browser tab. Pages are rendered lazily
          (only visible thumbnails, at most two at a time) and caches are bounded, so documents with
          hundreds of pages work, but very large files (hundreds of MB, thousands of pages, huge
          scans) can exhaust memory — you will see an error message rather than a result. Closing
          other tabs or processing fewer documents at once helps.
        </p>
        <ul>
          <li>
            Encrypted / password-protected PDFs cannot be edited (protection is never bypassed).
          </li>
          <li>XFA (dynamic) forms are not supported; standard AcroForm fields are.</li>
          <li>JavaScript inside PDFs is never executed.</li>
          <li>
            Merging documents keeps page content, links and form fields; bookmarks (outlines) are
            not carried over.
          </li>
          <li>Size reduction is simpler than Acrobat's optimiser and results vary.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'keys',
    title: 'Keyboard shortcuts',
    content: (
      <ul>
        <li>
          <kbd>Ctrl</kbd>+<kbd>O</kbd> open/add files · <kbd>Ctrl</kbd>+<kbd>S</kbd> export PDF ·{' '}
          <kbd>F1</kbd> help
        </li>
        <li>
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> /{' '}
          <kbd>Ctrl</kbd>+<kbd>Y</kbd> redo
        </li>
        <li>
          Organize: arrows move, <kbd>Space</kbd> toggles selection, <kbd>Enter</kbd> edits,{' '}
          <kbd>Delete</kbd> removes, <kbd>[</kbd> / <kbd>]</kbd> rotate, <kbd>Ctrl</kbd>+
          <kbd>Shift</kbd>+arrows move pages
        </li>
        <li>
          Edit: <kbd>V</kbd> select, <kbd>T</kbd> text, <kbd>D</kbd> draw, <kbd>H</kbd> highlight,{' '}
          <kbd>R</kbd> rectangle, <kbd>O</kbd> ellipse, <kbd>L</kbd> line, <kbd>A</kbd> arrow,{' '}
          <kbd>S</kbd> stamp, <kbd>W</kbd> whiteout, <kbd>X</kbd> redact
        </li>
        <li>
          Edit: <kbd>Page Up</kbd>/<kbd>Page Down</kbd> previous/next page, <kbd>Delete</kbd>{' '}
          removes the selected item, arrows nudge it, <kbd>Enter</kbd> edits text, <kbd>Esc</kbd>{' '}
          deselects
        </li>
      </ul>
    ),
  },
];
