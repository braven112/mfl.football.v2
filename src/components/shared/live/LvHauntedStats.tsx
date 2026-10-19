/**
 * The Halloween header's two cards: Monster of the Week and Scariest Game.
 *
 * Rendered only while the Halloween season is open (`LiveBoard`'s `season`
 * prop), and from `hauntedStats`, which derives both from the panels the board
 * already shows. Renders nothing when neither has an answer, so a week that
 * has not kicked off gets the scene alone rather than two empty cards.
 */
import type { JSX } from 'react';
import type { HauntedStats } from '../../../utils/live/haunted-stats';

export interface LvHauntedStatsProps {
  stats: HauntedStats;
}

function fmt(points: number): string {
  return points.toFixed(1);
}

export default function LvHauntedStats({ stats }: LvHauntedStatsProps): JSX.Element | null {
  const { monster, scariest } = stats;
  if (!monster && !scariest) return null;

  return (
    <div className="lv-haunt">
      {monster && (
        <div className="lv-haunt__card">
          <span className="lv-haunt__label">Monster of the Week</span>
          <span className="lv-haunt__main">{monster.name}</span>
          <span className="lv-haunt__sub">
            {fmt(monster.points)} pts{monster.owners ? ` · ${monster.owners}` : ''}
          </span>
        </div>
      )}
      {scariest && (
        <div className="lv-haunt__card">
          <span className="lv-haunt__label">Scariest Game</span>
          <span className="lv-haunt__main">
            {scariest.names[0]} vs {scariest.names[1]}
          </span>
          <span className="lv-haunt__sub">
            {fmt(scariest.margin)} pts apart
            {scariest.final ? ' · final' : scariest.yetToPlay > 0 ? ` · ${scariest.yetToPlay} to play` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
