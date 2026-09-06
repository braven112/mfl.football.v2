/**
 * SundayTicketLive — the board's ONE hydration root.
 *
 * The board is otherwise zero client JS, and that property is being spent
 * deliberately and once. The alternative was an island per box or per player
 * row — 8-16 roots, and a React copy of `SundayTicketBox.astro`'s markup to go
 * with them, which is precisely the duplicated-renderer fork
 * `page-fork-ratchet` exists to stop. So the Astro components stay props-only
 * and server-render real numbers (no empty flash, and the page is fully useful
 * with JS off), and this component subscribes to each league's feed and
 * updates the numbers in place.
 *
 * It renders a visible freshness pill, because a board that says "live" but
 * has not been confirmed in ten minutes is not live, and an owner has no way
 * to tell from the scores alone.
 *
 * Lifecycle: every DOM lookup happens INSIDE an effect, never at module scope.
 * Astro's ClientRouter destroys and re-mounts islands across a soft
 * navigation, so an effect re-runs against the new document — but a
 * module-scope capture would survive it and patch a detached tree.
 */

import { useEffect, useRef } from 'react';
import { useLiveScoringFeed } from '../../../hooks/useLiveScoringFeed';
import type { PollStatus } from '../../../utils/live-poll-store';
import { liveStateLabel } from '../../../utils/sunday-ticket-matchups';

export interface LiveLeague {
  leagueId: string;
  /** The owner's franchise in this league — the one whose players are on the board. */
  franchiseId: string;
}

export interface Props {
  leagues: LiveLeague[];
  week: number;
  /** The SEASON year. Live scoring is results-shaped; the slate runs on the league year. */
  year: number;
  /** False in the offseason / outside the season window — the island then does no network. */
  enabled: boolean;
  /** True during a game-day window: poll fast on the first load, before any data has arrived. */
  live: boolean;
}

const fmt = (n: number) => n.toFixed(1);

/** Set an element's text only when it actually changed — avoids pointless repaints. */
function setText(el: Element | null, text: string) {
  if (el && el.textContent !== text) el.textContent = text;
}

/**
 * One league's subscription plus the DOM patch it drives. A component per
 * league (rather than a loop over `useLiveScoringFeed`) because hooks cannot
 * be called in a loop whose length can change — and it keeps each league's
 * cadence independent, which is the whole point of the shared store's
 * minimum-interval rule.
 */
function LeagueLive({
  leagueId,
  franchiseId,
  week,
  year,
  enabled,
  live,
  onStatus,
}: LiveLeague & {
  week: number;
  year: number;
  enabled: boolean;
  live: boolean;
  onStatus: (leagueId: string, status: PollStatus, fetchedAt: number) => void;
}) {
  const feed = useLiveScoringFeed(leagueId, week, year, { enabled, live });

  useEffect(() => {
    onStatus(leagueId, feed.status, feed.fetchedAt);
  }, [leagueId, feed.status, feed.fetchedAt, onStatus]);

  useEffect(() => {
    // `feed.resolved` false = MFL is not scoring this week (an unplayed week
    // answers with a full payload of zeros). Patch nothing: the server-rendered
    // projections stand, rather than being overwritten with 0.0.
    if (!enabled || feed.fetchedAt === 0 || !feed.resolved) return;

    // ── Player rows. STARTERS only: the route keeps bench rows in a separate
    // map and we never read it, so a bench player's points can't land in the
    // column the matchup scores from.
    const byPlayer = new Map<string, number>();
    for (const rows of Object.values(feed.players)) {
      for (const row of rows) byPlayer.set(row.id, row.live);
    }
    document.querySelectorAll<HTMLElement>(`[data-st-live^="${CSS.escape(leagueId)}:"]`).forEach((el) => {
      const playerId = el.dataset.stLive?.slice(leagueId.length + 1) ?? '';
      const live = byPlayer.get(playerId);
      // A player the feed does not mention keeps whatever the server rendered.
      // Absence of a live read is not zero.
      if (live === undefined) return;
      setText(el, fmt(live));
      el.classList.remove('st-box__live--idle');
    });

    // ── Per-league, per-game subtotals on the box headers.
    document.querySelectorAll<HTMLElement>(`[data-st-live-box^="${CSS.escape(leagueId)}:"]`).forEach((el) => {
      const group = el.closest('.st-box__league');
      if (!group) return;
      let total = 0;
      let any = false;
      group.querySelectorAll<HTMLElement>('[data-st-live]').forEach((row) => {
        const n = parseFloat(row.textContent ?? '');
        if (Number.isFinite(n)) { total += n; any = true; }
      });
      if (!any) return;
      setText(el, fmt(total));
      el.classList.remove('st-box__league-live--idle');
    });

    // ── Matchup cards.
    document.querySelectorAll<HTMLElement>(`[data-st-live-team^="${CSS.escape(leagueId)}:"]`).forEach((el) => {
      const fid = el.dataset.stLiveTeam?.slice(leagueId.length + 1) ?? '';
      const score = feed.scores[fid];
      if (score === undefined) return;
      setText(el, fmt(score));
      el.classList.remove('st-game__score--idle');
    });
    document.querySelectorAll<HTMLElement>(`[data-st-live-ytp^="${CSS.escape(leagueId)}:"]`).forEach((el) => {
      const fid = el.dataset.stLiveYtp?.slice(leagueId.length + 1) ?? '';
      const ytp = feed.playersYetToPlay[fid];
      setText(el, ytp ? `${ytp} to play` : '');
    });

    // ── Card state, through the SAME derivation the server rendered with, so
    // the first paint and every poll after it cannot disagree.
    //
    // querySelectorAll, not querySelector: a doubleheader puts TWO cards on
    // the page for one league, and the singular form silently updated only
    // the first while the second sat on its server-rendered state forever.
    const liveResolved = feed.resolved && feed.scores[franchiseId] !== undefined;
    const label = liveStateLabel({
      liveSupported: true,
      liveResolved,
      secondsRemaining: feed.remaining[franchiseId] ?? 0,
    });
    document.querySelectorAll<HTMLElement>(`[data-st-live-state="${CSS.escape(leagueId)}"]`).forEach((el) => {
      setText(el, label);
      el.classList.toggle('st-game__state--live', label === 'In progress');
    });
  }, [enabled, leagueId, franchiseId, feed]);

  return null;
}

export default function SundayTicketLive({ leagues, week, year, enabled, live }: Props) {
  const statuses = useRef(new Map<string, { status: PollStatus; fetchedAt: number }>());
  const pillRef = useRef<HTMLSpanElement>(null);

  const onStatus = (leagueId: string, status: PollStatus, fetchedAt: number) => {
    statuses.current.set(leagueId, { status, fetchedAt });
    const all = [...statuses.current.values()];
    const newest = Math.max(0, ...all.map((s) => s.fetchedAt));
    // An error NEVER destroys the data already on screen — the shared store
    // keeps the last good payload and only flips status. So the pill reports
    // "reconnecting" over live numbers rather than the board going blank.
    const erroring = all.some((s) => s.status === 'error');
    const el = pillRef.current;
    if (!el) return;
    el.textContent = newest === 0
      ? 'Connecting…'
      : erroring
        ? 'Reconnecting…'
        : `Updated ${new Date(newest).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    el.classList.toggle('st-fresh--error', erroring);
  };

  if (!enabled || leagues.length === 0) return null;

  return (
    <>
      <span className="st-fresh" ref={pillRef} role="status" aria-live="polite">
        Connecting…
      </span>
      {leagues.map((l) => (
        <LeagueLive
          key={l.leagueId}
          leagueId={l.leagueId}
          franchiseId={l.franchiseId}
          week={week}
          year={year}
          enabled={enabled}
          live={live}
          onStatus={onStatus}
        />
      ))}
    </>
  );
}
