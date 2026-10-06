import { useState } from 'react';
import { Dialog } from '@shared/react/Dialog';

interface PromptState {
  title: string;
  label: string;
  initial: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
}

/** Small text prompt (rename / new folder / new collection). */
export function PromptDialog({
  state,
  onClose,
}: {
  state: PromptState | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [current, setCurrent] = useState<PromptState | null>(null);
  if (state !== current) {
    setCurrent(state);
    if (state) setValue(state.initial);
  }
  return (
    <Dialog
      open={!!state}
      onClose={onClose}
      title={state?.title ?? ''}
      testId="prompt-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="prompt-form"
            className="btn btn--primary"
            disabled={!value.trim()}
            data-testid="prompt-confirm"
          >
            {state?.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <form
        id="prompt-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim() || !state) return;
          state.onSubmit(value.trim());
          onClose();
        }}
      >
        <div className="field">
          <label htmlFor="prompt-input">{state?.label}</label>
          <input
            id="prompt-input"
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            data-testid="prompt-input"
          />
        </div>
      </form>
    </Dialog>
  );
}

export type { PromptState };

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!state}
      onClose={onClose}
      title={state?.title ?? ''}
      testId="confirm-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${state?.danger ? 'btn--danger' : 'btn--primary'}`}
            data-testid="confirm-ok"
            onClick={() => {
              state?.onConfirm();
              onClose();
            }}
            autoFocus
          >
            {state?.confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{state?.message}</p>
    </Dialog>
  );
}

export type { ConfirmState };
