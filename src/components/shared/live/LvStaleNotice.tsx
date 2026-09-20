/**
 * "These scores are the last ones we could confirm."
 *
 * The visible half of `utils/live/stale.ts`. A held panel renders as an
 * ordinary panel — same cards, same numbers, same win-probability bars — so
 * without this strip it is indistinguishable from a live one, and an
 * unlabelled stale score is a worse bug than the error card it replaces. The
 * strip is what makes holding them honest, which is why the board renders it
 * from `heldSince` rather than from anything a poll could forget to set.
 *
 * ── WHY A RELATIVE AGE AND NOT A CLOCK TIME ───────────────────────────────
 * "as of 10:28" needs a timezone, and printing a time on a league surface is
 * governed by the viewer's chosen clock plus the league's own
 * (`docs/claude/rules/viewer-preferences.md`) — a whole resolution this
 * element has no business carrying for a caption that exists for ninety
 * seconds. An age needs no zone, cannot be wrong for a reader in another
 * country, and matches the freshness pill beside it, which already speaks in
 * ages. `formatFeedAge` is imported rather than reimplemented so the two
 * cannot drift into disagreeing about the same instant.
 *
 * ── WHY IT TICKS ──────────────────────────────────────────────────────────
 * The same reason the pill does, and the tick is LOCAL for the same reason: an
 * interval one level up would re-render every starter row on the board once a
 * second. The board itself only re-renders on a poll, which at the idle
 * cadence is 90 seconds — a caption that said "1m ago" for a minute and a half
 * would be the second wrong number on a screen that is already apologising for
 * its first.
 */
import { useEffect, useState, type JSX } from 'react';
import { formatFeedAge } from '../../../utils/live-scoring-view';

export interface LvStaleNoticeProps {
  /** When these scores were last confirmed. */
  heldSince: number;
}

export default function LvStaleNotice({ heldSince }: LvStaleNoticeProps): JSX.Element {
  /**
   * Seeded from the CLOCK, not from `heldSince`.
   *
   * Normally a clock read during render is a hydration mismatch, which is why
   * the freshness pill starts at 0 and lets its effect fill it in. This
   * element cannot hit that: it renders only when a panel is being held, a
   * panel is held only from the island's per-mount memory, and that memory is
   * empty on the server — the first poll that fails is the earliest anything
   * can be held, and that is long after hydration.
   *
   * Seeding from `heldSince` instead would make the first render say "just
   * now" about scores that are ninety seconds old, which is the one sentence
   * this element exists to stop the board telling.
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [heldSince]);

  const age = formatFeedAge(Math.max(0, now - heldSince));

  return (
    <p className="lv-stale" role="status">
      <span className="lv-stale__mark" aria-hidden="true" />
      <span>
        <strong className="lv-stale__lead">Showing the last scores we could confirm</strong>
        {age && <span className="lv-stale__age"> — from {age}.</span>} We can’t reach
        MyFantasyLeague right now and are still trying.
      </span>
    </p>
  );
}
