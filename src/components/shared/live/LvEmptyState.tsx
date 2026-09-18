/**
 * Why a board, or one league's panel, has no matchups to show.
 *
 * FOUR states, not two. Collapsing any pair of them is how a board ends up
 * asserting something false:
 *
 *  - `not-played`  — an unplayed week is a well-formed payload of ZEROS:
 *                    every franchise present, every score "0.00", every
 *                    player `nonstarter`. `res.ok`, `data.ok`, a JSON shape
 *                    check and a franchise COUNT all pass it. Printing it
 *                    literally gives "0.0 – 0.0", which reads as a real game
 *                    nobody scored in — the bug this state exists to prevent.
 *                    Only `hasLiveSignal` can tell it from a genuine 0-0.
 *  - `no-matchup`  — the feed is fine and scoring; this viewer simply has no
 *                    pairing. A bye is a fact, not a fault.
 *  - `unavailable` — we could not READ it. Never conflated with the two
 *                    above: "the feed says nothing" and "we could not reach
 *                    the feed" are different facts, and they stay different
 *                    all the way to the pixel — this one takes the error
 *                    tone so they are not confusable at a glance.
 *  - `pre-season`  — MFL serves no live scoring before the Week 1 Thursday,
 *                    and `getCurrentNFLWeek` returns 0 until then. Clamping
 *                    that up to 1 is what hides the gap, so it is its own
 *                    state rather than an error.
 */
import type { JSX } from 'react';
import type { LiveLeagueStatus } from '../../../types/live';

/** `LiveLeagueStatus` minus `ok`, plus the pre-kickoff window. */
export type LvEmptyReason = Exclude<LiveLeagueStatus, 'ok'> | 'pre-season';

export interface LvEmptyStateProps {
  reason: LvEmptyReason;
  /** The league this panel is for, when the board holds several. */
  leagueName?: string;
}

const COPY: Record<LvEmptyReason, { title: string; body: string }> = {
  'not-played': {
    title: 'This week hasn’t kicked off',
    body: 'Scores appear here once the games start. Nothing has been played yet, so there is nothing to show — this is not a 0-0.',
  },
  'no-matchup': {
    title: 'No matchup this week',
    body: 'The league is scoring normally; you just don’t have a game on the schedule.',
  },
  unavailable: {
    title: 'Couldn’t read this league',
    body: 'We reached for the scores and didn’t get them. These are missing, not zero. Refreshing usually sorts it.',
  },
  'pre-season': {
    title: 'The season hasn’t started',
    body: 'MyFantasyLeague doesn’t score a week until it begins. This board fills itself in the moment Week 1 does.',
  },
};

export default function LvEmptyState({ reason, leagueName }: LvEmptyStateProps): JSX.Element {
  const copy = COPY[reason];
  return (
    <div className={`lv-empty lv-empty--${reason}`} role="status">
      <p className="lv-empty__title">
        {leagueName ? `${leagueName} — ${copy.title}` : copy.title}
      </p>
      <p className="lv-empty__body">{copy.body}</p>
    </div>
  );
}
