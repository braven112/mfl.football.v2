/**
 * The waiver-day composite hero's copy, for any league.
 *
 * The AFL shipped this card first ("CLAIMS RUN TONIGHT." over a free agent's
 * cutout); TheLeague renders the SAME component (`LeagueCompositeHero`) from the
 * same view, in its own palette and with its own free-agent pool, so the two
 * leagues cannot drift into two different waiver days. The copy comes from
 * `waiverDeadlineCopy` (MFL's calendar), and the three-state rule (`cleared`
 * is `mode === 'fcfs'`, never `!open`) is applied once, here.
 *
 * Pure on purpose: the AFL resolver imports this, so no feed reads. The face
 * is cast by each league's caller (`castTopFreeAgentModel`, 'Top Target').
 */
import type { CompositeHeroTreatment } from '../types/composite-hero';
import type { EventHeroView } from './afl-hero-resolver';
import { waiverDeadlineCopy, type WaiverDeadlineCopy } from './waiver-deadline-copy';

/** Used when the route supplied no copy: names no day rather than guessing one. */
export function unknownWaiverCopy(now: Date): WaiverDeadlineCopy {
  return waiverDeadlineCopy(
    { mode: 'unknown', changesAt: null, nextMode: 'unknown', nextProcesses: false, reason: 'No waiver copy supplied to the hero.' },
    { now },
  );
}

export type WaiverClaimsHeroView = Pick<
  EventHeroView,
  'pill' | 'headline' | 'accentWord' | 'summary' | 'link' | 'linkLabel' | 'composite' | 'countValue' | 'countLabel'
>;

export function waiverClaimsHeroView(
  copy: WaiverDeadlineCopy,
  /**
   * `composite` is the caller's, as a literal: /showcase's guard reads the
   * AFL's treatments out of the resolver source, and each league wears its own
   * palette. Use the `WAIVERS` wordmark and `scope: 'league'` — the face is a
   * FREE AGENT, so there is no club whose colours the card could honestly wear.
   */
  opts: { link: string; composite: CompositeHeroTreatment },
): WaiverClaimsHeroView {
  // `cleared` is `mode === 'fcfs'`, NOT `!open`. Three states, two
  // presentations: an unreadable calendar is neither open nor cleared, and
  // reading it as cleared rendered "CLAIMS HAVE SOON." over a summary saying
  // claims were still queued. Unknown takes the claim-window wording,
  // because this slot only runs inside that window in both leagues.
  const cleared = copy.mode === 'fcfs';
  return {
    pill: cleared ? 'WAIVERS CLEARED' : 'WAIVER DAY',
    headline: cleared ? 'CLAIMS HAVE' : 'CLAIMS RUN',
    accentWord: copy.accentWord,
    summary: copy.summary,
    link: opts.link,
    linkLabel: cleared ? 'BROWSE FREE AGENTS' : 'SET YOUR CLAIMS',
    composite: opts.composite,
    countValue: copy.countValue,
    countLabel: copy.countLabel,
  };
}
