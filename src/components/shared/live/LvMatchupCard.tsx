/**
 * One matchup, collapsed to its header. Tapping it drills in.
 *
 * ── SIDES, NOT TEAMS ──────────────────────────────────────────────────────
 * The card renders `sides[0]` and `sides[1]` in MFL's own pairing order, and
 * asks `renderOrder` whether to put the viewer first. That is a presentation
 * choice kept OUT of the data, so one payload serves both boards: MFL Live is
 * a board OF your teams and puts yours first; a league board keeps MFL's order,
 * because most of its cards are nobody's and reordering only some of them
 * reads as inconsistent.
 *
 * ── THE EMPTY CARD IS A DIV ───────────────────────────────────────────────
 * Not a button: no pointer, no hover accent, and no win-probability bar. That
 * bar encodes a matchup's win share, and over an empty card it renders as a
 * stray grey bar that reads as a scrollbar rather than a border.
 */
import type { JSX } from 'react';
import type { LiveMatchup, LiveTeam } from '../../../types/live';
import { renderOrder, winProbabilityFor } from '../../../utils/live/model';
import LvWinProbBar from './LvWinProbBar';

const fmt = (n: number) => n.toFixed(1);

export interface LvMatchupCardProps {
  matchup: LiveMatchup;
  /** Put the viewer's own team first. True on a cross-league board. */
  viewerFirst?: boolean;
  /** Every starter's game is final. Drops the win-prob bar and the live dot. */
  isFinal?: boolean;
  /**
   * This card LEADS its panel — the viewer's own matchup, or the closest game
   * promoted in its place. Presentation only: the "YOUR MATCHUP" badge is
   * decided by `viewerSide`, never by this, so a promoted filler is rendered
   * large without claiming to be anybody's.
   */
  lead?: boolean;
  onOpen: () => void;
}

export default function LvMatchupCard({
  matchup,
  viewerFirst = false,
  isFinal = false,
  lead = false,
  onOpen,
}: LvMatchupCardProps): JSX.Element {
  const [first, second] = renderOrder(matchup, viewerFirst);
  const a: LiveTeam = matchup.sides[first];
  const b: LiveTeam = matchup.sides[second];
  const pFirst = winProbabilityFor(matchup, first);

  const yetToPlay = a.yetToPlay + b.yetToPlay;
  const aLeads = a.live >= b.live;

  // `ahead` is which SIDE is winning, not whether this CARD leads its panel —
  // two different "lead"s, and naming them the same shadowed the prop.
  const sideRow = (team: LiveTeam, ahead: boolean, which: 0 | 1) => (
    <div className={`lv-side${ahead ? ' lv-side--lead' : ''}`}>
      {team.icon ? (
        <span className="lv-side__crest">
          <img src={team.icon} alt={team.iconAlt} loading="lazy" />
        </span>
      ) : (
        // The identity ladder's text rung. Initials are a LABEL, not invented
        // artwork — no fabricated crest and no hue derived from the name.
        <span className="lv-side__initials" aria-hidden="true">
          {team.initials}
        </span>
      )}
      <span className="lv-side__name">{team.nameShort || team.name}</span>
      <span className="lv-side__proj">{fmt(team.projectedFinal)}</span>
      <span className="lv-side__score" style={{ color: `var(--t${which})` }}>
        {fmt(team.live)}
      </span>
    </div>
  );

  return (
    <button
      type="button"
      className={`lv-card lv-matchup${lead ? ' lv-card--lead' : ''}`}
      style={matchup.colorVars}
      onClick={onOpen}
      aria-label={`Open ${a.name} against ${b.name}`}
    >
      <div className="lv-card__head">
        {isFinal ? (
          <span className="lv-badge lv-badge--final">Final</span>
        ) : (
          <span className="lv-badge lv-badge--live">
            <span className="lv-dot lv-dot--live" />
            Live
          </span>
        )}
        {!isFinal && yetToPlay > 0 && <span>{yetToPlay} to play</span>}
        {matchup.viewerSide !== null && <span className="lv-card__yours">YOUR MATCHUP</span>}
      </div>

      <div className="lv-sides">
        {sideRow(a, aLeads, first)}
        {sideRow(b, !aLeads, second)}
      </div>

      {!isFinal && (
        <LvWinProbBar
          mini
          p0={pFirst}
          side0Name={a.name}
          side1Name={b.name}
        />
      )}

      <div className="lv-card__foot">
        <span>
          Proj {fmt(a.projectedFinal)} – {fmt(b.projectedFinal)}
        </span>
        <span>Open matchup →</span>
      </div>
    </button>
  );
}
