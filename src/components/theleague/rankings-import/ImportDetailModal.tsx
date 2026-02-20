import { useEffect, useRef } from 'react';
import type { StoredRankingImport } from '../../../types/rankings-import';
import { SOURCE_LABELS } from '../../../utils/rankings-lookup';

interface Props {
  importData: StoredRankingImport;
  onClose: () => void;
}

export default function ImportDetailModal({ importData, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const matched = importData.rankings.filter((r) => r.matched);
  const unmatched = importData.rankings.filter((r) => !r.matched);

  return (
    <dialog ref={dialogRef} className="ri-modal" onClick={(e) => {
      if (e.target === dialogRef.current) onClose();
    }}>
      <div className="ri-modal__content">
        <div className="ri-modal__header">
          <h3>{SOURCE_LABELS[importData.source] || importData.source} — {importData.type}</h3>
          <button type="button" className="ri-modal__close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="ri-modal__meta">
          <span>Imported: {new Date(importData.importDate).toLocaleString()}</span>
          <span>{importData.stats.total} players</span>
          <span>{importData.stats.matchRate.toFixed(1)}% matched</span>
        </div>

        {unmatched.length > 0 && (
          <div className="ri-modal__section">
            <h4>Unmatched Players ({unmatched.length})</h4>
            <div className="ri-modal__table-wrap">
              <table className="ri-modal__table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Pos</th>
                    <th>Team</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((r, i) => (
                    <tr key={i}>
                      <td>{r.rank}</td>
                      <td>{r.playerName}</td>
                      <td>{r.position}</td>
                      <td>{r.team}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="ri-modal__section">
          <h4>Matched Players ({matched.length})</h4>
          <div className="ri-modal__table-wrap">
            <table className="ri-modal__table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th>Pos</th>
                  <th>Team</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((r, i) => (
                  <tr key={i}>
                    <td>{r.rank}</td>
                    <td>{r.playerName}</td>
                    <td>{r.position}</td>
                    <td>{r.team}</td>
                    <td>{(r.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="ri-modal__footer">
          <button type="button" className="ri-btn ri-btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
