/**
 * PlayerRow — React version of the PlayerCell pattern for custom rankings.
 *
 * Renders a draggable player row with rank number, player lockup (avatar,
 * name, NFL team + position), and optional rank delta indicator.
 * Uses the same .player-cell CSS classes as PlayerCell.astro.
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PlayerCell } from '../PlayerCell';
import type { RankedPlayer } from '../../../types/custom-rankings';

interface PlayerRowProps {
  player: RankedPlayer;
  rank: number;
  isEditing?: boolean;
}

export default function PlayerRow({ player, rank, isEditing = false }: PlayerRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: player.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Rank delta: positive = moved up (green), negative = moved down (red)
  let delta: number | null = null;
  if (player.isOverride && player.compositeRank != null) {
    delta = player.compositeRank - rank; // positive = improved
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`cr-row${isDragging ? ' cr-row--dragging' : ''}`}
    >
      {/* Drag handle — only visible in edit mode */}
      {isEditing && (
        <div className="cr-row__handle" {...attributes} {...listeners}>
          <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor">
            <circle cx="3" cy="3" r="1.5" />
            <circle cx="9" cy="3" r="1.5" />
            <circle cx="3" cy="10" r="1.5" />
            <circle cx="9" cy="10" r="1.5" />
            <circle cx="3" cy="17" r="1.5" />
            <circle cx="9" cy="17" r="1.5" />
          </svg>
        </div>
      )}

      {/* Rank number */}
      <div className="cr-row__rank">{rank}</div>

      {/* Player lockup */}
      <PlayerCell
        name={player.name}
        headshot={player.headshot}
        position={player.position}
        nflTeam={player.nflTeam}
        mflId={player.id}
        size="compact"
      />

      {/* VORP chip (when enabled) */}
      {player.vorpPoints != null && (
        <div
          className={`cr-vorp-chip${
            player.vorpPoints > 5
              ? ' cr-vorp-chip--positive'
              : player.vorpPoints < -5
                ? ' cr-vorp-chip--negative'
                : ' cr-vorp-chip--neutral'
          }`}
        >
          {player.vorpPoints > 0 ? '+' : ''}
          {player.vorpPoints.toFixed(1)}
        </div>
      )}

      {/* Delta indicator */}
      <div className="cr-row__delta">
        {delta != null && delta !== 0 && (
          <span className={delta > 0 ? 'cr-row__delta--up' : 'cr-row__delta--down'}>
            {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
          </span>
        )}
      </div>
    </div>
  );
}
