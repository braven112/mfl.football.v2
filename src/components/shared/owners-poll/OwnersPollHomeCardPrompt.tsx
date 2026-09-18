/**
 * "Still good?" on the homepage card — the only hydrated part of it.
 *
 * The card's ranking is server-rendered from the committed archive and shared
 * by every viewer. This is the one thing that cannot be: whether YOUR ballot
 * has gone stale. Splitting it out keeps the expensive, shared part static and
 * the per-viewer part a single fetch.
 *
 * It renders NOTHING in every case but one — signed out, no ballot on file,
 * ballot recently edited, poll paused, or the fetch failed. The homepage is
 * unchanged for almost everyone, almost always, which is the bar a permanent
 * module has to clear.
 *
 * MOUNT WITH client:idle, never client:visible. An island that renders null
 * until it has fetched has zero height, so it never intersects the viewport
 * and never hydrates — the prompt would silently never appear for anyone. The
 * deleted lineup-page strip carried this same note for the same reason.
 */

import { useEffect, useState } from 'react';
import type { LeagueClock } from '../../../utils/viewer-preferences';
import { clockZonesFromCookie, formatMomentOrDevice } from '../../../utils/viewer-clock';

interface Props {
  leagueParam: string;
  ballotHref: string;
  officialClock?: LeagueClock;
}

export default function OwnersPollHomeCardPrompt({
  leagueParam,
  ballotHref,
  officialClock,
}: Props) {
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/owners-poll/ballot?league=${encodeURIComponent(leagueParam)}`,
          { credentials: 'same-origin' },
        );
        // A signed-out visitor is the common case on a homepage. Silence.
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStale(Boolean(data.stale));
        setUpdatedAt(data.ballot?.updatedAt ?? null);
        setClosesAt(data.window?.closesAt ?? null);
      } catch {
        // Silent by design: this is a bonus prompt on a page someone came to
        // for something else. A failed read must never put an error banner on
        // the homepage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueParam]);

  if (done) {
    return (
      <p className="ophc__prompt" role="status">
        Thanks — your ballot is confirmed.
      </p>
    );
  }
  if (!stale) return null;

  const weeks = weeksSince(updatedAt);

  async function affirm() {
    setBusy(true);
    try {
      const res = await fetch(`/api/owners-poll/affirm?league=${encodeURIComponent(leagueParam)}`, {
        method: 'POST',
        credentials: 'same-origin',
        // Astro 403s a non-GET with no content type unless Origin matches
        // exactly, and some browsers omit Origin — without this the affirm
        // silently fails for those viewers. Pinned by
        // tests/origin-check-content-type.test.ts.
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) setDone(true);
    } catch {
      // As above — failing to affirm changes nothing about the ballot.
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="ophc__prompt">
      {weeks != null && weeks >= 2
        ? `Your ballot is ${weeks} weeks old.`
        : 'Your ballot has been sitting a while.'}{' '}
      Still how you see it?{' '}
      <button type="button" className="ophc__affirm" onClick={affirm} disabled={busy}>
        {busy ? 'Saving…' : 'Still good'}
      </button>{' '}
      <a href={ballotHref}>or change it</a>
      {closesAt ? <> · next result <Closes iso={closesAt} league={officialClock} /></> : null}.
    </p>
  );
}

function weeksSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / (7 * 86400 * 1000)));
}

/**
 * The viewer's own clock with the league's appended.
 *
 * Read inside the effect, not at module scope: with the ClientRouter a single
 * module instance survives navigation between leagues, so a captured value
 * would print the previous league's zone.
 */
function Closes({ iso, league }: { iso: string; league?: LeagueClock }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    setText(formatMomentOrDevice(d, clockZonesFromCookie(document.cookie, league), { weekday: true }));
  }, [iso, league]);
  return <>{text || 'soon'}</>;
}
