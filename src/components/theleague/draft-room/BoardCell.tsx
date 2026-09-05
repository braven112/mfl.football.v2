import React from 'react';
import type { DraftRoomPick, DraftRoomPlayer, DraftRoomTeam } from '../../../types/draft-room';
import { PlayerCell } from '../PlayerCell';

/**
 * One pick on the draft board.
 *
 * The player lockup is the site's shared PlayerCell, retuned to this grid's
 * density through the custom properties player-cell.css documents. It used to
 * be a hand-rolled `<img>` plus a name span carrying its OWN copy of the
 * headshot fallback cascade (ESPN → college → MFL → silhouette) and its own
 * DEF-shows-the-crest branch — a second implementation that could, and did,
 * drift from the one every other surface uses.
 */

interface BoardCellProps {
  pick: DraftRoomPick;
  player?: DraftRoomPlayer;
  team?: DraftRoomTeam;
  teams?: DraftRoomTeam[];
  isCurrentPick: boolean;
  isUserTeam: boolean;
  /** True for the most recent pick — triggers a brief flash animation. */
  isNewPick?: boolean;
}

export function BoardCell({ pick, player, team, teams, isCurrentPick, isUserTeam, isNewPick = false }: BoardCellProps) {
  const isMade = !!pick.playerId;
  const posKey = player?.position ? player.position.toLowerCase() : '';
  const cellClass = [
    'dr-cell',
    isMade && posKey ? `dr-cell--pos-${posKey}` : '',
    isUserTeam && !isCurrentPick ? 'dr-cell--user' : '',
    isCurrentPick ? 'dr-cell--otc' : '',
    isNewPick ? 'dr-cell--flash' : '',
  ].filter(Boolean).join(' ');

  // Find original team icon by name for traded picks. The "from " prefix this
  // used to strip came from `parseTradeFromComment`, which now returns a bare
  // trimmed name — stripping it here only ever fixed this one cell while the
  // same prefix rendered as `via from X` in the title beside it.
  const lowerOriginalName = pick.originalTeamName?.toLowerCase();
  const originalTeam = pick.isTraded && lowerOriginalName && teams
    ? teams.find((t) =>
        t.name?.toLowerCase() === lowerOriginalName ||
        t.nameShort?.toLowerCase() === lowerOriginalName ||
        t.abbrev?.toLowerCase() === lowerOriginalName
      )
    : undefined;

  const pickLabel = `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`;

  const tierBadge = player?.rspTier ? (
    <span
      className="dr-tier-badge"
      data-tier={player.rspTier}
      aria-label={`RSP Tier ${player.rspTier}`}
    >
      {player.rspTier}
    </span>
  ) : null;

  const tradeTag = pick.isTraded ? (
    <span className="dr-cell__trade" title={pick.originalTeamName ? `via ${pick.originalTeamName}` : 'Traded pick'}>
      <span className="dr-cell__trade-label">via</span>
      {originalTeam?.icon
        ? <img src={originalTeam.icon} alt={originalTeam.nameShort || pick.originalTeamName || ''} className="dr-cell__trade-logo" />
        : <span className="dr-cell__trade-name">{pick.originalTeamName}</span>
      }
    </span>
  ) : null;

  if (!isMade) {
    return (
      <div className={cellClass} aria-label={`Pick ${pickLabel} — ${team?.nameShort || 'TBD'}${isCurrentPick ? ' — On the clock' : ''}`}>
        <span className="dr-cell__pick">{pickLabel}</span>
        <span className="dr-cell__empty">
          {isCurrentPick ? 'On the clock' : '—'}
        </span>
        {tradeTag}
      </div>
    );
  }

  const posClass = posKey ? ` dr-cell__player--pos-${posKey}` : '';

  return (
    <div className={cellClass} aria-label={`Pick ${pickLabel} — ${player?.name || 'Unknown'}, ${player?.position || ''}`}>
      <span className="dr-cell__pick">{pickLabel}</span>
      <PlayerCell
        name={player?.name || `Player ${pick.playerId}`}
        headshot={player?.headshot}
        position={player?.position}
        nflTeam={player?.nflTeam}
        mflId={player?.mflId}
        espnId={player?.espnId}
        size="compact"
        className={`dr-cell__player${posClass}`}
        afterName={tierBadge}
      />
      {tradeTag}
    </div>
  );
}
