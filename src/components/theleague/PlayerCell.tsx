import React from 'react';
import '../../styles/player-cell.css';
import { normalizeTeamCode } from '../../utils/nfl-logo';
import {
  DEFAULT_HEADSHOT_URL,
  getCollegeHeadshot,
  getPlayerHeadshot,
  getPlayerImageUrl,
} from '../../constants/roster-constants';

export interface PlayerCellProps {
  name: string;
  headshot?: string;
  position?: string;
  nflTeam?: string;
  /** Explicit NFL logo URL. If omitted, auto-derived from nflTeam. */
  nflLogo?: string;
  size?: 'default' | 'compact';
  mflId?: string;
  espnId?: string;
  contractStatus?: string;
  className?: string;
  /** Content rendered after the player name (e.g. injury badge) */
  afterName?: React.ReactNode;
  /** Content rendered after the position in the meta row (e.g. badges) */
  metaSlot?: React.ReactNode;
}

export function PlayerCell({
  name,
  headshot,
  position,
  nflTeam,
  nflLogo: explicitNflLogo,
  size = 'default',
  mflId,
  espnId,
  contractStatus,
  className,
  afterName,
  metaSlot,
}: PlayerCellProps) {
  const isDef = position?.toUpperCase() === 'DEF';
  const normalizedTeam = nflTeam ? normalizeTeamCode(nflTeam) : '';
  const teamLogoUrl = normalizedTeam ? `/assets/nfl-logos/${normalizedTeam}.svg` : '';

  // Prefer the caller-supplied headshot URL — server-side builders pick the
  // right endpoint (NFL combiner, college-football, or MFL photo) based on
  // which IDs are available. Falling through to getPlayerHeadshot(mflId,
  // espnId) assumes the espnId is always an NFL ID, which is wrong for
  // pre-draft rookies that only have a college ESPN ID.
  const resolvedHeadshot =
    headshot || (espnId ? getPlayerHeadshot(mflId, espnId) : DEFAULT_HEADSHOT_URL);
  const avatarSrc = isDef && teamLogoUrl ? teamLogoUrl : resolvedHeadshot;
  const nflLogoUrl = isDef ? '' : (explicitNflLogo ?? teamLogoUrl);

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    // Prevent re-triggering while we swap src
    img.onerror = null;
    if (espnId) {
      const college = getCollegeHeadshot(espnId);
      if (mflId) {
        const mfl = getPlayerImageUrl(mflId);
        img.onerror = () => {
          img.onerror = null;
          img.src = DEFAULT_HEADSHOT_URL;
        };
        // Try college first; if that fails the onerror above fires and tries mfl,
        // but we actually want: college → mfl → default. Wire a two-step chain:
        img.onerror = () => {
          img.onerror = () => { img.onerror = null; img.src = DEFAULT_HEADSHOT_URL; };
          img.src = mfl;
        };
        img.src = college;
      } else {
        img.onerror = () => { img.onerror = null; img.src = DEFAULT_HEADSHOT_URL; };
        img.src = college;
      }
    } else {
      img.src = DEFAULT_HEADSHOT_URL;
    }
  };

  const sizeClass = size === 'compact' ? 'player-cell--compact' : '';
  const classes = ['player-cell', sizeClass, className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className={`player-cell__avatar${isDef ? ' player-cell__avatar--def' : ''}`}>
        <img
          src={avatarSrc}
          alt={isDef ? `${nflTeam ?? 'DEF'} logo` : `${name} headshot`}
          loading="lazy"
          decoding="async"
          onError={handleImgError}
        />
      </div>
      <div className="player-cell__info">
        <strong className="player-cell__name">
          {name}{afterName}
        </strong>
        {(nflLogoUrl || position) && (
          <div className="player-meta">
            {nflLogoUrl && (
              <img
                src={nflLogoUrl}
                alt={`${normalizedTeam || nflTeam || 'FA'} logo`}
                className="player-meta__logo"
                loading="lazy"
                decoding="async"
              />
            )}
            {position && (
              <span className="player-meta__pos">
                {position}{contractStatus ? ` - ${contractStatus}` : ''}
              </span>
            )}
            {metaSlot}
          </div>
        )}
      </div>
    </div>
  );
}
