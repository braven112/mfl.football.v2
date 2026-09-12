/**
 * What the board does when nothing is live.
 *
 * Never an empty scoreboard — a screen of zeros with no games behind them is
 * indistinguishable from a broken board, and this one is left on unattended.
 *
 * Each scene anchors its content somewhere different and they rotate every
 * 30s, so no glyph holds a pixel for more than half a minute. The long idle
 * stretches are where the real burn-in risk lives, not the busy afternoon.
 */

import { memo } from 'react';
import type { BroadcastLeaguePanel, BroadcastLeagueScore } from '../../../types/live-broadcast';
import type { NflGame } from '../../../types/live-scoring';

export type SaverScene = 'slate' | 'finals' | 'clock';

interface Props {
  scene: SaverScene;
  panels: readonly BroadcastLeaguePanel[];
  scores: Record<string, BroadcastLeagueScore>;
  games: readonly NflGame[];
  /** Rendered clock text; the island owns the tick so this stays pure. */
  now: string;
  today: string;
}

const ANCHORS: Record<SaverScene, 'center' | 'start' | 'end'> = {
  slate: 'start',
  finals: 'end',
  clock: 'center',
};

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

function BroadcastScreensaver({ scene, panels, scores, games, now, today }: Props) {
  const anchor = ANCHORS[scene];

  if (scene === 'clock') {
    return (
      <div className="lbc-saver" data-anchor={anchor}>
        <p className="lbc-saver__clock">{now}</p>
        <p className="lbc-saver__sub">{today}</p>
        {/* The honest line. Not "loading", not a spinner — there is nothing to
            wait for, and saying so is more useful than implying there is. */}
        <p className="lbc-saver__sub">No games live</p>
      </div>
    );
  }

  if (scene === 'slate') {
    const upcoming = games.filter((g) => g.state === 'pre').slice(0, 6);
    return (
      <div className="lbc-saver" data-anchor={anchor}>
        <h2 className="lbc-saver__title">Next up</h2>
        {upcoming.length === 0 ? (
          <p className="lbc-saver__sub">No games scheduled</p>
        ) : (
          <div className="lbc-saver__rows">
            {upcoming.map((g) => (
              <p className="lbc-saver__row" key={g.id}>
                <span>
                  {g.away.code} at {g.home.code}
                </span>
                <span>{g.shortDetail}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="lbc-saver" data-anchor={anchor}>
      <h2 className="lbc-saver__title">Where you stand</h2>
      <div className="lbc-saver__rows">
        {panels.map((panel) => {
          const score = scores[panel.leagueId];
          const matchup = panel.matchups[0];
          const mine = matchup ? score?.teams[matchup.mine.franchiseId] : undefined;
          const theirs = matchup?.opponent ? score?.teams[matchup.opponent.franchiseId] : undefined;
          return (
            <p className="lbc-saver__row" key={panel.leagueId}>
              <span>{panel.leagueName}</span>
              <span>
                {matchup && mine
                  ? `${fmt(mine.live)} – ${fmt(theirs?.live ?? 0)}`
                  : 'No matchup this week'}
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Memoised because the island ticks once a SECOND to age the freshness pill
 * and drive the screensaver clock, and this component depends on none of that.
 * Unmemoised, a 1 Hz heartbeat re-renders the whole visible board ~28,800
 * times over an eight-hour Sunday — on set-top hardware, and concurrently
 * with the reveal transitions that are the one thing on this screen allowed
 * to cost a frame budget. Props here are already memoised upstream, so the
 * bailout is free and changes no behaviour.
 */
export default memo(BroadcastScreensaver);
