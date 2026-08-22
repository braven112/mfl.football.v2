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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

type MarqueeGame = {
  week: number;
  away: string;
  home: string;
  awayName: string;
  homeName: string;
  why: string[];
};

/** One franchise's crest + brand colour, from the league config (`/api/schedule-release`). */
type TeamBrand = {
  franchiseId: string;
  name: string;
  nameShort: string;
  colorPrimary: string;
  colorPrimaryDark: string;
  /** Light crest; the layout's global stylesheet handles the dark swap. */
  icon: string;
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
  | {
      state: 'revealed';
      leagueName: string;
      year: number;
      releaseDate: string | null;
      canPaste: boolean;
      release: Release;
      teams: Record<string, TeamBrand>;
    };

/**
 * A glyph for every reason `marqueeMatchups` can give, so a card says what
 * kind of game it is before you have read a word of it. The keys are the
 * literal `why` strings that scorer emits — keep them in step with
 * src/utils/schedule-release.mjs; `tests/schedule-release.test.ts` pins that
 * every reason it can produce has an icon here.
 */
const WHY_ICONS: Record<string, string> = {
  'championship rematch': 'trophy',
  'division title on the line in the final week': 'shield',
  'division rivalry': 'shield',
  'opening week': 'whistle',
  'final week': 'champ',
  'doubleheader week': 'calendar-2',
  'cross-conference opener': 'exchange',
  'two of last year’s best': 'star',
};
const WHY_FALLBACK_ICON = 'football';

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

export default function ScheduleRelease({
  leagueSlug,
  spriteHref,
}: {
  leagueSlug: string;
  /** Cache-busted sprite URL from the page — React can't read it off disk. */
  spriteHref: string;
}) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
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

        {/* No in-browser reveal. The schedule is drawn and COMMITTED by the
            release cron, which is what makes it a lock — a page cannot commit.
            To rehearse or to fire it early, run the Schedule Release workflow. */}
        {data.canPaste && (
          <p className="rel__adminNote">
            Commissioner: the reveal is locked by the Schedule Release workflow, which commits it to the repo. Run
            that workflow to rehearse or to release early.
          </p>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------- revealed */
  const { release, teams } = data;
  const weekNumbers = Object.keys(release.weeks)
    .map(Number)
    .sort((a, b) => a - b);
  const dh = new Set(release.doubleheaderWeeks);

  // Crest + short name for one side of a marquee card. Falls back to the name
  // frozen into the reveal when a franchise has left the config since — the
  // card still reads, it just loses its crest.
  const side = (id: string, frozenName: string) => {
    const t = teams?.[id];
    return {
      name: t?.nameShort || frozenName || `Franchise ${id}`,
      full: t?.name || frozenName || `Franchise ${id}`,
      icon: t?.icon ?? '',
    };
  };

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
          {release.marquee.map((g) => {
            const away = side(g.away, g.awayName);
            const home = side(g.home, g.homeName);
            const brandVars = {
              '--rel-away': teams?.[g.away]?.colorPrimary ?? 'var(--accent-color, #1c497c)',
              '--rel-away-dark': teams?.[g.away]?.colorPrimaryDark ?? 'var(--accent-color, #1c497c)',
              '--rel-home': teams?.[g.home]?.colorPrimary ?? 'var(--accent-color, #1c497c)',
              '--rel-home-dark': teams?.[g.home]?.colorPrimaryDark ?? 'var(--accent-color, #1c497c)',
            } as CSSProperties;
            return (
              <li key={`${g.week}-${g.away}-${g.home}`} className="rel__game" style={brandVars}>
                <span className="rel__week">Week {g.week}</span>
                {/* Stacked, not side by side: four cards across a 60rem column
                    leaves ~110px per team on one row, which truncated every
                    franchise to "Midw…". Away over home also matches how the
                    matchup reads aloud. */}
                <div className="rel__faceoff">
                  <span className="rel__side">
                    <span className="rel__crest">
                      {away.icon && <img src={away.icon} alt="" loading="lazy" width="28" height="28" />}
                    </span>
                    <span className="rel__name">{away.full}</span>
                  </span>
                  <span className="rel__side rel__side--home">
                    <span className="rel__at" aria-label="at">
                      @
                    </span>
                    <span className="rel__crest">
                      {home.icon && <img src={home.icon} alt="" loading="lazy" width="28" height="28" />}
                    </span>
                    <span className="rel__name">{home.full}</span>
                  </span>
                </div>
                {g.why.length > 0 && (
                  <ul className="rel__whys">
                    {g.why.map((why) => (
                      <li key={why} className="rel__why">
                        <svg className="rel__whyIcon" aria-hidden="true" width="13" height="13">
                          <use href={`${spriteHref}#icon-${WHY_ICONS[why] ?? WHY_FALLBACK_ICON}`} />
                        </svg>
                        {why}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
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
                          {side(g.away, '').name} <span className="rel__at">@</span>{' '}
                          {side(g.home, '').name}
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
