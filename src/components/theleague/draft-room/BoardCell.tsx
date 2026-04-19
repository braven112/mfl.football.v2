import React from 'react';
import type { DraftRoomPick, DraftRoomPlayer, DraftRoomTeam } from '../../../types/draft-room';
import { POSITION_COLORS } from '../../../types/draft-room';
import { DEFAULT_HEADSHOT_URL, getCollegeHeadshot, getPlayerImageUrl } from '../../../constants/roster-constants';
import { normalizeTeamCode } from '../../../utils/nfl-logo';

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
  const posColor = player ? POSITION_COLORS[player.position] || POSITION_COLORS.DEF : undefined;
  const cellClass = [
    'dr-cell',
    isCurrentPick ? 'dr-cell--otc' : '',
    isNewPick ? 'dr-cell--flash' : '',
  ].filter(Boolean).join(' ');

  // Find original team icon by name for traded picks
  // MFL sometimes prefixes the name with "from " — strip it before matching
  const cleanOriginalName = pick.originalTeamName?.replace(/^from\s+/i, '').trim();
  const lowerOriginalName = cleanOriginalName?.toLowerCase();
  const originalTeam = pick.isTraded && lowerOriginalName && teams
    ? teams.find((t) =>
        t.name?.toLowerCase() === lowerOriginalName ||
        t.nameShort?.toLowerCase() === lowerOriginalName ||
        t.abbrev?.toLowerCase() === lowerOriginalName
      )
    : undefined;

  const pickLabel = `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`;

  const cellStyle: React.CSSProperties = {
    position: 'relative',
    padding: '0.25rem 0.5rem 0.375rem',
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
    justifyContent: 'flex-start',
    fontSize: '0.75rem',
    transition: 'background 0.2s ease',
    animation: isCurrentPick ? 'dr-otc-pulse 2s ease-in-out infinite' : undefined,
  };

  const tierBadge = player?.rspTier ? (
    <span
      className="dr-tier-badge"
      data-tier={player.rspTier}
      aria-label={`RSP Tier ${player.rspTier}`}
      style={{ flexShrink: 0 }}
    >
      {player.rspTier}
    </span>
  ) : null;

  const pickLabelEl = (
    <span style={{ fontSize: '0.5rem', fontWeight: 700, color: 'var(--color-gray-400, #9ca3af)', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em', marginBottom: '0.1875rem' }}>
      {pickLabel}
    </span>
  );

  const tradeTag = pick.isTraded ? (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.125rem' }} title={pick.originalTeamName ? `via ${pick.originalTeamName}` : 'Traded pick'}>
      <span style={{ fontSize: '0.5rem', color: 'var(--color-gray-400, #9ca3af)' }}>via</span>
      {originalTeam?.icon
        ? <img src={originalTeam.icon} alt={originalTeam.nameShort || cleanOriginalName || ''} style={{ width: 14, height: 14, borderRadius: '50%', objectFit: 'cover' }} />
        : <span style={{ fontSize: '0.5rem', color: 'var(--color-gray-400, #9ca3af)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 60 }}>{cleanOriginalName}</span>
      }
    </span>
  ) : null;

  if (!isMade) {
    return (
      <div className={cellClass} style={cellStyle} aria-label={`Pick ${pickLabel} — ${team?.nameShort || 'TBD'}${isCurrentPick ? ' — On the clock' : ''}`}>
        {pickLabelEl}
        <span style={{ color: 'var(--color-gray-400, #9ca3af)', fontStyle: 'italic', fontSize: '0.6875rem' }}>
          {isCurrentPick ? 'On the clock' : '—'}
        </span>
        {tradeTag}
      </div>
    );
  }

  const isDef = player?.position?.toUpperCase() === 'DEF';
  const normalizedTeam = player?.nflTeam ? normalizeTeamCode(player.nflTeam) : '';
  const teamLogoUrl = normalizedTeam ? `/assets/nfl-logos/${normalizedTeam}.svg` : '';
  const avatarSrc = isDef && teamLogoUrl ? teamLogoUrl : (player?.headshot ?? DEFAULT_HEADSHOT_URL);

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    img.onerror = null;
    if (player?.espnId) {
      const college = getCollegeHeadshot(player.espnId);
      if (player.mflId) {
        const mfl = getPlayerImageUrl(player.mflId);
        img.onerror = () => {
          img.onerror = () => { img.onerror = null; img.src = DEFAULT_HEADSHOT_URL; };
          img.src = mfl;
        };
        img.src = college;
      } else {
        img.onerror = () => { img.onerror = null; img.src = DEFAULT_HEADSHOT_URL; };
        img.src = college;
      }
    } else if (player?.mflId) {
      img.onerror = () => { img.onerror = null; img.src = DEFAULT_HEADSHOT_URL; };
      img.src = getPlayerImageUrl(player.mflId);
    } else {
      img.src = DEFAULT_HEADSHOT_URL;
    }
  };

  return (
    <div className={cellClass} style={cellStyle} aria-label={`Pick ${pickLabel} — ${player?.name || 'Unknown'}, ${player?.position || ''}`}>
      {pickLabelEl}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', minWidth: 0 }}>
        <img
          src={avatarSrc}
          alt={isDef ? `${player?.nflTeam ?? 'DEF'} logo` : `${player?.name || ''} headshot`}
          loading="lazy"
          decoding="async"
          onError={handleImgError}
          style={{
            width: 22,
            height: 22,
            borderRadius: isDef ? 0 : '50%',
            objectFit: isDef ? 'contain' : 'cover',
            objectPosition: 'top',
            flexShrink: 0,
            background: 'var(--color-gray-100, #f3f4f6)',
          }}
        />
        <span style={{ fontWeight: 600, color: 'var(--color-gray-900, #111827)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }}>
          {player?.name || `Player ${pick.playerId}`}
        </span>
        {tierBadge}
      </div>
      <span style={{ fontSize: '0.625rem', color: posColor || 'var(--color-gray-500, #6b7280)', fontWeight: 600, marginTop: '0.0625rem' }}>
        {player?.position || ''}{player?.nflTeam ? ` · ${player.nflTeam}` : ''}
      </span>
      {tradeTag}
    </div>
  );
}
