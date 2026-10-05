import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  testId?: string;
}

/**
 * Modal dialog built on the native <dialog> element, which provides focus trapping,
 * Escape-to-close and an accessible modal role without extra code.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  className,
  testId,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      onMouseDown={(event) => {
        // Click on the backdrop (the dialog element itself, outside its content) closes it.
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="dialog__header">
            <h2 className="dialog__title">{title}</h2>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X aria-hidden />
            </button>
          </div>
          <div className="dialog__body">{children}</div>
          {footer && <div className="dialog__footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
