/** Small confirmation modal (backdrop click / Escape cancels). */
import { useEffect } from 'react';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onCancel, onConfirm]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <span>{title}</span>
          <button className="dialog-close" onClick={onCancel}>
            ×
          </button>
        </div>
        <p className="confirm-message">{message}</p>
        <div className="confirm-buttons">
          <button className="confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirm-danger" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
