/**
 * ConfirmDialog — centered modal for destructive or irreversible actions.
 *
 * Matches the site's modal tokens (--dr-modal-*) already defined on the
 * .draft-room scope in draft-room.css. Handles ESC-to-cancel, outside-
 * click-to-cancel, focus into the dialog on mount, and restores body
 * scroll on unmount.
 */

import React, { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button red + aria-describes destructive intent. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', handleKey);
    };
  }, [onCancel]);

  return (
    <div
      className="dr-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dr-confirm-title"
      onClick={onCancel}
    >
      <div
        className="dr-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dr-confirm-title" className="dr-confirm-dialog__title">{title}</h2>
        <p className="dr-confirm-dialog__body">{message}</p>
        <div className="dr-confirm-dialog__actions">
          <button
            type="button"
            onClick={onCancel}
            className="dr-confirm-dialog__cancel"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={
              destructive
                ? 'dr-confirm-dialog__confirm dr-confirm-dialog__confirm--destructive'
                : 'dr-confirm-dialog__confirm'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
