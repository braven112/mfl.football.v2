/**
 * The two sides' lineups, paired row by row into SHARED grid tracks.
 *
 * The pairing is what makes the two sides' scores agree. Equal row heights are
 * not enough on their own: a one-line name and a two-line name put the score at
 * different offsets INSIDE their equal rows. Each pair therefore owns three
 * tracks (name / meta+score / stat) and each side adopts them with `subgrid`,
 * so the score is on track 2 for both sides whatever the names do.
 *
 * Rows are already ordered by `buildLiveTeam` — position first, then the
 * highest scorer within a position, then the player id so the result cannot
 * depend on how MFL happened to order the feed.
 */
import type { JSX } from 'react';
import type { LivePlayerRow, NflGame, PlayerBoxScore, PlayerMeta } from '../../../types/live-scoring';
import LvPlayerRow from './LvPlayerRow';

export interface LvLineupProps {
  side0: readonly LivePlayerRow[];
  side1: readonly LivePlayerRow[];
  meta: Record<string, PlayerMeta>;
  /** ESPN games by canonical NFL team code, for the clock and the red zone. */
  gamesByTeam?: Record<string, NflGame>;
  boxScore?: Record<string, PlayerBoxScore>;
  detailStatus?: 'ok' | 'error' | 'pending';
  /** Renders the dimmed bench treatment. */
  bench?: boolean;
}

export default function LvLineup({
  side0,
  side1,
  meta,
  gamesByTeam = {},
  boxScore = {},
  detailStatus = 'ok',
  bench = false,
}: LvLineupProps): JSX.Element {
  // The two sides can legitimately differ in length — a franchise may start
  // fewer players, and a bench is routinely lopsided. The pair count is the
  // longer of the two so no row is dropped.
  const rowCount = Math.max(side0.length, side1.length);
  const RowClass = bench ? 'lv-bench-row' : 'lv-mx-row';

  const cell = (row: LivePlayerRow | undefined, side: 'left' | 'right') => {
    if (!row) return <div />;
    const who = meta[row.id];
    return (
      <div>
        <LvPlayerRow
          row={row}
          meta={who}
          side={side}
          game={who?.nflTeam ? gamesByTeam[who.nflTeam] : undefined}
          box={boxScore[row.id]}
          detailStatus={detailStatus}
        />
      </div>
    );
  };

  return (
    <>
      {Array.from({ length: rowCount }).map((_, i) => (
        // The index is a stable key here: the list is re-derived every poll in
        // a fixed order, so row i is the same slot between renders even when a
        // player's numbers change.
        <div className={RowClass} key={i}>
          {cell(side0[i], 'left')}
          {cell(side1[i], 'right')}
        </div>
      ))}
    </>
  );
}
