/**
 * BroadcastRevealCard — the moment a pick lands, at TV scale.
 *
 * The TV-sized sibling of `PickRevealSplash.tsx`. It reuses that surface's
 * composite rules verbatim (`resolveSplashColors`, `isSplashCutoutEligible`,
 * the espncdn-only 404 cascade) because those rules are binding across the
 * whole site — see docs/claude/insights/features/player-composites.md. What
 * differs is everything about presentation and what it says:
 *
 *   - Full viewport, not an overlay on a board panel.
 *   - No dismissal. Nobody is holding a mouse; the queue owns the timing.
 *   - The franchise's identity is carried by its COLORS and its CREST, and
 *     nothing else. Franchise banners were tried here and cut (Brandon,
 *     2026-08-27): a banner is mostly its own wordmark, so behind a player's
 *     name it reads as two competing pieces of type at the exact moment the
 *     room is trying to read one of them. Blurring it back far enough to stop
 *     competing left it contributing nothing.
 *   - It carries stats — board rank, projection, bye, injury — but NOT the
 *     league's ranking sources (Brandon, 2026-08-27: not for this screen) —
 *     because a reveal that owns a 65" screen for 18 seconds and says only a
 *     name is wasting the best real estate of the night.
 */

import { useCallback, useState } from 'react';
import type { DraftRoomPick } from '../../../types/draft-room';
import type { DraftRoomTeam } from '../../../types/draft-room';
import type { BroadcastPlayer } from '../../../types/draft-broadcast';
import { isSplashCutoutEligible, resolveSplashColors } from '../../../utils/pick-reveal';
import {
  bestAvailableAt,
  toBroadcastPair,
  formatBestAvailable,
  positionRunCount,
} from '../../../utils/draft-broadcast';
import { getCollegeHeadshot } from '../../../constants/roster-constants';

interface Props {
  pick: DraftRoomPick;
  team?: DraftRoomTeam;
  player?: BroadcastPlayer;
  picks: DraftRoomPick[];
  players: ReadonlyMap<string, BroadcastPlayer>;
  /** True when this is a replay of a finished season, not the live draft. */
  rehearsing?: boolean;
  /** The season being replayed — only meaningful while `rehearsing`. */
  leagueYear?: number;
}

/** "1.03" — the way a draft room says a pick out loud. */
function pickLabel(pick: DraftRoomPick): string {
  return `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`;
}

export function BroadcastRevealCard({
  pick,
  team,
  player,
  picks,
  players,
  rehearsing,
  leagueYear,
}: Props) {
  const [cutoutSrc, setCutoutSrc] = useState<string | null>(() =>
    isSplashCutoutEligible(player) ? player!.headshot : null
  );

  // 404 cascade stays inside espncdn: NFL cutout → college cutout → no cutout.
  // Never the MFL JPG — its baked-in background ruins the composite.
  const handleCutoutError = useCallback(() => {
    setCutoutSrc((current) => {
      const college = player?.espnId ? getCollegeHeadshot(player.espnId) : null;
      return college && college !== current ? college : null;
    });
  }, [player]);

  const hideOnError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none';
  }, []);

  // Franchise brand first (resolveSplashColors), then floored for legibility.
  // Nine of 24 AFL franchises have a gradient stop white text cannot be read
  // against — six of them a near-white #e9e9e9. Applied HERE rather than inside
  // resolveSplashColors because that helper is shared with TheLeague's draft
  // room, whose splash is a 3.6s overlay on a laptop, not a TV read from ten
  // feet; this is the broadcast screen's requirement, not a global one.
  const brand = resolveSplashColors(team, player);
  const colors = toBroadcastPair(brand.primary, brand.secondary);
  const label = pickLabel(pick);

  // Where he stood among what was actually left on the board. A fact, not a
  // verdict — see the keeper-league reasoning on `bestAvailableAt`.
  const availRank = player
    ? bestAvailableAt(picks, players, pick.overallPickNumber, player.id)
    : undefined;
  const availText = formatBestAvailable(availRank);

  // Rookies read best with their college as the origin line; vets get NFL team.
  const origin = player?.isRookie && player.college ? player.college : player?.nflTeam || '';

  // "4th RB in 8 picks" — the run callout. Only shown once it's actually a run;
  // announcing the 1st or 2nd of a position is just noise.
  const runCount = player
    ? positionRunCount(picks, players, pick.overallPickNumber, player.position)
    : 0;
  const showRun = runCount >= 3;

  return (
    <div
      className="dbc-reveal"
      style={
        {
          '--dbc-primary': colors.primary,
          '--dbc-secondary': colors.secondary,
        } as React.CSSProperties
      }
    >
      <div className="dbc-reveal__wash" aria-hidden="true" />
      {/* The idle screen carries this too, but the reveal card is what is
          actually on the TV for ~18 of every 20 seconds of a replay — flagging
          only the idle screen would leave the room looking at last year's picks
          with nothing on screen to say so. */}
      {rehearsing ? (
        <span className="dbc-reveal__rehearsal-flag">
          Rehearsal · replaying {leagueYear}
        </span>
      ) : null}
      <span className="dbc-reveal__ghost" aria-hidden="true">{label}</span>
      {team?.icon ? (
        <img className="dbc-reveal__crest" src={team.icon} alt="" onError={hideOnError} />
      ) : null}

      <div className="dbc-reveal__body">
        <div className="dbc-reveal__figure">
          {cutoutSrc ? (
            <img
              className="dbc-reveal__model"
              src={cutoutSrc}
              alt=""
              decoding="async"
              onError={handleCutoutError}
            />
          ) : null}
        </div>

        <div className="dbc-reveal__text">
          <p className="dbc-reveal__kicker">
            With the {label}, {team?.name || 'the next team up'} select
          </p>
          <h1 className="dbc-reveal__player">{player?.name || 'Pick in'}</h1>

          <p className="dbc-reveal__meta">
            {player?.position ? <span className="dbc-reveal__pos">{player.position}</span> : null}
            {origin ? <span>{origin}</span> : null}
            {player?.byeWeek ? <span>BYE {player.byeWeek}</span> : null}
            {player?.injuryStatus ? (
              <span className="dbc-reveal__injury">{player.injuryStatus}</span>
            ) : null}
          </p>

          {availText ? (
            <p
              className={`dbc-reveal__value${
                availRank === 1 ? ' dbc-reveal__value--top' : ''
              }`}
            >
              {availText}
            </p>
          ) : null}

          <dl className="dbc-reveal__stats">
            {player?.boardRank ? (
              <div className="dbc-reveal__stat">
                {/* Board rank, not raw ADP. An AFL 1.02 sitting beside "ADP
                    24.1" reads as a blunder when it is nothing of the sort —
                    the 24 counts 84 keepers who were never draftable here. */}
                <dt>Board rank</dt>
                <dd>#{player.boardRank}</dd>
              </div>
            ) : null}
            {player?.projectedPoints ? (
              <div className="dbc-reveal__stat">
                <dt>Proj / wk</dt>
                <dd>{player.projectedPoints.toFixed(1)}</dd>
              </div>
            ) : null}
            {player?.age ? (
              <div className="dbc-reveal__stat">
                <dt>Age</dt>
                <dd>{player.age}</dd>
              </div>
            ) : null}
          </dl>

          {showRun && player ? (
            <p className="dbc-reveal__run">
              {runCount} {player.position}s off the board in the last 8 picks
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
