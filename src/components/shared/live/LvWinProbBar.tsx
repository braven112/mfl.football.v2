/**
 * The win-probability split bar.
 *
 * ── THE A11Y FIX ──────────────────────────────────────────────────────────
 * The board this is ported from puts `role="img"` + `aria-label` on the bar's
 * WRAPPER. That makes the element a LEAF: its whole subtree is replaced by the
 * label, so the percentages, the "WIN PROBABILITY" tag and the yet-to-play
 * counts inside are never announced. `live-scoring.css` has a comment
 * documenting that exact consequence and working around it — a phone-width
 * rule that visually hides one copy of the counts rather than removing it,
 * "because its subtree is replaced by the bar's aria-label and never
 * announced".
 *
 * So the bar is `aria-hidden` here and ONE `visually-hidden` sentence carries
 * the numbers. That needs no workaround: there is exactly one announced copy
 * at every width, and the visual markup is free to duplicate or drop whatever
 * the layout needs.
 *
 * `.visually-hidden` is the global utility from `utilities.css`, which both
 * `TheLeagueLayout` and `MflAppLayout` import — so it resolves on every
 * surface this kit renders on.
 *
 * ── LEFT TO RIGHT, IN THE CALLER'S ORDER ──────────────────────────────────
 * `side0` is whichever team the caller renders on the LEFT, and it is drawn on
 * the left — so the bar reads in the same order as the score header above it.
 * It used to draw side 1 on the left, which mirrored every detail view: the
 * left team's score sat over the right team's share (Sep 2026).
 *
 * The COLOUR is a separate question, because a caller may reorder the pair
 * (`renderOrder` puts the viewer first on MFL Live) while `--t0`/`--t1` stay
 * keyed to the matchup's own sides. `side0Tone` names which of the two the
 * left team wears; it defaults to 0, and the right team always wears the other.
 */
import type { JSX } from 'react';

export interface LvWinProbBarProps {
  /** Probability side 0 wins, 0-1. */
  p0: number;
  /** Display names, for the announced sentence. */
  side0Name: string;
  side1Name: string;
  /** Thin variant for a collapsed card: bar only, no labels. */
  mini?: boolean;
  /**
   * Starters yet to play, folded into the percentage labels. Optional because
   * a final matchup has none to report and the caller may have the room for
   * its own line instead.
   */
  side0YetToPlay?: number;
  side1YetToPlay?: number;
  /** Which matchup colour (`--t0` / `--t1`) side 0 wears. Defaults to 0. */
  side0Tone?: 0 | 1;
}

export default function LvWinProbBar({
  p0,
  side0Name,
  side1Name,
  mini,
  side0YetToPlay,
  side1YetToPlay,
  side0Tone = 0,
}: LvWinProbBarProps): JSX.Element {
  // Rounded ONCE and the complement derived from it, so the two never sum to
  // 101%: rounding each side independently does that for any x.5 split.
  const pct0 = Math.round(Math.min(Math.max(p0, 0), 1) * 100);
  const pct1 = 100 - pct0;
  const tone0 = side0Tone;
  const tone1 = side0Tone === 0 ? 1 : 0;

  return (
    <div className={`lv-wp${mini ? ' lv-wp--mini' : ''}`}>
      {/* The numbers, once, for assistive tech. Never inside the bar. */}
      <span className="visually-hidden">
        {`Win probability: ${side0Name} ${pct0}%, ${side1Name} ${pct1}%.`}
      </span>

      <div
        className="lv-wp__track"
        aria-hidden="true"
        // The seam rides the split rather than sitting at 50%.
        style={{ ['--lv-wp-split' as string]: `${pct0}%` }}
      >
        <div className={`lv-wp__fill${tone0}`} style={{ width: `${pct0}%` }} />
        <div className={`lv-wp__fill${tone1}`} style={{ width: `${pct1}%` }} />
        <span className="lv-wp__seam" />
      </div>

      {!mini && (
        <div className="lv-wp__labels" aria-hidden="true">
          <span className={`lv-wp__l lv-wp__ink${tone0}`}>
            {pct0}%
            {side0YetToPlay !== undefined && (
              <em className="lv-wp__ytp"> · {side0YetToPlay} to play</em>
            )}
          </span>
          <span className="lv-wp__tag">WIN PROBABILITY</span>
          <span className={`lv-wp__r lv-wp__ink${tone1}`}>
            {side1YetToPlay !== undefined && (
              <em className="lv-wp__ytp">{side1YetToPlay} to play · </em>
            )}
            {pct1}%
          </span>
        </div>
      )}
    </div>
  );
}
