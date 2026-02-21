import { useEffect, useRef } from 'react';

interface Props {
  /** Short description of what's being deleted, e.g. "FantasyPros dynasty rankings" */
  itemName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation dialog for delete actions.
 * Uses the native <dialog> element with showModal() for proper
 * focus trapping and backdrop behavior.
 */
export default function ConfirmDeleteModal({ itemName, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="ri-modal ri-modal--confirm"
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel();
      }}
    >
      <div className="ri-modal__content">
        <div className="ri-modal__header">
          <h3>Confirm Delete</h3>
          <button type="button" className="ri-modal__close" onClick={onCancel} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="ri-modal__body">
          <p>
            Are you sure you want to delete <strong>{itemName}</strong>?
          </p>
          <p className="ri-modal__hint">
            This will remove the ranking data from your browser. Rankings columns on the Free Agents
            page will update automatically.
          </p>
        </div>

        <div className="ri-modal__footer ri-modal__footer--actions">
          <button type="button" className="ri-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ri-btn ri-btn--danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </dialog>
  );
}
