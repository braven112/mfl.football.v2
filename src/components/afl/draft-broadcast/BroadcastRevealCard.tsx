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
 *   - It carries stats — value vs ADP, projection, rankings, bye, injury —
 *     because a reveal that owns a 65" screen for 18 seconds and says only a
 *     name is wasting the best real estate of the night.
 */

import { useCallback, useState } from 'react';
import type { DraftRoomPick } from '../../../types/draft-room';
import type { DraftRoomTeam } from '../../../types/draft-room';
import type { BroadcastPlayer } from '../../../types/draft-broadcast';
import { isSplashCutoutEligible, resolveSplashColors } from '../../../utils/pick-reveal';
import { computePickValue, formatPickValue, positionRunCount } from '../../../utils/draft-broadcast';
import { getCollegeHeadshot } from '../../../constants/roster-constants';

interface Props {
  pick: DraftRoomPick;
  team?: DraftRoomTeam;
  player?: BroadcastPlayer;
  picks: DraftRoomPick[];
  players: ReadonlyMap<string, BroadcastPlayer>;
}

/** "1.03" — the way a draft room says a pick out loud. */
function pickLabel(pick: DraftRoomPick): string {
  return `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`;
}

export function BroadcastRevealCard({ pick, team, player, picks, players }: Props) {
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

  const colors = resolveSplashColors(team, player);
  const label = pickLabel(pick);
  const value = computePickValue(pick.overallPickNumber, player);
  const valueText = formatPickValue(value);

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

          {valueText ? (
            <p className={`dbc-reveal__value dbc-reveal__value--${value.verdict}`}>
              {valueText}
            </p>
          ) : null}

          <dl className="dbc-reveal__stats">
            {player?.consensusRank ? (
              <div className="dbc-reveal__stat">
                <dt>Consensus</dt>
                <dd>#{player.consensusRank}</dd>
              </div>
            ) : null}
            {player?.adpAveragePick ? (
              <div className="dbc-reveal__stat">
                <dt>ADP</dt>
                <dd>{player.adpAveragePick.toFixed(1)}</dd>
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

          {player?.sourceRanks?.length ? (
            <ul className="dbc-reveal__chips">
              {player.sourceRanks.map((s) => (
                <li key={s.label} className="dbc-reveal__chip">
                  <span>{s.label}</span>
                  <strong>#{s.rank}</strong>
                </li>
              ))}
            </ul>
          ) : null}

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
