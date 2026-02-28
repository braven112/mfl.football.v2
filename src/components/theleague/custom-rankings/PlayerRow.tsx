/**
 * PlayerRow — React version of the PlayerCell pattern for custom rankings.
 *
 * Renders a draggable player row with rank number, player lockup (avatar,
 * name, NFL team + position), and optional rank delta indicator.
 * Uses the same .player-cell CSS classes as PlayerCell.astro.
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { normalizeTeamCode } from '../../../utils/nfl-logo';
import type { RankedPlayer } from '../../../types/custom-rankings';

const DEFAULT_HEADSHOT =
  'https://www49.myfantasyleague.com/player_photos_2010/no_photo_available.jpg';

interface PlayerRowProps {
  player: RankedPlayer;
  rank: number;
}

export default function PlayerRow({ player, rank }: PlayerRowProps) {
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

  const isDef = player.position === 'DEF';
  const normalized = normalizeTeamCode(player.nflTeam);
  const teamLogo = normalized ? `/assets/nfl-logos/${normalized}.svg` : '';
  const avatarSrc = isDef && teamLogo ? teamLogo : (player.headshot || DEFAULT_HEADSHOT);

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
      {/* Drag handle */}
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

      {/* Rank number */}
      <div className="cr-row__rank">{rank}</div>

      {/* Player lockup (reuses player-cell CSS) */}
      <div className="player-cell player-cell--compact">
        <div className={`player-cell__avatar${isDef ? ' player-cell__avatar--def' : ''}`}>
          <img
            src={avatarSrc}
            alt={isDef ? `${player.nflTeam} logo` : `${player.name} headshot`}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              (e.target as HTMLImageElement).onerror = null;
              (e.target as HTMLImageElement).src = DEFAULT_HEADSHOT;
            }}
          />
        </div>
        <div className="player-cell__info">
          <strong className="player-cell__name">{player.name}</strong>
          <div className="player-meta">
            {!isDef && teamLogo && (
              <img
                src={teamLogo}
                alt={`${normalized} logo`}
                className="player-meta__logo"
                loading="lazy"
                decoding="async"
              />
            )}
            <span className="player-meta__pos">{player.position}</span>
          </div>
        </div>
      </div>

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
