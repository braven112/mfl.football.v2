import { useState, useEffect, useMemo } from 'react';
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
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  deleteImport,
  reorderImports,
  getAveragePosition,
  getCompositeConfig,
  toggleCompositeImport,
  setCompositeWeight,
} from '../../../utils/rankings-storage';
import type { StoredRankingImport, CompositeImportConfig } from '../../../types/rankings-import';
import { SOURCE_LABELS, AVERAGE_IMPORT_ID } from '../../../utils/rankings-lookup';
import ImportDetailModal from './ImportDetailModal';
import ConfirmDeleteModal from './ConfirmDeleteModal';

interface Props {
  imports: StoredRankingImport[];
  onDelete: (id: string) => void;
  onReorder: () => void;
}

/** A sortable item that is either a real import or the synthetic average row. */
type SortableItem =
  | { kind: 'import'; id: string; data: StoredRankingImport }
  | { kind: 'average'; id: typeof AVERAGE_IMPORT_ID };

export default function ManageImportsSection({ imports, onDelete, onReorder }: Props) {
  const [selectedImport, setSelectedImport] = useState<StoredRankingImport | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredRankingImport | null>(null);
  const [compositeMembers, setCompositeMembers] = useState<Map<string, CompositeImportConfig>>(
    () => {
      const config = getCompositeConfig();
      return new Map(config?.members.map((m) => [m.importId, m]) ?? []);
    },
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Refresh composite state when imports change (e.g. deletion may invalidate members)
  useEffect(() => {
    const config = getCompositeConfig();
    setCompositeMembers(new Map(config?.members.map((m) => [m.importId, m]) ?? []));
  }, [imports]);

  const showAverage = imports.length >= 2;
  const compositeActive = compositeMembers.size >= 2;

  // Build the combined sortable list: real imports + average at stored position
  const items: SortableItem[] = useMemo(() => {
    const realItems: SortableItem[] = imports.map((imp) => ({
      kind: 'import' as const,
      id: imp.id,
      data: imp,
    }));

    if (!showAverage) return realItems;

    const storedPos = getAveragePosition();
    const insertAt = Math.max(0, Math.min(storedPos, realItems.length));
    const result = [...realItems];
    result.splice(insertAt, 0, { kind: 'average', id: AVERAGE_IMPORT_ID });
    return result;
  }, [imports, showAverage]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      const reordered = arrayMove(items, oldIndex, newIndex);
      reorderImports(reordered.map((item) => item.id));
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

  const handleToggleComposite = (importId: string, included: boolean) => {
    toggleCompositeImport(importId, included);
    const config = getCompositeConfig();
    setCompositeMembers(new Map(config?.members.map((m) => [m.importId, m]) ?? []));
    // Read raw config to show members even when < 2 (UI shows checkboxes always)
    try {
      const raw = localStorage.getItem('rankings.compositeConfig');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.members) {
          setCompositeMembers(new Map(parsed.members.map((m: CompositeImportConfig) => [m.importId, m])));
        }
      } else if (!included) {
        setCompositeMembers(new Map());
      }
    } catch { /* ignore */ }
    onReorder();
  };

  const handleSetWeight = (importId: string, weight: 1 | 2 | 3) => {
    setCompositeWeight(importId, weight);
    const updated = new Map(compositeMembers);
    const member = updated.get(importId);
    if (member) {
      updated.set(importId, { ...member, weight });
      setCompositeMembers(updated);
    }
    onReorder();
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
      <p className="ri-section__note">
        Drag to reorder. Check the <strong>My Rank</strong> box to include a ranking in your composite. Adjust weight to give a source more influence.
      </p>

      {imports.length === 0 ? (
        <p className="ri-section__empty">No rankings imported yet. Use a bookmarklet above to get started.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={handleDragEnd}>
          {compositeActive && <CompositeInfoBar memberCount={compositeMembers.size} />}
          <div className="ri-manage__table-wrap">
            <table className="ri-manage__table">
              <thead>
                <tr>
                  <th className="ri-manage__drag-col" aria-label="Reorder"></th>
                  <th className="ri-manage__order-col">#</th>
                  <th className="ri-manage__composite-col">My Rank</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th className="ri-manage__weight-col">Weight</th>
                  <th>Date</th>
                  <th>Players</th>
                  <th>Match Rate</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {items.map((item, idx) =>
                    item.kind === 'average' ? (
                      <AverageRow key={AVERAGE_IMPORT_ID} imports={imports} order={idx + 1} />
                    ) : (
                      <SortableRow
                        key={item.id}
                        imp={item.data}
                        order={idx + 1}
                        onView={setSelectedImport}
                        onDelete={setDeleteTarget}
                        isCompositeMember={compositeMembers.has(item.id)}
                        compositeWeight={compositeMembers.get(item.id)?.weight ?? null}
                        onToggleComposite={handleToggleComposite}
                        onSetWeight={handleSetWeight}
                      />
                    ),
                  )}
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
// Composite info bar (shown above table when 2+ members selected)
// ---------------------------------------------------------------------------

function CompositeInfoBar({ memberCount }: { memberCount: number }) {
  return (
    <div className="ri-manage__composite-bar">
      <span className="ri-manage__composite-bar-label">My Rank</span>
      <span className="ri-manage__composite-bar-detail">
        Composite of {memberCount} ranking sources
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Average rank row (sortable but no view/delete)
// ---------------------------------------------------------------------------

interface AverageRowProps {
  imports: StoredRankingImport[];
  order: number;
}

function AverageRow({ imports, order }: AverageRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: AVERAGE_IMPORT_ID });

  // Count unique matched players across all imports
  const playerCount = useMemo(() => {
    const ids = new Set<string>();
    for (const imp of imports) {
      for (const entry of imp.rankings) {
        if (entry.matched && entry.playerId) ids.add(entry.playerId);
      }
    }
    return ids.size;
  }, [imports]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <tr ref={setNodeRef} style={style} className={`ri-manage__row--average${isDragging ? ' ri-manage__row--dragging' : ''}`}>
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
      <td className="ri-manage__order">{order}</td>
      <td className="ri-manage__composite-check"></td>
      <td className="ri-manage__source">Average Rank</td>
      <td>
        <span className="ri-manage__type ri-manage__type--overall">computed</span>
      </td>
      <td>—</td>
      <td>—</td>
      <td>{playerCount}</td>
      <td>—</td>
      <td className="ri-manage__actions"></td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Sortable row
// ---------------------------------------------------------------------------

interface SortableRowProps {
  imp: StoredRankingImport;
  order: number;
  onView: (imp: StoredRankingImport) => void;
  onDelete: (imp: StoredRankingImport) => void;
  isCompositeMember: boolean;
  compositeWeight: 1 | 2 | 3 | null;
  onToggleComposite: (importId: string, included: boolean) => void;
  onSetWeight: (importId: string, weight: 1 | 2 | 3) => void;
}

function SortableRow({ imp, order, onView, onDelete, isCompositeMember, compositeWeight, onToggleComposite, onSetWeight }: SortableRowProps) {
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
      <td className="ri-manage__order">{order}</td>
      <td className="ri-manage__composite-check">
        <input
          type="checkbox"
          checked={isCompositeMember}
          onChange={(e) => onToggleComposite(imp.id, e.target.checked)}
          aria-label={`Include ${SOURCE_LABELS[imp.source] || imp.source} in My Rank`}
        />
      </td>
      <td className="ri-manage__source">{SOURCE_LABELS[imp.source] || imp.source}</td>
      <td>
        <span className={`ri-manage__type ri-manage__type--${imp.type}`}>
          {imp.type}
        </span>
      </td>
      <td className="ri-manage__weight">
        {isCompositeMember ? (
          <div className="ri-manage__weight-picker">
            {([1, 2, 3] as const).map((w) => (
              <button
                key={w}
                type="button"
                className={`ri-manage__weight-btn${compositeWeight === w ? ' active' : ''}`}
                onClick={() => onSetWeight(imp.id, w)}
                aria-label={`Set weight to ${w}x`}
                aria-pressed={compositeWeight === w}
              >
                {w}x
              </button>
            ))}
          </div>
        ) : (
          <span className="na">—</span>
        )}
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
