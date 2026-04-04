import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraftQueueItem, DraftRoomPlayer } from '../../../types/draft-room';
import { POSITION_COLORS } from '../../../types/draft-room';

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

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isDrafted ? 0.45 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  };

  const posColor = player ? (POSITION_COLORS[player.position] || 'var(--dr-pos-def, #6b7280)') : 'var(--dr-pos-def, #6b7280)';

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.375rem 0.5rem',
        borderBottom: '1px solid var(--color-gray-100, #f3f4f6)',
        background: isDragging
          ? 'var(--color-gray-100, #f3f4f6)'
          : 'var(--dr-queue-row-bg, #ffffff)',
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        style={{
          flexShrink: 0,
          width: '1.25rem',
          height: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          background: 'transparent',
          color: 'var(--color-gray-300, #d1d5db)',
          cursor: isDrafted ? 'not-allowed' : 'grab',
          padding: 0,
          borderRadius: 'var(--radius-sm, 0.25rem)',
          pointerEvents: isDrafted ? 'none' : undefined,
        }}
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

      {/* Rank */}
      <span style={{
        flexShrink: 0,
        width: '1.25rem',
        textAlign: 'center',
        fontSize: '0.625rem',
        fontWeight: 700,
        color: 'var(--color-gray-400, #9ca3af)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {rank}
      </span>

      {/* Position dot */}
      <span style={{
        flexShrink: 0,
        width: '0.375rem',
        height: '0.375rem',
        borderRadius: '50%',
        background: posColor,
      }} />

      {/* Player name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {player ? (
          <>
            <div style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: isDrafted ? 'var(--color-gray-400, #9ca3af)' : 'var(--color-gray-900, #111827)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textDecoration: isDrafted ? 'line-through' : 'none',
            }}>
              {player.name}
            </div>
            <div style={{
              fontSize: '0.625rem',
              fontWeight: 600,
              color: 'var(--color-gray-400, #9ca3af)',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}>
              <span>{player.position}</span>
              <span>·</span>
              <span>{player.nflTeam}</span>
            </div>
          </>
        ) : (
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-400, #9ca3af)' }}>
            Unknown player
          </span>
        )}
      </div>

      {/* Drafted badge */}
      {isDrafted && (
        <span style={{
          flexShrink: 0,
          fontSize: '0.5625rem',
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.06em',
          color: 'var(--color-gray-400, #9ca3af)',
          background: 'var(--color-gray-100, #f3f4f6)',
          borderRadius: 'var(--radius-full, 9999px)',
          padding: '0.125rem 0.375rem',
        }}>
          Drafted
        </span>
      )}

      {/* Remove button */}
      <button
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${player?.name ?? 'player'} from queue`}
        style={{
          flexShrink: 0,
          width: '1.25rem',
          height: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          background: 'transparent',
          color: 'var(--color-gray-400, #9ca3af)',
          cursor: 'pointer',
          padding: 0,
          borderRadius: 'var(--radius-sm, 0.25rem)',
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}
