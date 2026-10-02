import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraftQueueItem, DraftRoomPlayer } from '../../../types/draft-room';

interface QueueRowProps {
  item: DraftQueueItem;
  rank: number;
  player: DraftRoomPlayer | undefined;
  isDrafted: boolean;
  onRemove: (id: string) => void;
}

export function QueueRow({ item, rank, player, isDrafted, onRemove }: QueueRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const transformStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const posKey = player?.position ? player.position.toLowerCase() : 'def';
  const posDotClass = `dr-queue-row__pos-dot dr-queue-row__pos-dot--${posKey}`;

  return (
    <div
      ref={setNodeRef}
      className="dr-queue-row"
      data-dragging={isDragging ? 'true' : undefined}
      data-drafted={isDrafted ? 'true' : undefined}
      style={transformStyle}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label="Drag to reorder"
        className="dr-drag-handle"
        data-disabled={isDrafted ? 'true' : undefined}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="2.5" r="1.25" />
          <circle cx="7" cy="2.5" r="1.25" />
          <circle cx="3" cy="7" r="1.25" />
          <circle cx="7" cy="7" r="1.25" />
          <circle cx="3" cy="11.5" r="1.25" />
          <circle cx="7" cy="11.5" r="1.25" />
        </svg>
      </button>

      <span className="dr-queue-row__rank">{rank}</span>

      <span className={posDotClass} aria-hidden="true" />

      <div className="dr-queue-row__body">
        {player ? (
          <>
            <div className="dr-queue-row__name">{player.name}</div>
            <div className="dr-queue-row__meta">
              <span>{player.position}</span>
              <span aria-hidden="true">·</span>
              <span>{player.nflTeam}</span>
            </div>
          </>
        ) : (
          <span className="dr-queue-row__unknown">Unknown player</span>
        )}
      </div>

      {isDrafted && (
        <span className="dr-queue-row__drafted-badge">Drafted</span>
      )}

      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${player?.name ?? 'player'} from queue`}
        className="dr-remove-btn"
      >
        ✕
      </button>
    </div>
  );
}
