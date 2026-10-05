import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useSyncExternalStore } from 'react';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Shows a transient notification. Errors stay longer so they can be read. */
export function toast(message: string, kind: ToastKind = 'info', durationMs?: number) {
  const id = nextId++;
  toasts = [...toasts.slice(-4), { id, kind, message }];
  emit();
  const duration = durationMs ?? (kind === 'error' ? 9000 : kind === 'warning' ? 7000 : 3500);
  setTimeout(() => dismissToast(id), duration);
  return id;
}

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export function Toasts() {
  const items = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div key={item.id} className={`toast toast--${item.kind}`} data-testid="toast">
            <Icon aria-hidden width={18} height={18} />
            <span className="toast__message">{item.message}</span>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(item.id)}
            >
              <X aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
