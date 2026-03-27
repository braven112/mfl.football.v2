/**
 * LineupRow — single player row in the lineup interface.
 * Handles starter rows (with swap button) and bench rows.
 */

import { useCallback, useRef, useEffect } from 'react';
import type { LineupPlayer } from './lineup-utils';
import { isPlayerLocked } from './lineup-utils';
import { normalizeTeamCode } from '../../../utils/nfl-logo';

interface LineupRowProps {
  player: LineupPlayer | null;
  slotId: string;
  slotLabel: string;
  isStarter: boolean;
  isSelected: boolean;
  isEligibleTarget: boolean;
  isDimmed: boolean;
  isChanged: boolean;
  justSwapped: boolean;
  readOnly: boolean;
  onSwapClick: (slotId: string) => void;
  onBenchPlayerClick: (playerId: string) => void;
}

/** Map of injury status abbreviations */
const INJURY_ABBREV: Record<string, string> = {
  Questionable: 'Q',
  Doubtful: 'D',
  Out: 'O',
  IR: 'IR',
};

export default function LineupRow({
  player,
  slotId,
  slotLabel,
  isStarter,
  isSelected,
  isEligibleTarget,
  isDimmed,
  isChanged,
  justSwapped,
  readOnly,
  onSwapClick,
  onBenchPlayerClick,
}: LineupRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Remove justSwapped class after animation
  useEffect(() => {
    if (justSwapped && rowRef.current) {
      const timer = setTimeout(() => {
        rowRef.current?.classList.remove('lineup-row--just-swapped');
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [justSwapped]);

  const handleSwapClick = useCallback(() => {
    if (!player || readOnly) return;
    if (isPlayerLocked(player)) return;
    onSwapClick(slotId);
  }, [player, readOnly, slotId, onSwapClick]);

  const handleBenchClick = useCallback(() => {
    if (!player || readOnly) return;
    onBenchPlayerClick(player.id);
  }, [player, readOnly, onBenchPlayerClick]);

  // Empty slot
  if (!player) {
    return (
      <div className="lineup-row lineup-row--empty" role="listitem">
        <span className="lineup-slot" aria-hidden="true">{slotLabel}</span>
        <span className="lineup-empty-label">Empty — tap to add</span>
        <span className="lineup-proj">—</span>
        <div style={{ width: 'var(--lineup-swap-size)' }} />
      </div>
    );
  }

  const locked = isPlayerLocked(player);
  const isBye = player.opponent === 'BYE';
  const injuryAbbrev = player.injuryStatus ? INJURY_ABBREV[player.injuryStatus] : null;
  const isDEF = player.position === 'Def';
  const normalizedTeam = normalizeTeamCode(player.nflTeam);
  const headshotUrl = isDEF
    ? `/assets/nfl-logos/${normalizedTeam}.svg`
    : player.headshot || `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`;

  const rowClasses = [
    'lineup-row',
    isSelected && 'lineup-row--selected',
    isDimmed && 'lineup-row--dimmed',
    isChanged && !isSelected && 'lineup-row--changed',
    justSwapped && 'lineup-row--just-swapped',
    isBye && 'lineup-row--bye',
    isEligibleTarget && 'lineup-row--eligible-target',
  ]
    .filter(Boolean)
    .join(' ');

  const ariaLabel = `${slotLabel}. ${player.name}, ${normalizedTeam}, ${player.position}. Projected ${player.projectedPoints?.toFixed(1) || '0'} points.${locked ? ' Locked — game in progress.' : ''}`;

  return (
    <div
      ref={rowRef}
      className={rowClasses}
      role="listitem"
      aria-label={ariaLabel}
      onClick={!isStarter && isEligibleTarget ? handleBenchClick : undefined}
      style={!isStarter && isEligibleTarget ? { cursor: 'pointer' } : undefined}
    >
      {/* Slot label */}
      {isStarter && (
        <span className="lineup-slot" aria-hidden="true">{slotLabel}</span>
      )}

      {/* Player cell (compact) */}
      <div className="lineup-player-cell" style={{ minWidth: 0 }}>
        <div className={`lineup-player-cell__avatar${isDEF ? ' lineup-player-cell__avatar--def' : ''}`}>
          <img
            src={headshotUrl}
            alt=""
            width={28}
            height={28}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/assets/default-headshot.svg';
            }}
          />
        </div>
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <div className="lineup-player-cell__name">
            {player.name}
            {injuryAbbrev && (
              <span className={`lineup-injury-badge lineup-injury-badge--${injuryAbbrev}`}>
                {injuryAbbrev}
              </span>
            )}
          </div>
          <div className="lineup-player-cell__meta">
            {!isDEF && (
              <img
                src={`/assets/nfl-logos/${normalizedTeam}.svg`}
                alt={normalizedTeam}
                width={14}
                height={14}
                style={{ flexShrink: 0 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span>{isDEF ? normalizedTeam : `${normalizedTeam} · ${player.position}`}</span>
          </div>
        </div>
      </div>

      {/* Opponent column (tablet+) */}
      <span className="lineup-col-opponent">
        {isBye ? (
          <span className="lineup-bye-badge">BYE</span>
        ) : player.opponent ? (
          <span>
            {player.isHome ? 'vs' : '@'} {normalizeTeamCode(player.opponent)}
            {player.spread ? ` ${player.spread}` : ''}
          </span>
        ) : null}
      </span>

      {/* O/U column (desktop+) */}
      <span className="lineup-col-ou">
        {player.overUnder || '—'}
      </span>

      {/* Trend column (desktop+) */}
      <span className="lineup-col-trend">
        {player.avgRecent?.toFixed(1) || '—'}
      </span>

      {/* Avg column (desktop+) */}
      <span className="lineup-col-avg">
        {player.avgSeason?.toFixed(1) || '—'}
      </span>

      {/* Projected points */}
      <span className="lineup-proj">
        {isBye ? '—' : (player.projectedPoints?.toFixed(1) || '0.0')}
      </span>

      {/* Swap button / Lock icon */}
      {!readOnly && isStarter && (
        locked ? (
          <span className="lineup-lock" title="Game started — locked" aria-label="Locked, game in progress">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </span>
        ) : (
          <button
            className="lineup-swap-btn"
            onClick={handleSwapClick}
            aria-label={`Swap ${slotLabel}, ${player.name}`}
            aria-pressed={isSelected}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        )
      )}

      {/* Bench: show position badge instead of swap button */}
      {!isStarter && !readOnly && (
        <span className="lineup-slot lineup-slot--bench">
          {player.position}
        </span>
      )}
    </div>
  );
}
