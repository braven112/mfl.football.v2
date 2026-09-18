/**
 * The drill-in screen: one matchup, both lineups, and a way back.
 *
 * ── IT REPLACES THE BOARD, AND THAT IS THE DECISION ───────────────────────
 * Drill-in on every surface (decided). The board's SHELL stays mounted around
 * this — the NFL games rail and the red-zone banner live outside the
 * `selected ? detail : board` branch — because red zone is a persistent STATE
 * and a live drive must not vanish because somebody opened a matchup.
 *
 * ── THE TOP ROW ───────────────────────────────────────────────────────────
 * The back control and the freshness pill share it, so the pill is on screen
 * before an owner scrolls: on a phone this header IS the first screen. The
 * row's inline inset lives on the ROW, not on the button, so that when it wraps
 * the pill starts at the same x as the button above it.
 */
import type { JSX, ReactNode } from 'react';
import type { LiveMatchup, LiveMoment, LiveTeam } from '../../../types/live';
import type { NflGame, PlayerBoxScore, PlayerMeta } from '../../../types/live-scoring';
import { renderOrder, winProbabilityFor } from '../../../utils/live/model';
import LvWinProbBar from './LvWinProbBar';
import LvLineup from './LvLineup';
import LvBench from './LvBench';
import LvMomentTicker from './LvMomentTicker';

const fmt = (n: number) => n.toFixed(1);

export interface LvMatchupDetailProps {
  matchup: LiveMatchup;
  meta: Record<string, PlayerMeta>;
  gamesByTeam?: Record<string, NflGame>;
  boxScore?: Record<string, PlayerBoxScore>;
  detailStatus?: 'ok' | 'error' | 'pending';
  /** This matchup's scoring plays, already selected and deduped. */
  moments?: LiveMoment[];
  /**
   * How the play feed is doing. 'error' is NOT "no plays" — an empty ticker
   * during an ESPN outage lets an owner believe his starters did nothing.
   */
  momentStatus?: 'idle' | 'ok' | 'error';
  /** Some games could not be expanded. Normal, and said out loud. */
  momentPartial?: boolean;
  viewerFirst?: boolean;
  isFinal?: boolean;
  /** The freshness pill, rendered by the board so it keeps its own ticker. */
  status?: ReactNode;
  onBack: () => void;
}

export default function LvMatchupDetail({
  matchup,
  meta,
  gamesByTeam,
  boxScore,
  detailStatus,
  moments,
  momentStatus,
  momentPartial,
  viewerFirst = false,
  isFinal = false,
  status,
  onBack,
}: LvMatchupDetailProps): JSX.Element {
  const [first, second] = renderOrder(matchup, viewerFirst);
  const a: LiveTeam = matchup.sides[first];
  const b: LiveTeam = matchup.sides[second];
  const pFirst = winProbabilityFor(matchup, first);

  return (
    <div className="lv-detail lv-matchup" style={matchup.colorVars}>
      <div className="lv-detail__top">
        <button type="button" className="lv-back" onClick={onBack}>
          ← All matchups
        </button>
        {status}
      </div>

      <div className="lv-scorehead">
        <div className="lv-scorehead__side">
          <div className="lv-scorehead__name">{a.nameShort || a.name}</div>
          <div className="lv-scorehead__score" style={{ color: `var(--t${first})` }}>
            {fmt(a.live)}
          </div>
        </div>
        <span className="lv-scorehead__at">@</span>
        <div className="lv-scorehead__side lv-scorehead__side--right">
          <div className="lv-scorehead__name">{b.nameShort || b.name}</div>
          <div className="lv-scorehead__score" style={{ color: `var(--t${second})` }}>
            {fmt(b.live)}
          </div>
        </div>
      </div>

      {!isFinal && (
        <div className="lv-detail__wp">
          <LvWinProbBar
            p0={pFirst}
            side0Name={a.name}
            side1Name={b.name}
            side0YetToPlay={a.yetToPlay}
            side1YetToPlay={b.yetToPlay}
          />
        </div>
      )}

      <div className="lv-mx-body">
        <LvLineup
          side0={a.players}
          side1={b.players}
          meta={meta}
          gamesByTeam={gamesByTeam}
          boxScore={boxScore}
          detailStatus={detailStatus}
        />
        <LvBench
          side0={a.bench}
          side1={b.bench}
          side0Name={a.nameShort || a.name}
          side1Name={b.nameShort || b.name}
          meta={meta}
          gamesByTeam={gamesByTeam}
          boxScore={boxScore}
          detailStatus={detailStatus}
        />
      </div>

      <LvMomentTicker
        moments={moments ?? []}
        status={momentStatus}
        partial={momentPartial}
      />
    </div>
  );
}
