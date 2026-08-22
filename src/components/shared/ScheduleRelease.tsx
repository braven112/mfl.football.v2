/**
 * Schedule Release Day — the owner-facing reveal.
 *
 * Two states, one component:
 *
 *   countdown  before release day. A live ticker to the moment, so the event
 *              has a shape owners can see coming.
 *   revealed   after the cron locks it. The four marquee games first — that is
 *              the tease, and it is the same four for every owner because the
 *              schedule is locked, not regenerated per visitor — then the full
 *              week-by-week grid, then (commissioner only) the paste block.
 *
 * The countdown ticks in the BROWSER but every decision is the server's: the
 * page never infers "it's time" from the local clock, it asks. A laptop with a
 * skewed clock would otherwise show a reveal that has not happened, or hide one
 * that has.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type MarqueeGame = {
  week: number;
  away: string;
  home: string;
  awayName: string;
  homeName: string;
  why: string[];
};

type Release = {
  league: string;
  year: number;
  revealedAt: string;
  text: string;
  weeks: Record<string, { away: string; home: string }[]>;
  doubleheaderWeeks: number[];
  byeFreeWeeks: number[];
  marquee: MarqueeGame[];
  summary: {
    games: number;
    byeFreeDivisionGames: number;
    divisionGameCeiling: number;
    netByeSpread: number;
    homeGames: { min: number; max: number };
    minRematchGap: number | null;
  };
};

type State =
  | { state: 'countdown'; leagueName: string; year: number; releaseDate: string | null; due: boolean; reason: string | null; canPaste: boolean }
  | { state: 'revealed'; leagueName: string; year: number; releaseDate: string | null; canPaste: boolean; release: Release };

const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1_000],
] as const;

/** Break a millisecond gap into the four units the ticker shows. */
const breakdown = (ms: number) => {
  let left = Math.max(0, ms);
  return UNITS.map(([label, size]) => {
    const value = Math.floor(left / size);
    left -= value * size;
    return { label, value };
  });
};

export default function ScheduleRelease({ leagueSlug }: { leagueSlug: string }) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [locking, setLocking] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/schedule-release?league=${encodeURIComponent(leagueSlug)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setData(body as State);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load the schedule release');
    }
  }, [leagueSlug]);

  useEffect(() => {
    load();
  }, [load]);

  // Tick only while counting down; a revealed page has nothing to animate.
  useEffect(() => {
    if (data?.state !== 'countdown') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [data?.state]);

  // Once the clock runs out, ask the server rather than flipping ourselves —
  // the reveal exists when the lock exists, not when a browser says so.
  const target = data?.releaseDate ? Date.parse(data.releaseDate) : null;
  const expired = target != null && now >= target;
  useEffect(() => {
    if (data?.state !== 'countdown' || !expired) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [data?.state, expired, load]);

  const copy = useCallback(async () => {
    if (data?.state !== 'revealed') return;
    try {
      await navigator.clipboard.writeText(data.release.text);
      setCopied(true);
    } catch {
      // Clipboard needs a secure context and can be blocked. Selecting the
      // text still gets the job done.
      textRef.current?.focus();
      textRef.current?.select();
    }
  }, [data]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const revealNow = useCallback(async () => {
    setLocking(true);
    try {
      const res = await fetch(`/api/schedule-release?league=${encodeURIComponent(leagueSlug)}`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? body?.reason ?? `Request failed (${res.status})`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'Could not lock the reveal');
    } finally {
      setLocking(false);
    }
  }, [leagueSlug, load]);

  const clock = useMemo(() => (target == null ? null : breakdown(target - now)), [target, now]);

  if (error) {
    return (
      <p className="rel__error" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p className="rel__loading">Loading…</p>;

  const dateLabel = data.releaseDate
    ? new Date(data.releaseDate).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  /* ------------------------------------------------------------ countdown */
  if (data.state === 'countdown') {
    return (
      <div className="rel">
        <div className="rel__hero">
          <p className="rel__kicker">{data.leagueName} · {data.year} Season</p>
          <h2>Schedule Release</h2>
          {dateLabel && <p className="rel__date">{dateLabel}</p>}
        </div>

        {data.due ? (
          <p className="rel__due">
            Release day is here — the schedule is being locked. This page will update on its own.
          </p>
        ) : (
          clock && (
            <ol className="rel__clock" aria-label="Time until the schedule release">
              {clock.map((u) => (
                <li key={u.label}>
                  <span className="rel__num">{String(u.value).padStart(2, '0')}</span>
                  <span className="rel__unit">{u.value === 1 ? u.label : `${u.label}s`}</span>
                </li>
              ))}
            </ol>
          )
        )}

        {!data.due && data.reason && <p className="rel__reason">{data.reason}</p>}

        <p className="rel__blurb">
          When the clock hits zero the {data.year} schedule locks — same schedule, same headline matchups, for
          everyone. Nobody gets a different draw.
        </p>

        {data.canPaste && (
          <button type="button" className="rel__admin" onClick={revealNow} disabled={locking}>
            {locking ? 'Locking…' : 'Reveal now (commissioner)'}
          </button>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------- revealed */
  const { release } = data;
  const weekNumbers = Object.keys(release.weeks)
    .map(Number)
    .sort((a, b) => a - b);
  const dh = new Set(release.doubleheaderWeeks);

  return (
    <div className="rel">
      <div className="rel__hero rel__hero--out">
        <p className="rel__kicker">{data.leagueName} · {data.year} Season</p>
        <h2>The Schedule Is Out</h2>
        {dateLabel && <p className="rel__date">Released {dateLabel}</p>}
      </div>

      <section>
        <h3 className="rel__h3">Circle these</h3>
        <ul className="rel__marquee">
          {release.marquee.map((g) => (
            <li key={`${g.week}-${g.away}-${g.home}`}>
              <span className="rel__week">Week {g.week}</span>
              <span className="rel__teams">
                {g.awayName} <span className="rel__at">@</span> {g.homeName}
              </span>
              {g.why.length > 0 && <span className="rel__why">{g.why.join(' · ')}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="rel__facts">
        <div>
          <dt>Games</dt>
          <dd>{release.summary.games}</dd>
        </div>
        <div>
          <dt>Doubleheaders</dt>
          <dd>{release.doubleheaderWeeks.join(', ')}</dd>
        </div>
        <div>
          <dt>Division games clear of NFL byes</dt>
          <dd>
            {release.summary.byeFreeDivisionGames}
            <small> / {release.summary.divisionGameCeiling} possible</small>
          </dd>
        </div>
        <div>
          <dt>Home games</dt>
          <dd>
            {release.summary.homeGames.min}–{release.summary.homeGames.max}
          </dd>
        </div>
      </section>

      <section>
        <h3 className="rel__h3">Week by week</h3>
        <div className="rel__scroll">
          <table className="rel__grid">
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Matchups</th>
              </tr>
            </thead>
            <tbody>
              {weekNumbers.map((w) => (
                <tr key={w}>
                  <th scope="row">
                    {w}
                    {dh.has(w) && <span className="rel__tag">DH</span>}
                  </th>
                  <td>
                    <ul className="rel__games">
                      {release.weeks[String(w)].map((g, i) => (
                        <li key={`${w}-${i}`}>
                          {g.away} @ {g.home}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.canPaste && (
        <section>
          <div className="rel__pasteHead">
            <h3 className="rel__h3">Paste into MFL</h3>
            <button type="button" className="rel__copy" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy to clipboard'}
            </button>
          </div>
          <p className="rel__hint">
            Commissioner → Setup → Schedule (advanced editor). Saving <strong>overwrites the entire fantasy
            schedule</strong> — there is no undo. This is the exact schedule shown above.
          </p>
          <textarea ref={textRef} className="rel__text" readOnly spellCheck={false} value={release.text} />
        </section>
      )}
    </div>
  );
}
