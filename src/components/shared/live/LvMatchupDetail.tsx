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
 * The back control only. There is NO freshness pill here: the board header
 * (Week picker + pill) stays on screen while a matchup is open, and a second
 * copy in this row printed "Tracking · updated Ns ago" twice, one line apart.
 * The row's inline inset lives on the ROW, not on the button, so anything
 * added to it and wrapped on a phone starts at the same x as the button.
 */
import type { JSX } from 'react';
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
  onBack,
}: LvMatchupDetailProps): JSX.Element {
  const [first, second] = renderOrder(matchup, viewerFirst);
  const a: LiveTeam = matchup.sides[first];
  const b: LiveTeam = matchup.sides[second];
  const pFirst = winProbabilityFor(matchup, first);
  // The header is top-aligned, so the "today's name" line is all-or-nothing:
  // when only one side's Throwback era renamed its club, the other side holds
  // an empty placeholder line or its score sits one line higher.
  const holdsCurrentLine = Boolean(a.currentName || b.currentName);
  const currentLine = (t: LiveTeam) =>
    t.currentName ? (
      <div className="lv-scorehead__current">{t.currentName}</div>
    ) : (
      holdsCurrentLine && (
        <div className="lv-scorehead__current lv-scorehead__current--empty" aria-hidden="true">
          {'\u00a0'}
        </div>
      )
    );

  return (
    <div className="lv-detail lv-matchup" style={matchup.colorVars}>
      <div className="lv-detail__top">
        <button type="button" className="lv-back" onClick={onBack}>
          ← All matchups
        </button>
      </div>

      {/* The scores take the INK pair, not the fill pair: `--t0`/`--t1` only
          clear ΔE against the card and are unreadable as text for some
          franchises. See `resolveMatchupColorVars`. */}
      <div className="lv-scorehead">
        <div className="lv-scorehead__side">
          <div className="lv-scorehead__name">{a.nameShort || a.name}</div>
          {currentLine(a)}
          <div className="lv-scorehead__score" style={{ color: `var(--t${first}-ink)` }}>
            {fmt(a.live)}
          </div>
        </div>
        <span className="lv-scorehead__at">@</span>
        <div className="lv-scorehead__side lv-scorehead__side--right">
          <div className="lv-scorehead__name">{b.nameShort || b.name}</div>
          {currentLine(b)}
          <div className="lv-scorehead__score" style={{ color: `var(--t${second}-ink)` }}>
            {fmt(b.live)}
          </div>
        </div>
      </div>

      {!isFinal && (
        <div className="lv-detail__wp">
          <LvWinProbBar
            p0={pFirst}
            side0Tone={first}
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
