/**
 * DraftQueuePanel — personal pre-draft pick queue.
 *
 * Drag-and-drop sortable list (via @dnd-kit) that persists to localStorage.
 * Supports "Sync to MFL" to overwrite the user's MFL draft board, and
 * a "Submit Pick" CTA when it's the user's turn.
 */

import React, { useCallback, useState } from 'react';
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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { DraftQueueItem, DraftRoomPlayer, DraftRoomPick } from '../../../types/draft-room';
import { QueueRow } from './QueueRow';

interface DraftQueuePanelProps {
  queue: DraftQueueItem[];
  players: Map<string, DraftRoomPlayer>;
  picks: DraftRoomPick[];
  isUserTurn: boolean;
  autoSubmit: boolean;
  isSyncingQueue: boolean;
  isSubmittingPick: boolean;
  submitError: string | null;
  onReorder: (oldIndex: number, newIndex: number) => void;
  onRemove: (id: string) => void;
  onSyncToMfl: () => void;
  onSubmitPick: (playerId: string) => void;
  onToggleAutoSubmit: () => void;
}

export function DraftQueuePanel({
  queue,
  players,
  picks,
  isUserTurn,
  autoSubmit,
  isSyncingQueue,
  isSubmittingPick,
  submitError,
  onReorder,
  onRemove,
  onSyncToMfl,
  onSubmitPick,
  onToggleAutoSubmit,
}: DraftQueuePanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const draftedIds = new Set(picks.filter((p) => p.playerId).map((p) => p.playerId));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = queue.findIndex((i) => i.id === active.id);
      const newIndex = queue.findIndex((i) => i.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(oldIndex, newIndex);
      }
    },
    [queue, onReorder]
  );

  // Top-of-queue player (for Submit Pick CTA)
  const topItem = queue.find((i) => !draftedIds.has(i.playerId));
  const topPlayer = topItem ? players.get(topItem.playerId) : undefined;

  const [syncSuccess, setSyncSuccess] = useState(false);

  const handleSyncToMfl = () => {
    setSyncSuccess(false);
    onSyncToMfl();
    // Brief success flash — panel parent sets isSyncingQueue=false when done
    setTimeout(() => setSyncSuccess(true), 1000);
    setTimeout(() => setSyncSuccess(false), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '0.5rem 0.75rem',
        borderBottom: '1px solid var(--content-border, #e2e8f0)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
              color: 'var(--color-gray-900, #111827)',
              paddingLeft: '0.625rem',
              borderLeft: '2px solid var(--color-primary, #1c497c)',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}>
              My Queue
            </span>
            {queue.length > 0 && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '1.25rem',
                height: '1.25rem',
                padding: '0 0.25rem',
                borderRadius: 'var(--radius-full, 9999px)',
                background: 'var(--color-primary, #1c497c)',
                color: '#ffffff',
                fontSize: '0.625rem',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {queue.length}
              </span>
            )}
          </div>

          {/* Sync to MFL button */}
          <button
            onClick={handleSyncToMfl}
            disabled={isSyncingQueue || queue.length === 0}
            title="Sync queue to your MFL draft board"
            className="dr-sync-btn"
            style={{
              padding: '0.25rem 0.625rem',
              border: '1px solid var(--content-border, #e2e8f0)',
              borderRadius: 'var(--radius-md, 0.5rem)',
              background: syncSuccess
                ? 'var(--color-success-light, #d1fae5)'
                : 'var(--color-gray-50, #f9fafb)',
              color: syncSuccess
                ? 'var(--color-success-dark, #065f46)'
                : 'var(--color-gray-600, #4b5563)',
              fontSize: '0.625rem',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              cursor: isSyncingQueue || queue.length === 0 ? 'not-allowed' : 'pointer',
              opacity: queue.length === 0 ? 0.4 : 1,
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {isSyncingQueue ? 'Syncing…' : syncSuccess ? '✓ Synced' : 'Sync to MFL'}
          </button>
        </div>

        {/* Auto-submit toggle */}
        <label className="dr-auto-submit-label" onClick={onToggleAutoSubmit} style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
          <div
            role="switch"
            aria-checked={autoSubmit}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleAutoSubmit(); } }}
            onClick={onToggleAutoSubmit}
            className="dr-auto-submit-switch"
            style={{
              position: 'relative',
              width: '2rem',
              height: '1.125rem',
              borderRadius: 'var(--radius-full, 9999px)',
              background: autoSubmit ? 'var(--color-primary, #1c497c)' : 'var(--color-gray-300, #d1d5db)',
              cursor: 'pointer',
              transition: 'background 0.2s ease',
              flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute',
              top: '0.125rem',
              left: autoSubmit ? '0.875rem' : '0.125rem',
              width: '0.875rem',
              height: '0.875rem',
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
              transition: 'left 0.2s ease',
            }} />
          </div>
          <span style={{
            fontSize: '0.6875rem',
            color: 'var(--color-gray-600, #4b5563)',
            fontWeight: 500,
          }}>
            Auto-pick from queue
          </span>
        </label>
      </div>

      {/* Queue list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {queue.length === 0 ? (
          <div style={{
            padding: '2rem 1rem',
            textAlign: 'center',
            color: 'var(--color-gray-400, #9ca3af)',
            fontSize: '0.8125rem',
          }}>
            Search players and tap + to add them to your queue.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={queue.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              {queue.map((item, index) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  rank={index + 1}
                  player={players.get(item.playerId)}
                  isDrafted={draftedIds.has(item.playerId)}
                  onRemove={onRemove}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Submit Pick CTA — shown when user is on the clock */}
      {isUserTurn && (
        <div style={{
          padding: '0.625rem 0.75rem',
          borderTop: '1px solid var(--content-border, #e2e8f0)',
          flexShrink: 0,
          background: 'var(--color-warning-light, #fef3c7)',
        }}>
          {submitError && (
            <div style={{
              fontSize: '0.6875rem',
              color: 'var(--color-error-dark, #b91c1c)',
              marginBottom: '0.375rem',
              padding: '0.25rem 0.5rem',
              background: 'var(--color-error-light, #fee2e2)',
              borderRadius: 'var(--radius-sm, 0.25rem)',
            }}>
              {submitError}
            </div>
          )}
          <button
            onClick={() => topItem && onSubmitPick(topItem.playerId)}
            disabled={isSubmittingPick || !topItem}
            className="dr-submit-pick-btn"
            style={{
              width: '100%',
              padding: '0.625rem',
              border: 'none',
              borderRadius: 'var(--radius-md, 0.5rem)',
              background: isSubmittingPick || !topItem
                ? 'var(--color-gray-300, #d1d5db)'
                : 'var(--dr-submit-bg, #1c497c)',
              color: '#ffffff',
              fontSize: '0.8125rem',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
              cursor: isSubmittingPick || !topItem ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s ease',
            }}
          >
            {isSubmittingPick
              ? 'Submitting…'
              : topPlayer
                ? `Draft ${topPlayer.name}`
                : 'No player in queue'}
          </button>
        </div>
      )}
    </div>
  );
}
