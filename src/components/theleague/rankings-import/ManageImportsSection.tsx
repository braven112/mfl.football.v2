import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { deleteImport, reorderImports } from '../../../utils/rankings-storage';
import type { StoredRankingImport } from '../../../types/rankings-import';
import { SOURCE_LABELS } from '../../../utils/rankings-lookup';
import ImportDetailModal from './ImportDetailModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';

interface Props {
  imports: StoredRankingImport[];
  onDelete: (id: string) => void;
  onReorder: () => void;
}

export default function ManageImportsSection({ imports, onDelete, onReorder }: Props) {
  const [selectedImport, setSelectedImport] = useState<StoredRankingImport | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredRankingImport | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = imports.findIndex((imp) => imp.id === active.id);
      const newIndex = imports.findIndex((imp) => imp.id === over.id);
      const reordered = arrayMove(imports, oldIndex, newIndex);
      reorderImports(reordered.map((imp) => imp.id));
      onReorder();
    }
  };

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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="ri-manage__table-wrap">
            <table className="ri-manage__table">
              <thead>
                <tr>
                  <th className="ri-manage__drag-col" aria-label="Reorder"></th>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Players</th>
                  <th>Match Rate</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <SortableContext items={imports.map((imp) => imp.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {imports.map((imp) => (
                    <SortableRow
                      key={imp.id}
                      imp={imp}
                      onView={setSelectedImport}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </div>
        </DndContext>
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

// ---------------------------------------------------------------------------
// Sortable row
// ---------------------------------------------------------------------------

interface SortableRowProps {
  imp: StoredRankingImport;
  onView: (imp: StoredRankingImport) => void;
  onDelete: (imp: StoredRankingImport) => void;
}

function SortableRow({ imp, onView, onDelete }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: imp.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <tr ref={setNodeRef} style={style} className={isDragging ? 'ri-manage__row--dragging' : undefined}>
      <td className="ri-manage__drag-handle" {...attributes} {...listeners}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="5" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="9" cy="19" r="1.5" />
          <circle cx="15" cy="5" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="15" cy="19" r="1.5" />
        </svg>
      </td>
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
          onClick={() => onView(imp)}
        >
          View
        </button>
        <button
          type="button"
          className="ri-btn ri-btn--sm ri-btn--danger"
          onClick={() => onDelete(imp)}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
