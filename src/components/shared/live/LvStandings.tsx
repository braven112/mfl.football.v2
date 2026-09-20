/**
 * One league's standings — MFL's rows, in MFL's order.
 *
 * ── THE ORDER IS NOT OURS TO IMPROVE ──────────────────────────────────────
 * This component sorts nothing and ranks nothing. MFL returns standings in the
 * league's official order with that league's constitution tiebreaker chain
 * already applied — Power Rank, Victory Points, head-to-head — and we cannot
 * reproduce it. Homebrew tiebreakers miscredited 22 AFL and 10 TheLeague
 * division titles before the rule existed that forbids this.
 * `docs/claude/rules/standings-brackets-draft-order.md`.
 *
 * `row.rank` is the feed's own position. If this table ever needs to filter,
 * the numbers stay as they are — renumbering a filtered list would invent a
 * standing MFL never gave.
 *
 * ── AND THESE ARE NOT LIVE ────────────────────────────────────────────────
 * A standing changes when a game goes FINAL, so these records deliberately do
 * not move with the scores on the other tab. The caption says so, because a
 * table that looks live and is not is worse than one that admits it.
 */
import type { JSX } from 'react';
import type { LiveStandingsRow } from '../../../types/live';
import LvCrest from './LvCrest';

export interface LvStandingsProps {
  /** MFL's rows, or null when the read failed. Never an empty array for that. */
  rows: LiveStandingsRow[] | null;
  leagueName: string;
}

/** One decimal, the same as every score on this board. */
function fmt(points: number): string {
  return points.toFixed(1);
}

function record(row: LiveStandingsRow): string {
  // Ties are dropped from the label only when the league does not play them —
  // a league that does would read "10-3" for a 10-3-1 season, which is a
  // different record.
  return row.ties > 0
    ? `${row.wins}-${row.losses}-${row.ties}`
    : `${row.wins}-${row.losses}`;
}

export default function LvStandings({ rows, leagueName }: LvStandingsProps): JSX.Element {
  if (rows === null) {
    // "We could not read it" is never rendered as an empty table — the same
    // distinction `unavailable` keeps from `no-matchup` on the scores tab.
    return (
      <div className="lv-empty lv-empty--unavailable" role="status">
        <p className="lv-empty__title">Couldn’t read the standings</p>
        <p className="lv-empty__body">
          We reached MyFantasyLeague for {leagueName}’s standings and didn’t get them. These
          are missing, not zeros. Refreshing usually sorts it.
        </p>
      </div>
    );
  }

  return (
    <div className="lv-standings">
      <table className="lv-standings__table">
        <caption className="lv-standings__caption">
          {leagueName} — in MyFantasyLeague’s own order. Records update when games go final,
          not with the live scores.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="lv-standings__rank">#</th>
            <th scope="col">Team</th>
            <th scope="col" className="lv-standings__num">W-L</th>
            <th scope="col" className="lv-standings__num">PF</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.franchiseId}
              className={row.isViewer ? 'lv-standings__row lv-standings__row--you' : 'lv-standings__row'}
            >
              <td className="lv-standings__rank">{row.rank}</td>
              <th scope="row" className="lv-standings__team">
                <LvCrest
                  icon={row.icon}
                  iconAlt={row.iconAlt}
                  initials={row.initials}
                  block="lv-standings"
                />
                <span className="lv-standings__name">{row.nameShort || row.name}</span>
                {/* Not colour alone: the row tints AND says so, because a tint
                    is invisible to a screen reader and to anyone who cannot
                    separate it from the stripe above it. */}
                {row.isViewer && <span className="lv-standings__you">You</span>}
              </th>
              <td className="lv-standings__num">{record(row)}</td>
              <td className="lv-standings__num">{fmt(row.pointsFor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
