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

  /**
   * THE COUNT IS SPLIT PER TEAM, never summed.
   *
   * A single total answers "how much football is left" but never "left for
   * WHOM", which is the question a board showing 87.0 – 106.5 is actually
   * being asked. Each number sits behind a dot in that side's own colour —
   * the same `--t0`/`--t1` the win-probability bar is drawn from — so the
   * first dot is always the first row and the pair needs no legend.
   *
   * It stays split when the two counts are EQUAL. A number that changes shape
   * depending on its value is harder to read at a glance than one that never
   * moves.
   *
   * Colour alone does not carry it: position matches the rows below, each
   * number carries a `title`, and the button's own `aria-label` spells both
   * out — that label is what a screen reader announces INSTEAD of this markup,
   * so a count left out of it is a count a screen reader never hears.
   */
  const showYtp = !isFinal && a.yetToPlay + b.yetToPlay > 0;
  const aName = a.nameShort || a.name;
  const bName = b.nameShort || b.name;
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
      {/* INK, not the fill pair: this is text, and `--t0`/`--t1` only clear ΔE
          against the card. See `resolveMatchupColorVars`. */}
      <span className="lv-side__score" style={{ color: `var(--t${which}-ink)` }}>
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
      aria-label={
        `Open ${a.name} against ${b.name}` +
        (showYtp
          ? `. ${aName} ${a.yetToPlay} to play, ${bName} ${b.yetToPlay} to play`
          : '') +
        `. Projected ${aName} ${fmt(a.projectedFinal)}, ${bName} ${fmt(b.projectedFinal)}`
      }
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
        {showYtp && (
          <span className="lv-rem">
            <span className="lv-rem__n" title={`${aName}: ${a.yetToPlay} to play`}>
              {/* A FILL, so `--t0`/`--t1` is right here — a dot is a shape
                  against the card, which is what ΔE measures. The ink pair is
                  for TEXT only. */}
              <span
                className="lv-rem__dot"
                style={{ background: `var(--t${first})` }}
                aria-hidden="true"
              />
              {a.yetToPlay}
            </span>
            <span className="lv-rem__n" title={`${bName}: ${b.yetToPlay} to play`}>
              <span
                className="lv-rem__dot"
                style={{ background: `var(--t${second})` }}
                aria-hidden="true"
              />
              {b.yetToPlay}
            </span>
            <span className="lv-rem__lbl">to play</span>
          </span>
        )}
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
        {/*
          The projected pair wears the SAME dot idiom as the head's "to play"
          count, and for the same reason: two numbers a row apart whose only
          tie to a team is their position. The fill pair again (`--t0`/`--t1`)
          — a dot is a shape against the card, which is what ΔE measures, so
          the ink pair would wash it for no reading benefit.

          The dash STAYS, unlike the "to play" pair. That one is a split count
          under one shared label; this is a score line, and `93.2 105.1` with
          nothing between them reads as one number that wrapped.

          Colour alone still does not carry it: the order matches the rows
          above, each number carries a `title`, and both projections are
          spelled out in the button's `aria-label` — the label a screen reader
          is read INSTEAD of this markup, which is why adding the dots meant
          adding the numbers there too.
        */}
        <span className="lv-foot__proj">
          Proj
          <span className="lv-foot__n" title={`${aName}: ${fmt(a.projectedFinal)} projected`}>
            <span
              className="lv-foot__dot"
              style={{ background: `var(--t${first})` }}
              aria-hidden="true"
            />
            {fmt(a.projectedFinal)}
          </span>
          <span aria-hidden="true">–</span>
          <span className="lv-foot__n" title={`${bName}: ${fmt(b.projectedFinal)} projected`}>
            <span
              className="lv-foot__dot"
              style={{ background: `var(--t${second})` }}
              aria-hidden="true"
            />
            {fmt(b.projectedFinal)}
          </span>
        </span>
        <span>Open matchup →</span>
      </div>
    </button>
  );
}
