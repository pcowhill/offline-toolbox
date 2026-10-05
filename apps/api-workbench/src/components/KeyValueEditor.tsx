import { GripVertical, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createKeyValue } from '../core/factory';
import type { KeyValue } from '../core/types';
import { VariableText } from './VariableText';

interface KeyValueEditorProps<T extends KeyValue> {
  rows: T[];
  onChange: (rows: T[]) => void;
  /** Creates a row of the right shape (used for the trailing "new row"). */
  createRow?: (partial: Partial<KeyValue>) => T;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  label: string;
  /** Custom value cell (e.g. file picker for multipart). */
  renderValue?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  /** Extra cell rendered before the delete button. */
  renderExtra?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  rowWarning?: (row: T) => string | undefined;
  testId?: string;
  allowBulk?: boolean;
  suggestions?: string[];
}

function toBulk(rows: KeyValue[]): string {
  return rows
    .filter((r) => r.key || r.value)
    .map((r) => `${r.enabled ? '' : '# '}${r.key}: ${r.value}`)
    .join('\n');
}

function fromBulk<T extends KeyValue>(
  text: string,
  previous: T[],
  createRow: (p: Partial<KeyValue>) => T,
): T[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      const disabled = /^\s*(#|\/\/)/.test(line);
      const content = line.replace(/^\s*(#|\/\/)\s?/, '');
      const colon = content.indexOf(':');
      const key = (colon >= 0 ? content.slice(0, colon) : content).trim();
      const value = colon >= 0 ? content.slice(colon + 1).trim() : '';
      const existing = previous[index];
      return existing
        ? { ...existing, key, value, enabled: !disabled }
        : createRow({ key, value, enabled: !disabled });
    });
}

/**
 * Editable key/value table with enable checkboxes. A blank trailing row is always present;
 * typing in it adds a new entry. Rows can be reordered by dragging the grip handle.
 */
export function KeyValueEditor<T extends KeyValue>({
  rows,
  onChange,
  createRow = (partial) => createKeyValue(partial) as T,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  label,
  renderValue,
  renderExtra,
  rowWarning,
  testId,
  allowBulk = true,
  suggestions,
}: KeyValueEditorProps<T>) {
  const [bulk, setBulk] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const listId = suggestions ? `kv-suggest-${label.replace(/\W+/g, '-')}` : undefined;

  const tableRef = useRef<HTMLTableElement>(null);
  // Typing into the blank "add" row creates a real row; focus follows into that row so the
  // rest of the typing lands there instead of creating one row per keystroke.
  const [focusRequest, setFocusRequest] = useState<{ id: string; field: 'key' | 'value' } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!focusRequest) return;
    const input = tableRef.current?.querySelector<HTMLInputElement>(
      `[data-row-id="${focusRequest.id}"][data-field="${focusRequest.field}"]`,
    );
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    setFocusRequest(null);
  }, [focusRequest]);

  const update = (id: string, patch: Partial<T>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  const addFrom = (patch: Partial<KeyValue>) => {
    const row = createRow({ enabled: true, ...patch });
    onChange([...rows, row]);
    setFocusRequest({ id: row.id, field: patch.value !== undefined ? 'value' : 'key' });
  };

  if (bulk !== null) {
    return (
      <div className="kv kv--bulk" data-testid={testId}>
        <div className="kv__toolbar">
          <span className="muted">
            One entry per line as <code>key: value</code>. Prefix with <code>#</code> to disable.
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              onChange(fromBulk(bulk, rows, createRow));
              setBulk(null);
            }}
          >
            Done
          </button>
        </div>
        <textarea
          className="textarea textarea--mono"
          rows={10}
          value={bulk}
          aria-label={`${label} (bulk edit)`}
          onChange={(e) => setBulk(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="kv" data-testid={testId}>
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <table className="kv__table" aria-label={label} ref={tableRef}>
        <thead>
          <tr>
            <th className="kv__col-grip" aria-hidden />
            <th className="kv__col-check">
              <span className="visually-hidden">Enabled</span>
            </th>
            <th>{keyPlaceholder}</th>
            <th>{valuePlaceholder}</th>
            {renderExtra && <th className="kv__col-extra" />}
            <th className="kv__col-actions">
              {allowBulk && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setBulk(toBulk(rows))}
                  title="Edit as text"
                >
                  Bulk edit
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const warning = rowWarning?.(row);
            return (
              <tr
                key={row.id}
                className={`${row.enabled ? '' : 'is-disabled'}${dragIndex === index ? ' is-dragging' : ''}`}
                onDragOver={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex === null || dragIndex === index) return;
                  const next = [...rows];
                  const [moved] = next.splice(dragIndex, 1);
                  next.splice(index, 0, moved);
                  onChange(next);
                  setDragIndex(null);
                }}
              >
                <td
                  className="kv__grip"
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(index);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/x-kv-row', row.id);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  title="Drag to reorder"
                >
                  <GripVertical aria-hidden />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    aria-label={`Enable ${row.key || 'row'}`}
                    onChange={(e) => update(row.id, { enabled: e.target.checked } as Partial<T>)}
                  />
                </td>
                <td>
                  <input
                    className="input input--mono kv__input"
                    value={row.key}
                    placeholder={keyPlaceholder}
                    aria-label={`${label} key`}
                    list={listId}
                    data-row-id={row.id}
                    data-field="key"
                    onChange={(e) => update(row.id, { key: e.target.value } as Partial<T>)}
                    title={warning}
                    aria-invalid={warning ? true : undefined}
                  />
                </td>
                <td>
                  {renderValue ? (
                    renderValue(row, (patch) => update(row.id, patch))
                  ) : (
                    <VariableInput
                      value={row.value}
                      placeholder={valuePlaceholder}
                      ariaLabel={`${label} value`}
                      rowId={row.id}
                      onChange={(value) => update(row.id, { value } as Partial<T>)}
                    />
                  )}
                </td>
                {renderExtra && <td>{renderExtra(row, (patch) => update(row.id, patch))}</td>}
                <td className="kv__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`Remove ${row.key || 'row'}`}
                    onClick={() => remove(row.id)}
                  >
                    <Trash2 aria-hidden />
                  </button>
                </td>
              </tr>
            );
          })}
          <tr className="kv__new">
            <td />
            <td />
            <td>
              <input
                className="input input--mono kv__input"
                value=""
                placeholder={rows.length ? 'Add…' : keyPlaceholder}
                aria-label={`New ${label} key`}
                list={listId}
                onChange={(e) => addFrom({ key: e.target.value })}
                data-testid={testId ? `${testId}-new-key` : undefined}
              />
            </td>
            <td>
              {!renderValue && (
                <input
                  className="input input--mono kv__input"
                  value=""
                  placeholder={valuePlaceholder}
                  aria-label={`New ${label} value`}
                  onChange={(e) => addFrom({ value: e.target.value })}
                />
              )}
            </td>
            {renderExtra && <td />}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  type?: string;
  testId?: string;
  className?: string;
  rowId?: string;
}

/** Text input that shows {{variables}} highlighted (overlay technique). */
export function VariableInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  type = 'text',
  testId,
  className,
  rowId,
}: VariableInputProps) {
  return (
    <div className={`var-input${className ? ` ${className}` : ''}`}>
      {type === 'text' && value.includes('{{') && (
        <div className="var-input__overlay" aria-hidden>
          <VariableText text={value} />
        </div>
      )}
      <input
        className={`input input--mono kv__input${type === 'text' && value.includes('{{') ? ' var-input__field--overlaid' : ''}`}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        data-row-id={rowId}
        data-field={rowId ? 'value' : undefined}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}
