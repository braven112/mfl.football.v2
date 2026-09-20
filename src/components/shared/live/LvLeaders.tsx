/**
 * The week's top scorers in one league — teams, then individuals.
 *
 * Both strips are DERIVED from the same panel the cards above them render
 * (`buildLeaders`), so they cannot disagree with it. Nothing here fetches.
 *
 * Three things it must keep:
 *
 *  - **A player is named from `playerMeta`, the board's single identity map.**
 *    A row carries an id and a franchise, never a copied name — a second copy
 *    of a name is a second thing to keep in step.
 *  - **An unnamed id still renders.** The map can legitimately miss an id, and
 *    a row that vanishes takes a real performance off the leaderboard with it.
 *  - **Nothing at all is rendered when there is nothing.** A week that has not
 *    kicked off has no leaders, and a strip of zeros invents a leaderboard for
 *    a week nobody has played. `buildLeaders` filters to positive scores; this
 *    renders null when both lists come back empty.
 */
import type { JSX } from 'react';
import type { LiveLeaders } from '../../../types/live';
import type { PlayerMeta } from '../../../types/live-scoring';
import LvCrest from './LvCrest';

export interface LvLeadersProps {
  leaders: LiveLeaders | null | undefined;
  meta: Record<string, PlayerMeta>;
}

function fmt(points: number): string {
  return points.toFixed(1);
}

export default function LvLeaders({ leaders, meta }: LvLeadersProps): JSX.Element | null {
  if (!leaders) return null;
  const { teams, players } = leaders;
  if (teams.length === 0 && players.length === 0) return null;

  return (
    <div className="lv-leaders">
      {teams.length > 0 && (
        <section className="lv-leaders__group" aria-labelledby="lv-leaders-teams">
          <h3 className="lv-leaders__title" id="lv-leaders-teams">
            Top teams this week
          </h3>
          <ol className="lv-leaders__list">
            {teams.map((team, i) => (
              <li className="lv-leaders__row" key={team.franchiseId}>
                <span className="lv-leaders__pos">{i + 1}</span>
                <LvCrest
                  icon={team.icon}
                  iconAlt={team.iconAlt}
                  initials={team.initials}
                  block="lv-leaders"
                />
                <span className="lv-leaders__name">{team.nameShort || team.name}</span>
                {team.yetToPlay > 0 && (
                  <span className="lv-leaders__sub">{team.yetToPlay} to play</span>
                )}
                <span className="lv-leaders__pts">{fmt(team.live)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {players.length > 0 && (
        <section className="lv-leaders__group" aria-labelledby="lv-leaders-players">
          <h3 className="lv-leaders__title" id="lv-leaders-players">
            Top performances
          </h3>
          <ol className="lv-leaders__list">
            {players.map((row, i) => {
              const who = meta[row.playerId];
              // The map can miss an id, and dropping the row would take a real
              // performance off the board. Name it by id rather than hide it.
              const name = who?.name || `Player ${row.playerId}`;
              const position = who?.position ?? '';
              const nflTeam = who?.nflTeam ?? '';
              return (
                // The PAIR is the key: the same player started by two owners
                // is two legitimate rows, and in the AFL that is routine.
                <li className="lv-leaders__row" key={`${row.franchiseId}:${row.playerId}`}>
                  <span className="lv-leaders__pos">{i + 1}</span>
                  <span className="lv-leaders__name">
                    {name}
                    {(position || nflTeam) && (
                      <span className="lv-leaders__meta">
                        {[position, nflTeam].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="lv-leaders__sub">
                    {row.franchiseName}
                    {row.secondsRemaining <= 0 ? '' : ' · playing'}
                  </span>
                  <span className="lv-leaders__pts">{fmt(row.points)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
