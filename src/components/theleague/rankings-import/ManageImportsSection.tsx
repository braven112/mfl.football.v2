import { useState } from 'react';
import { deleteImport } from '../../../utils/rankings-storage';
import type { StoredRankingImport } from '../../../types/rankings-import';
import { SOURCE_LABELS } from '../../../utils/rankings-lookup';
import ImportDetailModal from './ImportDetailModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';

interface Props {
  imports: StoredRankingImport[];
  onDelete: (id: string) => void;
}

export default function ManageImportsSection({ imports, onDelete }: Props) {
  const [selectedImport, setSelectedImport] = useState<StoredRankingImport | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredRankingImport | null>(null);

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      deleteImport(deleteTarget.id);
      onDelete(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <section className="ri-section">
      <h2 className="ri-section__title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        Saved Rankings
      </h2>

      {imports.length === 0 ? (
        <p className="ri-section__empty">No rankings imported yet. Use a bookmarklet above to get started.</p>
      ) : (
        <div className="ri-manage__table-wrap">
          <table className="ri-manage__table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Date</th>
                <th>Players</th>
                <th>Match Rate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr key={imp.id}>
                  <td className="ri-manage__source">{SOURCE_LABELS[imp.source] || imp.source}</td>
                  <td>
                    <span className={`ri-manage__type ri-manage__type--${imp.type}`}>
                      {imp.type}
                    </span>
                  </td>
                  <td>{new Date(imp.importDate).toLocaleDateString()}</td>
                  <td>{imp.stats.total}</td>
                  <td>
                    <span className={`ri-manage__rate ${imp.stats.matchRate >= 90 ? 'ri-manage__rate--good' : imp.stats.matchRate >= 70 ? 'ri-manage__rate--ok' : 'ri-manage__rate--low'}`}>
                      {imp.stats.matchRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="ri-manage__actions">
                    <button
                      type="button"
                      className="ri-btn ri-btn--sm"
                      onClick={() => setSelectedImport(imp)}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="ri-btn ri-btn--sm ri-btn--danger"
                      onClick={() => setDeleteTarget(imp)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedImport && (
        <ImportDetailModal
          importData={selectedImport}
          onClose={() => setSelectedImport(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          itemName={`${SOURCE_LABELS[deleteTarget.source] || deleteTarget.source} ${deleteTarget.type} rankings`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}
