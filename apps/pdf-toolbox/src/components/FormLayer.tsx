import { useEffect, useRef, useState } from 'react';
import { boxPageToView } from '../core/geometry';
import {
  effectiveRotation,
  type FormFieldInfo,
  type FormValue,
  type WorkspacePage,
} from '../core/types';
import { pdfDocument } from '../state/registry';
import { checkpoint, setFormValue, useStore } from '../state/store';

const NO_FIELDS: FormFieldInfo[] = [];

interface Widget {
  id: string;
  fieldName: string;
  fieldType: string;
  rect: [number, number, number, number];
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  buttonValue?: string;
  multiLine?: boolean;
  combo?: boolean;
  multiSelect?: boolean;
}

/** HTML inputs placed over the page's AcroForm widgets, bound to the workspace form values. */
export function FormLayer({ page, scale }: { page: WorkspacePage; scale: number }) {
  const [widgets, setWidgets] = useState<{ key: string; list: Widget[]; view: number[] }>({
    key: '',
    list: [],
    view: [0, 0, 0, 0],
  });
  const tool = useStore((s) => s.tool);
  const fields = useStore((s) => s.sources[page.sourceId]?.formFields ?? NO_FIELDS);
  const values = useStore((s) => s.formValues[page.sourceId]);
  const key = `${page.sourceId}:${page.sourceIndex}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = await pdfDocument(page.sourceId);
      const pdfPage = await doc.getPage(page.sourceIndex + 1);
      const annotations = (await pdfPage.getAnnotations({ intent: 'display' })) as Array<
        Widget & { subtype: string }
      >;
      if (cancelled) return;
      setWidgets({
        key,
        list: annotations.filter(
          (a) => a.subtype === 'Widget' && a.fieldName && !a.pushButton && a.fieldType !== 'Sig',
        ),
        view: pdfPage.view,
      });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, page.sourceId, page.sourceIndex]);

  if (widgets.key !== key || !widgets.list.length) return null;
  const rotation = effectiveRotation(page);
  const [vx1, , , vy2] = widgets.view;
  const byName = new Map(fields.map((f) => [f.name, f]));

  return (
    <div
      className={`form-layer${tool === 'select' ? '' : ' form-layer--inactive'}`}
      data-testid="form-layer"
    >
      {widgets.list.map((w) => {
        const field = byName.get(w.fieldName);
        if (!field) return null;
        const [x1, y1, x2, y2] = w.rect;
        const pageBox = {
          x: Math.min(x1, x2) - vx1,
          y: vy2 - Math.max(y1, y2),
          w: Math.abs(x2 - x1),
          h: Math.abs(y2 - y1),
        };
        const b = boxPageToView(pageBox, page.size.width, page.size.height, rotation);
        const style = {
          left: b.x * scale,
          top: b.y * scale,
          width: b.w * scale,
          height: b.h * scale,
          fontSize: Math.max(8, Math.min(16, b.h * scale * 0.6)),
        };
        const value = values?.[field.name] ?? field.value;
        return (
          <FieldInput
            key={w.id}
            widget={w}
            field={field}
            value={value}
            style={style}
            sourceId={page.sourceId}
          />
        );
      })}
    </div>
  );
}

function FieldInput({
  widget,
  field,
  value,
  style,
  sourceId,
}: {
  widget: Widget;
  field: FormFieldInfo;
  value: FormValue;
  style: React.CSSProperties;
  sourceId: string;
}) {
  const typing = useRef(false);
  const label = `Form field ${field.name}`;
  const set = (v: FormValue, record = true) => setFormValue(sourceId, field.name, v, record);
  const common = {
    className: 'form-field',
    style,
    disabled: field.readOnly,
    title: field.name,
    'aria-label': label,
    'data-field': field.name,
  };
  if (field.type === 'text') {
    const onFocus = () => {
      typing.current = false;
    };
    const onChange = (text: string) => {
      if (!typing.current) {
        checkpoint();
        typing.current = true;
      }
      set(text, false);
    };
    return widget.multiLine || field.multiline ? (
      <textarea
        {...common}
        value={String(value ?? '')}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : (
      <input
        {...common}
        type="text"
        value={String(value ?? '')}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'checkbox') {
    return (
      <label {...common} className="form-field form-field--check">
        <input
          type="checkbox"
          checked={value === true}
          disabled={field.readOnly}
          aria-label={label}
          onChange={(e) => set(e.target.checked)}
        />
      </label>
    );
  }
  if (field.type === 'radio') {
    const state = widget.buttonValue ?? '';
    const option = field.stateToOption?.[state] ?? state;
    return (
      <label {...common} className="form-field form-field--check">
        <input
          type="radio"
          name={`${sourceId}:${field.name}`}
          checked={value === option}
          disabled={field.readOnly}
          aria-label={`${label}: ${option}`}
          onChange={() => set(option)}
        />
      </label>
    );
  }
  if (field.type === 'dropdown') {
    return (
      <select {...common} value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'optionlist') {
    const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
    return (
      <select
        {...common}
        multiple
        value={selected}
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
  return null;
}
