import React from 'react';
import type { DraftRoomPick, DraftRoomPlayer, DraftRoomTeam } from '../../../types/draft-room';
import { POSITION_COLORS } from '../../../types/draft-room';

interface BoardCellProps {
  pick: DraftRoomPick;
  player?: DraftRoomPlayer;
  team?: DraftRoomTeam;
  isCurrentPick: boolean;
  isUserTeam: boolean;
}

export function BoardCell({ pick, player, team, isCurrentPick, isUserTeam }: BoardCellProps) {
  const isMade = !!pick.playerId;
  const posColor = player ? POSITION_COLORS[player.position] || POSITION_COLORS.DEF : undefined;

  const cellStyle: React.CSSProperties = {
    position: 'relative',
    padding: '0.375rem 0.5rem',
    borderBottom: '1px solid var(--dr-cell-border, #e2e8f0)',
    borderLeft: isMade && posColor ? `3px solid ${posColor}` : '3px solid transparent',
    background: isCurrentPick
      ? 'var(--dr-otc-bg, #fef3c7)'
      : isUserTeam
        ? 'var(--dr-cell-bg-user, rgba(28, 73, 124, 0.06))'
        : 'var(--dr-cell-bg, #ffffff)',
    minHeight: 'var(--dr-cell-height, 56px)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    fontSize: '0.75rem',
    transition: 'background 0.2s ease',
    animation: isCurrentPick ? 'dr-otc-pulse 2s ease-in-out infinite' : undefined,
  };

  if (!isMade) {
    return (
      <div style={cellStyle} aria-label={`Pick ${pick.round}.${String(pick.pickInRound).padStart(2, '0')} — ${team?.nameShort || 'TBD'}${isCurrentPick ? ' — On the clock' : ''}`}>
        <span style={{ color: 'var(--color-gray-400, #9ca3af)', fontStyle: 'italic', fontSize: '0.6875rem' }}>
          {isCurrentPick ? 'On the clock' : '—'}
        </span>
        {pick.isTraded && pick.originalTeamName && (
          <span style={{ fontSize: '0.5625rem', color: 'var(--color-gray-400, #9ca3af)', marginTop: '0.125rem' }}>
            via {pick.originalTeamName}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={cellStyle} aria-label={`Pick ${pick.round}.${String(pick.pickInRound).padStart(2, '0')} — ${player?.name || 'Unknown'}, ${player?.position || ''}`}>
      <span style={{ fontWeight: 600, color: 'var(--color-gray-900, #111827)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {player?.name || `Player ${pick.playerId}`}
      </span>
      <span style={{ fontSize: '0.625rem', color: posColor || 'var(--color-gray-500, #6b7280)', fontWeight: 600, marginTop: '0.0625rem' }}>
        {player?.position || ''}{player?.nflTeam ? ` · ${player.nflTeam}` : ''}
      </span>
      {pick.isTraded && pick.originalTeamName && (
        <span style={{ fontSize: '0.5625rem', color: 'var(--color-gray-400, #9ca3af)', marginTop: '0.0625rem' }}>
          via {pick.originalTeamName}
        </span>
      )}
    </div>
  );
}
