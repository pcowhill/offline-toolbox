import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardCopy,
  ScanText,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyToClipboard } from '@shared/lib/download';
import { EmptyState } from '@shared/react/EmptyState';
import { Tabs } from '@shared/react/Tabs';
import { toast } from '@shared/react/toasts';
import type {
  Annotation,
  FontFamily,
  FormFieldInfo,
  FormValue,
  TextAlign,
  WorkspacePage,
} from '../core/types';
import { extractPageText } from '../pdf/pdfjs';
import { pdfDocument } from '../state/registry';
import {
  checkpoint,
  deleteAnnotation,
  reorderAnnotation,
  setFlattenForms,
  setFormValue,
  setStyle,
  updateAnnotation,
  useStore,
  type Tool,
  type ToolStyle,
} from '../state/store';

type Panel = 'properties' | 'form' | 'text';

const TOOL_NAMES: Record<Tool, string> = {
  select: 'Select',
  text: 'Text box',
  ink: 'Freehand drawing',
  highlight: 'Highlight',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  whiteout: 'Whiteout',
  redact: 'Redaction',
  stamp: 'Stamp',
  image: 'Image / signature',
};

const TYPE_NAMES: Record<Annotation['type'], string> = {
  text: 'Text box',
  stamp: 'Stamp',
  image: 'Image',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  highlight: 'Highlight',
  whiteout: 'Whiteout',
  redact: 'Redaction mark',
  line: 'Line',
  arrow: 'Arrow',
  ink: 'Freehand drawing',
};

export const STAMPS = [
  'APPROVED',
  'REVIEWED',
  'DRAFT',
  'CONFIDENTIAL',
  'FINAL',
  'VOID',
  'RECEIVED',
  'NOT APPROVED',
];

export function Inspector({ page }: { page: WorkspacePage | undefined }) {
  const [panel, setPanel] = useState<Panel>('properties');
  const hasForms = useStore((s) =>
    Object.values(s.sources).some((src) => src.formFields.length > 0),
  );
  return (
    <aside className="inspector" aria-label="Inspector">
      <Tabs<Panel>
        label="Inspector"
        value={panel}
        onChange={setPanel}
        items={[
          { id: 'properties', label: 'Properties', testId: 'panel-properties' },
          { id: 'form', label: hasForms ? 'Form •' : 'Form', testId: 'panel-form' },
          { id: 'text', label: 'Text', testId: 'panel-text' },
        ]}
      />
      <div className="inspector__body">
        {panel === 'properties' && <PropertiesPanel page={page} />}
        {panel === 'form' && <FormPanel />}
        {panel === 'text' && page && <TextPanel key={page.id} page={page} />}
      </div>
    </aside>
  );
}

function ColorField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <label className="prop">
      <span className="prop__label">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="prop">
      <span className="prop__label">{label}</span>
      <input
        className="input prop__number"
        type="number"
        value={Number(value.toFixed(2))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      />
    </label>
  );
}

function OpacityField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="prop">
      <span className="prop__label">Opacity</span>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="prop__value">{Math.round(value * 100)}%</span>
    </label>
  );
}

function TextStyleFields({
  font,
  size,
  bold,
  align,
  onChange,
}: {
  font: FontFamily;
  size: number;
  bold: boolean;
  align: TextAlign;
  onChange: (p: {
    font?: FontFamily;
    fontSize?: number;
    bold?: boolean;
    align?: TextAlign;
  }) => void;
}) {
  return (
    <>
      <label className="prop">
        <span className="prop__label">Font</span>
        <select
          className="select"
          value={font}
          onChange={(e) => onChange({ font: e.target.value as FontFamily })}
        >
          <option value="Helvetica">Sans (Helvetica)</option>
          <option value="Times">Serif (Times)</option>
          <option value="Courier">Mono (Courier)</option>
        </select>
      </label>
      <NumberField
        label="Size"
        value={size}
        min={4}
        max={144}
        onChange={(fontSize) => onChange({ fontSize })}
      />
      <label className="prop">
        <span className="prop__label">Style</span>
        <label className="check">
          <input
            type="checkbox"
            checked={bold}
            onChange={(e) => onChange({ bold: e.target.checked })}
          />{' '}
          Bold
        </label>
      </label>
      <label className="prop">
        <span className="prop__label">Align</span>
        <select
          className="select"
          value={align}
          onChange={(e) => onChange({ align: e.target.value as TextAlign })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
    </>
  );
}

function PropertiesPanel({ page }: { page: WorkspacePage | undefined }) {
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const selectedId = useStore((s) => s.selectedAnnotationId);
  const annotation = page?.annotations.find((a) => a.id === selectedId);

  if (annotation && page) {
    const update = (patch: Partial<Annotation>) =>
      updateAnnotation(page.id, annotation.id, patch, true);
    return (
      <div className="props" data-testid="annotation-properties">
        <h3 className="props__title">{TYPE_NAMES[annotation.type]}</h3>
        {annotation.type === 'whiteout' && <WhiteoutNotice />}
        {annotation.type === 'redact' && <RedactNotice />}
        {annotation.type === 'text' && (
          <>
            <label className="prop prop--stack">
              <span className="prop__label">Text</span>
              <textarea
                className="textarea"
                rows={3}
                value={annotation.text}
                onFocus={() => checkpoint()}
                onChange={(e) => updateAnnotation(page.id, annotation.id, { text: e.target.value })}
              />
            </label>
            <TextStyleFields
              font={annotation.font}
              size={annotation.fontSize}
              bold={annotation.bold}
              align={annotation.align}
              onChange={(p) => update(p)}
            />
            <ColorField
              label="Colour"
              value={annotation.color}
              onChange={(color) => update({ color })}
            />
            <label className="prop">
              <span className="prop__label">Background</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={annotation.background !== null}
                  onChange={(e) => update({ background: e.target.checked ? '#ffffff' : null })}
                />{' '}
                Fill
              </label>
              {annotation.background !== null && (
                <input
                  type="color"
                  value={annotation.background}
                  onChange={(e) => update({ background: e.target.value })}
                />
              )}
            </label>
          </>
        )}
        {annotation.type === 'stamp' && (
          <>
            <label className="prop">
              <span className="prop__label">Text</span>
              <input
                className="input"
                list="stamp-texts"
                value={annotation.text}
                onChange={(e) => update({ text: e.target.value })}
              />
            </label>
            <ColorField
              label="Colour"
              value={annotation.color}
              onChange={(color) => update({ color })}
            />
          </>
        )}
        {(annotation.type === 'rect' || annotation.type === 'ellipse') && (
          <>
            <label className="prop">
              <span className="prop__label">Stroke</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={annotation.stroke !== null}
                  onChange={(e) => update({ stroke: e.target.checked ? '#1d4ed8' : null })}
                />{' '}
                Outline
              </label>
              {annotation.stroke !== null && (
                <input
                  type="color"
                  value={annotation.stroke}
                  onChange={(e) => update({ stroke: e.target.value })}
                />
              )}
            </label>
            <label className="prop">
              <span className="prop__label">Fill</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={annotation.fill !== null}
                  onChange={(e) => update({ fill: e.target.checked ? '#bfdbfe' : null })}
                />{' '}
                Fill
              </label>
              {annotation.fill !== null && (
                <input
                  type="color"
                  value={annotation.fill}
                  onChange={(e) => update({ fill: e.target.value })}
                />
              )}
            </label>
            <NumberField
              label="Line width"
              value={annotation.lineWidth}
              min={0.25}
              max={40}
              step={0.5}
              onChange={(lineWidth) => update({ lineWidth })}
            />
          </>
        )}
        {(annotation.type === 'line' ||
          annotation.type === 'arrow' ||
          annotation.type === 'ink') && (
          <>
            <ColorField
              label="Colour"
              value={annotation.stroke}
              onChange={(stroke) => update({ stroke })}
            />
            <NumberField
              label="Line width"
              value={annotation.lineWidth}
              min={0.25}
              max={40}
              step={0.5}
              onChange={(lineWidth) => update({ lineWidth })}
            />
          </>
        )}
        {annotation.type === 'highlight' && (
          <ColorField
            label="Colour"
            value={annotation.color}
            onChange={(color) => update({ color })}
          />
        )}
        {annotation.type === 'whiteout' && (
          <ColorField
            label="Cover colour"
            value={annotation.color}
            onChange={(color) => update({ color })}
          />
        )}
        {annotation.type !== 'whiteout' && annotation.type !== 'redact' && (
          <OpacityField value={annotation.opacity} onChange={(opacity) => update({ opacity })} />
        )}
        <div className="toolbar props__actions">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => reorderAnnotation(page.id, annotation.id, true)}
            title="Bring to front"
          >
            <ArrowUpToLine aria-hidden /> Front
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => reorderAnnotation(page.id, annotation.id, false)}
            title="Send to back"
          >
            <ArrowDownToLine aria-hidden /> Back
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => deleteAnnotation(page.id, annotation.id)}
            data-testid="delete-annotation"
          >
            <Trash2 aria-hidden /> Delete
          </button>
        </div>
        <p className="muted props__hint">
          Drag to move, drag the handles to resize. Arrow keys nudge (Shift = 10 pt). Delete
          removes.
        </p>
      </div>
    );
  }

  const set = (patch: Partial<ToolStyle>) => setStyle(patch);
  return (
    <div className="props">
      <h3 className="props__title">{TOOL_NAMES[tool]}</h3>
      {tool === 'select' && (
        <p className="muted">
          Choose a tool in the toolbar to add text, drawings, highlights, shapes, stamps, images or
          signatures. Select an item on the page to change it. Form fields can be filled directly on
          the page.
        </p>
      )}
      {tool === 'text' && (
        <>
          <TextStyleFields
            font={style.font}
            size={style.fontSize}
            bold={style.bold}
            align={style.align}
            onChange={(p) => set(p as Partial<ToolStyle>)}
          />
          <ColorField
            label="Colour"
            value={style.color}
            onChange={(color) => set({ color })}
            testId="style-color"
          />
          <p className="muted props__hint">
            Click on the page to add a text box, or drag to size it. Characters beyond Western
            European (Windows-1252) are not supported by the standard PDF fonts.
          </p>
        </>
      )}
      {(tool === 'ink' ||
        tool === 'line' ||
        tool === 'arrow' ||
        tool === 'rect' ||
        tool === 'ellipse') && (
        <>
          <ColorField
            label={tool === 'rect' || tool === 'ellipse' ? 'Outline' : 'Colour'}
            value={style.color}
            onChange={(color) => set({ color })}
            testId="style-color"
          />
          {(tool === 'rect' || tool === 'ellipse') && (
            <label className="prop">
              <span className="prop__label">Fill</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={style.fill !== null}
                  onChange={(e) => set({ fill: e.target.checked ? '#bfdbfe' : null })}
                />{' '}
                Fill
              </label>
              {style.fill !== null && (
                <input
                  type="color"
                  value={style.fill}
                  onChange={(e) => set({ fill: e.target.value })}
                />
              )}
            </label>
          )}
          <NumberField
            label="Line width"
            value={style.lineWidth}
            min={0.25}
            max={40}
            step={0.5}
            onChange={(lineWidth) => set({ lineWidth })}
          />
          <OpacityField value={style.opacity} onChange={(opacity) => set({ opacity })} />
        </>
      )}
      {tool === 'highlight' && (
        <ColorField
          label="Colour"
          value={style.highlightColor}
          onChange={(highlightColor) => set({ highlightColor })}
        />
      )}
      {tool === 'whiteout' && <WhiteoutNotice />}
      {tool === 'redact' && <RedactNotice />}
      {tool === 'stamp' && (
        <>
          <label className="prop">
            <span className="prop__label">Stamp</span>
            <input
              className="input"
              list="stamp-texts"
              value={style.stampText}
              onChange={(e) => set({ stampText: e.target.value })}
              data-testid="stamp-text"
            />
          </label>
          <ColorField
            label="Colour"
            value={style.stampColor}
            onChange={(stampColor) => set({ stampColor })}
          />
          <p className="muted props__hint">Click on the page to place the stamp.</p>
        </>
      )}
      {tool === 'image' && (
        <p className="muted">
          Click or drag on the page to place the chosen image. Corner handles keep its proportions.
        </p>
      )}
      <datalist id="stamp-texts">
        {STAMPS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

function WhiteoutNotice() {
  return (
    <div className="notice notice--warning" data-testid="whiteout-notice">
      <TriangleAlert aria-hidden />
      <div>
        <p>
          <strong>Whiteout only hides content visually.</strong> The covered text and images remain
          in the PDF and can be copied, searched or revealed. Use <strong>Redact</strong> to remove
          information permanently.
        </p>
      </div>
    </div>
  );
}

function RedactNotice() {
  return (
    <div className="notice notice--info" data-testid="redact-notice">
      <TriangleAlert aria-hidden />
      <div>
        <p>
          <strong>Secure redaction.</strong> On export, every page with a redaction mark is
          converted into an image with the marked areas blacked out. The original text, images and
          form data of that page are not included in the exported file.
        </p>
        <p>
          Consequences: text on those pages is no longer selectable or searchable, and form fields
          of the document are flattened.
        </p>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  sourceId,
  value,
}: {
  field: FormFieldInfo;
  sourceId: string;
  value: FormValue;
}) {
  const set = (v: FormValue, record = true) => setFormValue(sourceId, field.name, v, record);
  const id = `field-${sourceId}-${field.name}`;
  switch (field.type) {
    case 'text':
      return field.multiline ? (
        <textarea
          id={id}
          className="textarea"
          rows={3}
          value={String(value ?? '')}
          disabled={field.readOnly}
          onFocus={() => checkpoint()}
          onChange={(e) => set(e.target.value, false)}
        />
      ) : (
        <input
          id={id}
          className="input"
          value={String(value ?? '')}
          disabled={field.readOnly}
          onFocus={() => checkpoint()}
          onChange={(e) => set(e.target.value, false)}
          data-testid={`form-input-${field.name}`}
        />
      );
    case 'checkbox':
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          disabled={field.readOnly}
          onChange={(e) => set(e.target.checked)}
          data-testid={`form-input-${field.name}`}
        />
      );
    case 'radio':
    case 'dropdown':
      return (
        <select
          id={id}
          className="select"
          value={String(value ?? '')}
          disabled={field.readOnly}
          onChange={(e) => set(e.target.value)}
          data-testid={`form-input-${field.name}`}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'optionlist': {
      const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
      return (
        <select
          id={id}
          className="select"
          multiple
          value={selected}
          disabled={field.readOnly}
          onChange={(e) => set(Array.from(e.target.selectedOptions, (o) => o.value))}
        >
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    default:
      return <span className="muted">{field.type} fields cannot be edited</span>;
  }
}

function FormPanel() {
  const sources = useStore((s) => s.sources);
  const pages = useStore((s) => s.pages);
  const formValues = useStore((s) => s.formValues);
  const flatten = useStore((s) => s.flattenForms);
  const used = new Set(pages.map((p) => p.sourceId));
  const withForms = Object.values(sources).filter((s) => used.has(s.id) && s.formFields.length > 0);
  if (!withForms.length) {
    return (
      <EmptyState title="No form fields" testId="no-form">
        The open documents contain no fillable (AcroForm) fields. XFA forms and creating new form
        fields are not supported.
      </EmptyState>
    );
  }
  return (
    <div className="form-panel" data-testid="form-panel">
      <label className="check form-panel__flatten">
        <input
          type="checkbox"
          checked={flatten}
          onChange={(e) => setFlattenForms(e.target.checked)}
          data-testid="flatten-forms"
        />
        Flatten fields on export (values become part of the page and can no longer be edited)
      </label>
      {withForms.map((source) => (
        <section key={source.id}>
          <h3 className="form-panel__source">{source.name}</h3>
          {source.formFields.map((field) => (
            <div key={field.name} className="form-panel__field">
              <label htmlFor={`field-${source.id}-${field.name}`}>
                {field.name}
                {field.required && <span className="required">*</span>}
              </label>
              <FieldControl
                field={field}
                sourceId={source.id}
                value={formValues[source.id]?.[field.name] ?? field.value}
              />
            </div>
          ))}
        </section>
      ))}
      <p className="muted props__hint">
        Values are written into the PDF when you export it. Text uses the standard PDF font, so
        non-Western characters may not display in every viewer.
      </p>
    </div>
  );
}

function TextPanel({ page }: { page: WorkspacePage }) {
  const [result, setResult] = useState<{ text: string; hasImages: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = await pdfDocument(page.sourceId);
      const pdfPage = await doc.getPage(page.sourceIndex + 1);
      const text = await extractPageText(pdfPage);
      if (!cancelled) setResult(text);
    })().catch((e: unknown) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [page.sourceId, page.sourceIndex]);
  if (error) return <p className="danger-text">{error}</p>;
  if (!result) return <p className="muted">Extracting text…</p>;
  if (!result.text) {
    return (
      <EmptyState
        icon={ScanText}
        title={
          result.hasImages ? 'This page appears to be a scanned image' : 'No text on this page'
        }
        testId="no-text"
      >
        {result.hasImages
          ? 'The page contains images but no text layer, so there is no text to extract. Optical character recognition (OCR) is not available in this version.'
          : 'This page has no extractable text.'}
      </EmptyState>
    );
  }
  return (
    <div className="text-panel">
      <div className="toolbar">
        <button
          type="button"
          className="btn btn--sm"
          onClick={async () =>
            toast(
              (await copyToClipboard(result.text))
                ? 'Text copied'
                : 'Could not access the clipboard',
              'success',
            )
          }
        >
          <ClipboardCopy aria-hidden /> Copy
        </button>
        <span className="muted">Original page text (edits are not included)</span>
      </div>
      <pre className="text-panel__text" data-testid="page-text">
        {result.text}
      </pre>
    </div>
  );
}
