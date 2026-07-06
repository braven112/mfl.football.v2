import React, { useState } from 'react';
import type { TradeBuilderPlayer } from '../../../types/trade-builder';
import { getNflTeamColors, hexToRgba } from '../../../utils/nfl-team-colors';

/**
 * TradeCompositeStrip — breaking-news player composite for trade surfaces.
 *
 * React port of the MatchupSplitHero split-panel language: each headline
 * player on his own NFL-team-color gradient with a glow, ghost team-logo
 * watermark, and ESPN cutout mirrored toward a center swap badge.
 *
 * Composites ONLY transparent ESPN headshots — the MFL JPG fallback has a
 * baked-in background and ruins the layering — and never DEF "players"
 * (logos, not people). Renders a two-panel face-off when both sides
 * composite, a single panel when one does, nothing when neither does.
 * A cutout 404 hides the whole strip: the strip is purely additive over
 * the text asset lists both callers keep rendering, so nothing is lost.
 */

export function isCompositableTradePlayer(
  player: TradeBuilderPlayer | null | undefined
): player is TradeBuilderPlayer {
  return (
    !!player &&
    player.position?.toUpperCase() !== 'DEF' &&
    typeof player.headshot === 'string' &&
    player.headshot.includes('espncdn.com')
  );
}

interface Props {
  left?: TradeBuilderPlayer | null;
  right?: TradeBuilderPlayer | null;
  /** Chip label over each panel; defaults to the player's NFL team code */
  leftLabel?: string;
  rightLabel?: string;
  size?: 'compact' | 'tall';
}

export default function TradeCompositeStrip({
  left,
  right,
  leftLabel,
  rightLabel,
  size = 'compact',
}: Props) {
  // Track headshot 404s PER SIDE, so a single failed cutout degrades to the
  // one-panel layout (same graceful path as a DEF/pick headline) instead of
  // nuking the whole strip. Only when BOTH sides fail does the strip vanish.
  const [leftFailed, setLeftFailed] = useState(false);
  const [rightFailed, setRightFailed] = useState(false);

  const leftVisible = isCompositableTradePlayer(left) && !leftFailed;
  const rightVisible = isCompositableTradePlayer(right) && !rightFailed;
  if (!leftVisible && !rightVisible) return null;

  const bothVisible = leftVisible && rightVisible;

  const renderPanel = (player: TradeBuilderPlayer, side: 'left' | 'right', label?: string) => {
    const { primary } = getNflTeamColors(player.nflTeam);
    return (
      <div
        className={`tcs__panel tcs__panel--${side}`}
        style={{ background: `linear-gradient(160deg, #0b0e12 0%, ${primary} 150%)` }}
      >
        <span
          className="tcs__glow"
          style={{ background: `radial-gradient(circle, ${hexToRgba(primary, 0.35)} 0%, transparent 65%)` }}
          aria-hidden="true"
        />
        {player.nflLogo && (
          <img className="tcs__logo" src={player.nflLogo} alt="" aria-hidden="true" loading="lazy" />
        )}
        <span className={`tcs__chip${side === 'right' ? ' tcs__chip--right' : ''}`}>
          {label ?? player.nflTeam}
        </span>
        <img
          className={`tcs__cutout${side === 'left' && bothVisible ? ' tcs__cutout--mirrored' : ''}`}
          src={player.headshot}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => (side === 'left' ? setLeftFailed(true) : setRightFailed(true))}
        />
        <span className={`tcs__player${side === 'right' ? ' tcs__player--right' : ''}`}>
          <strong>{player.name}</strong>
          <span className="tcs__player-meta">{player.position} · {player.nflTeam}</span>
        </span>
      </div>
    );
  };

  return (
    <div className={`tcs tcs--${size}`} aria-hidden="true">
      {leftVisible && renderPanel(left, 'left', leftLabel)}
      {bothVisible && (
        <span className="tcs__swap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h13m0 0l-3-3m3 3l-3 3M20 17H7m0 0l3-3m-3 3l3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      {rightVisible && renderPanel(right, 'right', rightLabel)}

      <style>{`
        .tcs {
          position: relative;
          display: flex;
          overflow: hidden;
          border-radius: var(--radius-md, 0.5rem);
        }
        .tcs--compact .tcs__panel { min-height: 130px; }
        .tcs--tall .tcs__panel { min-height: 175px; }
        .tcs__panel {
          position: relative;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }
        .tcs__glow {
          position: absolute;
          inset: -40% -30% auto -30%;
          height: 140%;
          pointer-events: none;
        }
        .tcs__logo {
          position: absolute;
          top: 44%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: clamp(90px, 12vw, 130px);
          opacity: 0.16;
          pointer-events: none;
          user-select: none;
        }
        .tcs__chip {
          position: absolute;
          top: 0.5rem;
          left: 0.55rem;
          z-index: 3;
          color: #fff;
          font-size: 0.6rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          background: rgba(0, 0, 0, 0.45);
          padding: 0.22rem 0.45rem;
          border-radius: 4px;
          backdrop-filter: blur(2px);
          white-space: nowrap;
          max-width: calc(100% - 1.1rem);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tcs__chip--right {
          left: auto;
          right: 0.55rem;
        }
        .tcs__cutout {
          position: relative;
          z-index: 1;
          width: clamp(100px, 12vw, 130px);
          filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.5));
        }
        .tcs--tall .tcs__cutout {
          width: clamp(130px, 15vw, 160px);
        }
        /* Mirror the left cutout to face the center swap badge. */
        .tcs__cutout--mirrored {
          transform: scaleX(-1);
        }
        .tcs__player {
          position: absolute;
          z-index: 2;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
          padding: 0.4rem 0.6rem;
          color: #fff;
          background: linear-gradient(transparent, rgba(6, 9, 13, 0.85));
        }
        .tcs__player--right {
          align-items: flex-end;
          text-align: right;
        }
        .tcs__player strong {
          font-size: 0.75rem;
          font-weight: 800;
          line-height: 1.15;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .tcs--tall .tcs__player strong {
          font-size: 0.8125rem;
        }
        .tcs__player-meta {
          font-size: 0.55rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: rgba(255, 255, 255, 0.65);
        }
        .tcs__swap {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          z-index: 4;
          color: #fff;
          background: rgba(6, 9, 13, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.25);
          width: 2.2rem;
          height: 2.2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          backdrop-filter: blur(2px);
        }
      `}</style>
    </div>
  );
}
