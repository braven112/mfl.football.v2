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
  /**
   * Live-mode MFL "Make Pick" deep-link. When set, the queue is treated as
   * local-only — Sync to MFL and Auto-pick toggles hide (those rely on a
   * write endpoint we don't have yet) and the on-clock CTA links to MFL
   * instead of POSTing the top-of-queue pick.
   */
  mflPickUrl?: string;
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
  mflPickUrl,
}: DraftQueuePanelProps) {
  // In live mode the queue is local-only — no MFL-side persistence yet.
  const isLocalOnly = !!mflPickUrl;
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
    <div className="dr-queue">
      <div className="dr-queue__header">
        <div className="dr-queue__title-row">
          <div className="dr-queue__title-group">
            <span className="dr-queue__title">My Queue</span>
            {queue.length > 0 && (
              <span className="dr-queue__count-badge">{queue.length}</span>
            )}
          </div>

          {!isLocalOnly && (
            <button
              type="button"
              onClick={handleSyncToMfl}
              disabled={isSyncingQueue || queue.length === 0}
              title="Sync queue to your MFL draft board"
              className="dr-sync-btn"
              data-state={syncSuccess ? 'success' : undefined}
            >
              {isSyncingQueue ? 'Syncing…' : syncSuccess ? '✓ Synced' : 'Sync to MFL'}
            </button>
          )}
        </div>

        {!isLocalOnly && (
          <label className="dr-auto-submit-label" onClick={onToggleAutoSubmit}>
            <span
              role="switch"
              aria-checked={autoSubmit}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleAutoSubmit(); } }}
              onClick={(e) => { e.stopPropagation(); onToggleAutoSubmit(); }}
              className="dr-auto-submit-switch"
            >
              <span className="dr-auto-submit-switch__thumb" />
            </span>
            <span className="dr-auto-submit-label__text">Auto-pick from queue</span>
          </label>
        )}

        {isLocalOnly && (
          <p className="dr-queue__hint">
            Queue is saved on this device only. Make picks on MFL when you're on the clock.
          </p>
        )}
      </div>

      <div className="dr-queue__list">
        {queue.length === 0 ? (
          <div className="dr-queue__empty">
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

      {isUserTurn && isLocalOnly && (
        <div className="dr-queue__cta">
          <a
            href={mflPickUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="dr-submit-pick-btn"
          >
            Pick on MFL ↗
          </a>
        </div>
      )}
      {isUserTurn && !isLocalOnly && (
        <div className="dr-queue__cta">
          {submitError && (
            <div className="dr-queue__cta-error">{submitError}</div>
          )}
          <button
            type="button"
            onClick={() => topItem && onSubmitPick(topItem.playerId)}
            disabled={isSubmittingPick || !topItem}
            className="dr-submit-pick-btn"
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
