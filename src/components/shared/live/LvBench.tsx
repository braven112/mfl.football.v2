/**
 * The bench, behind a disclosure, labelled and dimmed AS A GROUP.
 *
 * Two lists rather than one list with a flag, all the way down: bench rows
 * never enter `players`, so nothing can sum them by accident. A bench row
 * folded into the starters inflates the projected final and the
 * win-probability bar with points that cannot be scored, and puts bench
 * touchdowns in a matchup ticker.
 *
 * It stays TWO columns, matching the starter rows directly above it — an owner
 * compares his bench against his lineup, and a stacked bench would put both
 * teams' benches in one scroll column with nothing but the caption to say
 * which is which. The caption is the only thing that does say, which is why it
 * is a team header rather than a small label (owner direction, Aug 2026).
 */
import { useState, type JSX } from 'react';
import type { LivePlayerRow, NflGame, PlayerBoxScore, PlayerMeta } from '../../../types/live-scoring';
import LvLineup from './LvLineup';

export interface LvBenchProps {
  side0: readonly LivePlayerRow[];
  side1: readonly LivePlayerRow[];
  side0Name: string;
  side1Name: string;
  meta: Record<string, PlayerMeta>;
  gamesByTeam?: Record<string, NflGame>;
  boxScore?: Record<string, PlayerBoxScore>;
  detailStatus?: 'ok' | 'error' | 'pending';
}

export default function LvBench({
  side0,
  side1,
  side0Name,
  side1Name,
  meta,
  gamesByTeam,
  boxScore,
  detailStatus,
}: LvBenchProps): JSX.Element | null {
  const [open, setOpen] = useState(false);

  // A franchise with no bench is ABSENT from the snapshot's map, so render no
  // control at all rather than one that opens onto nothing.
  const total = side0.length + side1.length;
  if (total === 0) return null;

  return (
    <div className="lv-bench">
      <button
        type="button"
        className="lv-bench__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} Bench ({total})
      </button>

      {open && (
        <>
          <div className="lv-bench__caps">
            <span className="lv-bench__cap">{side0Name}</span>
            <span className="lv-bench__cap lv-bench__cap--right">{side1Name}</span>
          </div>
          {total > 0 ? (
            <LvLineup
              bench
              side0={side0}
              side1={side1}
              meta={meta}
              gamesByTeam={gamesByTeam}
              boxScore={boxScore}
              detailStatus={detailStatus}
            />
          ) : (
            <div className="lv-bench__none">No bench players</div>
          )}
        </>
      )}
    </div>
  );
}
