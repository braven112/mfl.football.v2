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
 * ── THREE VIEWS, AND ONLY ONE IS OFFICIAL ─────────────────────────────────
 * Live (the default) adds this week's matchups as they stand right now;
 * Projected adds them as each side's projected final; Final is MFL's table
 * untouched. Live and Projected RE-RANK — the one sanctioned exception to the
 * rule above, allowed only because they are labelled as a what-if and every
 * row that moved says where it officially sits. The maths, and why a finished
 * week is never counted twice, live in `utils/live/standings-projection.ts`.
 */
import { useMemo, useState, type JSX } from 'react';
import type { LiveMatchup, LiveStandingsRow } from '../../../types/live';
import {
  DEFAULT_STANDINGS_MODE,
  STANDINGS_MODES,
  STANDINGS_MODE_LABEL,
  projectStandings,
  type ProjectedStandingsRow,
  type StandingsMode,
} from '../../../utils/live/standings-projection';
import LvMark from './LvMark';

export interface LvStandingsProps {
  /** MFL's rows, or null when the read failed. Never an empty array for that. */
  rows: LiveStandingsRow[] | null;
  leagueName: string;
  /** This week's matchups — what the Live and Projected views add. */
  matchups?: readonly LiveMatchup[];
  /** Starting view. Live unless a story says otherwise. */
  initialMode?: StandingsMode;
  /**
   * A view chosen OUTSIDE this table. When set, the table follows it and draws
   * no toggle of its own — `/live/standings` stacks one table per league under
   * a single switch, and a second switch per table would let them disagree.
   */
  mode?: StandingsMode;
}

function caption(mode: StandingsMode, leagueName: string, addsWeek: boolean): string {
  if (mode !== 'final' && !addsWeek) {
    return `${leagueName} — nothing from this week to add yet, so this is MyFantasyLeague’s own order.`;
  }
  switch (mode) {
    case 'live':
      return `${leagueName} — if every game ended right now. This week’s scores are added to each record and the table re-ranked by record, then points; MFL’s tiebreakers apply only to Final.`;
    case 'projected':
      return `${leagueName} — if every game ends as projected. This week’s projected finals are added to each record and the table re-ranked by record, then points; MFL’s tiebreakers apply only to Final.`;
    case 'final':
      return `${leagueName} — in MyFantasyLeague’s own order. Records update when games go final, not with the live scores.`;
  }
}

/** Where the row officially sits, when this view moved it. */
function Move({ row }: { row: ProjectedStandingsRow }): JSX.Element | null {
  if (row.move === 0) return null;
  const up = row.move > 0;
  return (
    <span
      className={`lv-standings__move lv-standings__move--${up ? 'up' : 'down'}`}
      title={`Officially #${row.officialRank}`}
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}{Math.abs(row.move)}</span>
      <span className="visually-hidden">
        {up ? 'up' : 'down'} {Math.abs(row.move)} from official #{row.officialRank}
      </span>
    </span>
  );
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

export default function LvStandings({
  rows,
  leagueName,
  matchups = [],
  initialMode = DEFAULT_STANDINGS_MODE,
  mode: controlledMode,
}: LvStandingsProps): JSX.Element {
  const [ownMode, setMode] = useState<StandingsMode>(initialMode);
  const mode = controlledMode ?? ownMode;
  const view = useMemo(
    () => (rows === null ? null : projectStandings(rows, matchups, mode)),
    [rows, matchups, mode],
  );

  if (rows === null || view === null) {
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
    <div className="lv-standings-wrap">
      {/* Toggle buttons, the same pattern as Scores / Standings above. */}
      {controlledMode === undefined && (
        <div className="lv-tabs lv-tabs--mode" role="group" aria-label="Standings view">
          {STANDINGS_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`lv-tabs__btn${mode === m ? ' lv-tabs__btn--on' : ''}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {STANDINGS_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
      <div className="lv-standings">
        <table className="lv-standings__table">
          <caption className="lv-standings__caption">
            {caption(mode, leagueName, view.some((r) => r.includesWeek))}
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
            {view.map((row) => (
              <tr
                key={row.franchiseId}
                className={row.isViewer ? 'lv-standings__row lv-standings__row--you' : 'lv-standings__row'}
              >
                <td className="lv-standings__rank">
                  {row.rank}
                  <Move row={row} />
                </td>
                <th scope="row" className="lv-standings__team">
                  <LvMark
                    icon={row.icon}
                    alt={row.iconAlt}
                    initials={row.initials}
                    crop={row.rung === 'mfl'}
                    classes={{ wrap: 'lv-standings__crest', crop: 'lv-standings__crest--crop', text: 'lv-standings__initials' }}
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
    </div>
  );
}
