/**
 * Holding the last scores we could confirm, rather than wiping them.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 * A board poll and a LEAGUE READ are two different requests, and only the
 * first one is on the wire between the browser and us. `LiveBoard`'s poller
 * already keeps the last good board when the poll itself fails (`ok !== false`
 * — a rule with its own history), but that guard never fires for the failure
 * owners actually see: the poll succeeds, `/api/live-board` answers 200, and
 * one or both PANELS inside it come back `unavailable` because MFL did not
 * answer us server-side. The board then replaced live scores with "Couldn't
 * read this league" while its own freshness pill said "Live · updated just
 * now" — the pill was telling the truth about the poll and the panel was
 * telling the truth about the league, and together they read as a broken page.
 * (Owner report with a screenshot, 2026-09-20 10:33 PT; the production logs
 * for that minute show every `/api/live-board` returning 200.)
 *
 * So `unavailable` now degrades the way a dropped poll does: the last panel we
 * could confirm stays on screen, marked with WHEN it was confirmed, and only
 * after `STALE_HOLD_MS` of never reaching the league again does the board
 * admit it has nothing. Scores from four minutes ago are worth more to someone
 * watching their game than an error card is, as long as the screen says so —
 * an unlabelled held score is the worse bug in the other direction, which is
 * why `heldSince` travels with the panel rather than being inferred.
 *
 * ── WHAT IS DELIBERATELY NOT HELD ─────────────────────────────────────────
 * Only `unavailable`. `not-played`, `no-matchup` and `ok` are all answers from
 * a feed we READ successfully, and substituting older scores for any of them
 * would be inventing a state MFL did not report — the same "the feed says
 * nothing" / "we could not reach the feed" merge the four statuses exist to
 * prevent. A week that has just ended legitimately goes quiet; a bye is a
 * fact. Neither is a failure and neither gets papered over.
 *
 * ── THE MEMORY IS PER (WEEK, LEAGUE) AND LIVES IN THE ISLAND ──────────────
 * Per week because the week picker changes what is on screen without
 * remounting: a held Week 2 panel resurfacing under Week 3 would be a score
 * from another game entirely. Per league because both registry leagues have a
 * franchise `0001` and a cross-league board holds several panels at once.
 *
 * In the ISLAND, and nowhere else: this is session memory, so a fresh page
 * load whose server-side assembly failed still shows the error card. That is
 * accepted — the alternative is a per-user server cache of every league's
 * scores, which is a durability problem for a display bug.
 */
import type { LivePanel } from '../../types/live';

/**
 * How long a held panel may stay on screen after the last confirmed read.
 *
 * Five minutes is the owner's own number and it sits in a sensible place: at a
 * 25s live cadence it is ~12 consecutive failed reads, which is far past any
 * single throttle blip and still inside the time a quarter takes, so nobody is
 * shown a score that a full scoring drive could have overtaken twice.
 */
export const STALE_HOLD_MS = 5 * 60 * 1000;

/** One league's last confirmed panel, and when we confirmed it. */
export interface PanelMemory {
  panel: LivePanel;
  /** Client clock, set when the panel ARRIVED — never MFL's `fetchedAt`. */
  at: number;
}

/** A panel as the board should draw it. */
export interface PanelView {
  panel: LivePanel;
  /**
   * When these scores were last confirmed, or null when they are current.
   *
   * Non-null is the ONLY signal that the panel is being held: a held panel is
   * otherwise a perfectly ordinary `ok` panel and would render as live.
   */
  heldSince: number | null;
}

/** The memory key. Both halves are load-bearing — see the header. */
export function panelMemoryKey(week: number, leagueId: string): string {
  return `${week}:${leagueId}`;
}

/**
 * The panels to draw, and the memory updated for next time.
 *
 * `memory` is READ AND WRITTEN: an `ok` panel records itself, so the caller
 * hands in one long-lived map rather than threading a reducer through the
 * island. Idempotent for a given board — calling it twice with the same
 * payload only refreshes `at`, which is what makes it safe to run in render
 * under React's double-invoke.
 */
export function resolvePanelViews(input: {
  panels: readonly LivePanel[];
  week: number;
  memory: Map<string, PanelMemory>;
  now: number;
  holdMs?: number;
}): PanelView[] {
  const { panels, week, memory, now } = input;
  const holdMs = input.holdMs ?? STALE_HOLD_MS;

  return panels.map((panel) => {
    const key = panelMemoryKey(week, panel.leagueId);

    if (panel.status === 'ok') {
      memory.set(key, { panel, at: now });
      return { panel, heldSince: null };
    }

    // Every other status is an answer we READ. Only a read we could not make
    // is held — see the header.
    if (panel.status !== 'unavailable') return { panel, heldSince: null };

    const remembered = memory.get(key);
    if (!remembered) return { panel, heldSince: null };
    if (now - remembered.at > holdMs) {
      // Past the hold. Drop it so a league that comes back hours later cannot
      // flash a morning score for one render before the next poll lands.
      memory.delete(key);
      return { panel, heldSince: null };
    }

    /**
     * The remembered panel, with THIS read's league identity.
     *
     * The scores and matchups are the held ones by definition; everything
     * that names the league is taken from the panel that just arrived, so a
     * renamed league or a changed viewer franchise is never held back with
     * them. In practice these agree — this is about what the shape PERMITS,
     * since `viewerFranchiseId` deciding "YOUR MATCHUP" against a stale value
     * is exactly the cross-league mix-up the panel is scoped to prevent.
     */
    return {
      panel: {
        ...remembered.panel,
        leagueName: panel.leagueName,
        slug: panel.slug,
        registered: panel.registered,
        viewerFranchiseId: panel.viewerFranchiseId,
      },
      heldSince: remembered.at,
    };
  });
}

/**
 * When the earliest-expiring held panel stops being showable, or 0 for none.
 *
 * The board schedules a re-render on this. Without it the hold expires only on
 * the next POLL, which at the idle cadence is 90s — so a five-minute promise
 * would keep a dead panel up for six and a half minutes, and the one number
 * this feature states out loud would be the one it does not keep.
 */
export function nextHoldExpiry(views: readonly PanelView[], holdMs = STALE_HOLD_MS): number {
  const held = views.filter((v) => v.heldSince !== null).map((v) => v.heldSince as number);
  return held.length === 0 ? 0 : Math.min(...held) + holdMs;
}
