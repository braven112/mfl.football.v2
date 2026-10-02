import React from 'react';
import type { DraftRoomPick, DraftRoomPlayer, DraftRoomTeam } from '../../../types/draft-room';
import { getCollegeHeadshot, getPlayerImageUrl, nflLogoErrorHandler, nflLogoLoadHandler, nflLogoRefCallback, resolveHeadshotSrc } from '../../../constants/roster-constants';
import { buildNoHeadshotPlaceholder } from '../../../utils/nfl-team-colors';
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

  const isDef = player?.position?.toUpperCase() === 'DEF';
  const normalizedTeam = player?.nflTeam ? normalizeTeamCode(player.nflTeam) : '';
  const teamLogoUrl = normalizedTeam ? `/assets/nfl-logos/${normalizedTeam}.svg` : '';
  const noHeadshot = buildNoHeadshotPlaceholder(player?.nflTeam ?? '');
  const avatarSrc = isDef && teamLogoUrl ? teamLogoUrl : resolveHeadshotSrc(player?.headshot, player?.nflTeam);
  const avatarIsLogo = isDef && !!teamLogoUrl;

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    img.onerror = null;
    if (player?.espnId) {
      const college = getCollegeHeadshot(player.espnId);
      if (player.mflId) {
        const mfl = getPlayerImageUrl(player.mflId);
        img.onerror = () => {
          img.onerror = () => { img.onerror = null; img.src = noHeadshot; };
          img.src = mfl;
        };
        img.src = college;
      } else {
        img.onerror = () => { img.onerror = null; img.src = noHeadshot; };
        img.src = college;
      }
    } else if (player?.mflId) {
      img.onerror = () => { img.onerror = null; img.src = noHeadshot; };
      img.src = getPlayerImageUrl(player.mflId);
    } else {
      img.src = noHeadshot;
    }
  };

  const avatarClass = `dr-cell__avatar${isDef ? ' dr-cell__avatar--def' : ''}`;
  const metaClass = `dr-cell__meta${posKey ? ` dr-cell__meta--pos-${posKey}` : ''}`;

  return (
    <div className={cellClass} aria-label={`Pick ${pickLabel} — ${player?.name || 'Unknown'}, ${player?.position || ''}`}>
      <span className="dr-cell__pick">{pickLabel}</span>
      <div className="dr-cell__body">
        <img
          src={avatarSrc}
          alt={isDef ? `${player?.nflTeam ?? 'DEF'} logo` : `${player?.name || ''} headshot`}
          loading="lazy"
          decoding="async"
          onError={avatarIsLogo ? nflLogoErrorHandler : handleImgError}
          onLoad={avatarIsLogo ? nflLogoLoadHandler : undefined}
          ref={avatarIsLogo ? nflLogoRefCallback : undefined}
          className={avatarClass}
        />
        <span className="dr-cell__name">
          {player?.name || `Player ${pick.playerId}`}
        </span>
        {tierBadge}
      </div>
      <span className={metaClass}>
        {player?.position || ''}{player?.nflTeam ? ` · ${player.nflTeam}` : ''}
      </span>
      {tradeTag}
    </div>
  );
}
