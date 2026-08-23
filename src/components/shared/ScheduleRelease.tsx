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
import {
  describeDivisionByeSplit,
  divisionByeSplit,
  scheduleConstraints,
  upcomingConstraints,
  TIER_LABEL,
} from '../../utils/schedule-constraints.mjs';

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

/** One side's legacy identity, as worn in Throwback Week. */
type ThrowbackSide = { name: string; icon: string; colorPrimary: string };
type ThrowbackGame = { week: number; away: ThrowbackSide; home: ThrowbackSide };

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
    /** Every division game in the season. Absent on reveals locked before Aug 2026. */
    divisionGames?: number;
    netByeSpread: number;
    homeGames: { min: number; max: number };
    minRematchGap: number | null;
  };
  /**
   * How this season did against the goals in force when it was drawn — scored
   * once at lock time, never re-derived, so a verdict cannot drift as the goal
   * list grows. Absent on reveals locked before scoring existed.
   */
  goals?: { key: string; rank: number; tier: string; status: string; detail: string }[];
  /** Goals adopted after this draw; they did not apply to it. */
  notYetAdopted?: { key: string; since: number }[];
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
      /** Old-school identities for the Throwback Week pick, when the league runs one. */
      throwback: ThrowbackGame | null;
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

/**
 * How each verdict reads on the page. `optimised` deliberately has no pass
 * mark — inventing a threshold for "opponent strength is balanced" would make
 * the scorecard less honest, not more.
 */
const GOAL_STATUS: Record<string, string> = {
  met: 'Met',
  partial: 'As far as the calendar allowed',
  blocked: 'Not achievable this year',
  optimised: 'Optimised',
};
/** The reason string that marks the Throwback Week pick — see schedule-release.mjs. */
const THROWBACK_REASON = 'throwback week — old-school uniforms';

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
  const { release, teams, throwback } = data;
  const weekNumbers = Object.keys(release.weeks)
    .map(Number)
    .sort((a, b) => a - b);
  const dh = new Set(release.doubleheaderWeeks);

  // How many division games actually landed on an NFL bye week, and how many
  // of those the format forced. Reporting only the bye-FREE count invited the
  // reading that the rest were avoidable: in the AFL every one of them is
  // forced, and in The League none of them are — they are the price of ending
  // the season on rivalry games. Null on reveals locked before the denominator
  // was recorded, in which case the tile falls back to the bye-free count.
  const byeSplit = divisionByeSplit({
    total: release.summary.divisionGames,
    byeFree: release.summary.byeFreeDivisionGames,
    ceiling: release.summary.divisionGameCeiling,
  });
  // Scoped to the season BEING SHOWN, not to today. A reveal is a record of a
  // draw that already happened, and a rule adopted afterwards was not one this
  // draw had to satisfy — rendering it here would blame the 2026 schedule for
  // missing a rule that did not exist when it was made.
  const constraints = scheduleConstraints({ season: release.year });
  // Stored verdicts win; the computed list is only a fallback for reveals
  // locked before scoring existed, which render as an unscored rule list.
  const goalByKey = new Map((release.goals ?? []).map((g) => [g.key, g]));
  const upcoming = release.notYetAdopted?.length
    ? release.notYetAdopted.map((n) => ({
        ...(upcomingConstraints({ season: release.year }) as any[]).find((c) => c.key === n.key),
        since: n.since,
      }))
    : upcomingConstraints({ season: release.year });
  const tally = (release.goals ?? []).reduce<Record<string, number>>((acc, g) => {
    acc[g.status] = (acc[g.status] ?? 0) + 1;
    return acc;
  }, {});

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
            // Throwback Week's game wears the era it will actually be played
            // in — legacy crests, legacy names, legacy colours. Same treatment
            // live scoring gives that week, so the tease looks like the day.
            const isThrowback = throwback != null && g.why.includes(THROWBACK_REASON);
            // The era name replaces the modern one, with the modern one kept as
            // a subtitle: the reason chip credits the all-time record to the
            // CURRENT franchise, so a card showing only "BOYZ II MEN" against a
            // record held by "Vitside Mafia" reads as two different teams.
            const away = isThrowback
              ? { ...side(g.away, g.awayName), name: throwback.away.name, full: throwback.away.name, icon: throwback.away.icon, now: side(g.away, g.awayName).full }
              : side(g.away, g.awayName);
            const home = isThrowback
              ? { ...side(g.home, g.homeName), name: throwback.home.name, full: throwback.home.name, icon: throwback.home.icon, now: side(g.home, g.homeName).full }
              : side(g.home, g.homeName);
            const fallback = 'var(--accent-color, #1c497c)';
            // Era palettes carry no dark variant (the API says why), so the one
            // colour serves both themes on a throwback card.
            const awayColor = isThrowback ? throwback.away.colorPrimary : teams?.[g.away]?.colorPrimary;
            const homeColor = isThrowback ? throwback.home.colorPrimary : teams?.[g.home]?.colorPrimary;
            const brandVars = {
              '--rel-away': awayColor ?? fallback,
              '--rel-away-dark':
                (isThrowback ? awayColor : teams?.[g.away]?.colorPrimaryDark) ?? fallback,
              '--rel-home': homeColor ?? fallback,
              '--rel-home-dark':
                (isThrowback ? homeColor : teams?.[g.home]?.colorPrimaryDark) ?? fallback,
            } as CSSProperties;
            return (
              <li
                key={`${g.week}-${g.away}-${g.home}`}
                className={`rel__game${isThrowback ? ' rel__game--throwback' : ''}`}
                style={brandVars}
              >
                <span className="rel__week">
                  Week {g.week}
                  {isThrowback && <span className="rel__era">Throwback</span>}
                </span>
                {/* Stacked, not side by side: four cards across a 60rem column
                    leaves ~110px per team on one row, which truncated every
                    franchise to "Midw…". Away over home also matches how the
                    matchup reads aloud. */}
                <div className="rel__faceoff">
                  <span className="rel__side">
                    <span className="rel__crest">
                      {away.icon && <img src={away.icon} alt="" loading="lazy" width="28" height="28" />}
                    </span>
                    <span className="rel__name">
                      {away.full}
                      {'now' in away && away.now !== away.full && (
                        <span className="rel__now">{away.now}</span>
                      )}
                    </span>
                  </span>
                  <span className="rel__side rel__side--home">
                    <span className="rel__at" aria-label="at">
                      @
                    </span>
                    <span className="rel__crest">
                      {home.icon && <img src={home.icon} alt="" loading="lazy" width="28" height="28" />}
                    </span>
                    <span className="rel__name">
                      {home.full}
                      {'now' in home && home.now !== home.full && (
                        <span className="rel__now">{home.now}</span>
                      )}
                    </span>
                  </span>
                </div>
                {g.why.filter((w) => !isThrowback || w !== THROWBACK_REASON).length > 0 && (
                  <ul className="rel__whys">
                    {g.why
                      .filter((w) => !isThrowback || w !== THROWBACK_REASON)
                      .map((why) => (
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
        {byeSplit && (
          <div>
            <dt>Division games on an NFL bye</dt>
            <dd>
              {byeSplit.onByes}
              <small>
                {' '}
                / {byeSplit.total} ({byeSplit.percent}%)
              </small>
            </dd>
            <p className="rel__factNote">{describeDivisionByeSplit(byeSplit)}</p>
          </div>
        )}
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

      <section>
        <h3 className="rel__h3">The goals, ranked — and how {release.year} did</h3>
        <p className="rel__hint">
          The league does not control the NFL&rsquo;s bye calendar, so these are goals scored each year, not promises.
          Each one yields to every one above it: a schedule can fall short of a goal and still be the right draw,
          because a higher goal won or the calendar left no room.
          {release.goals?.length ? (
            <>
              {' '}
              This season: <strong>{tally.met ?? 0} met</strong>
              {tally.partial ? `, ${tally.partial} as far as the calendar allowed` : ''}
              {tally.blocked ? `, ${tally.blocked} not achievable` : ''}
              {tally.optimised ? `, ${tally.optimised} optimised without a pass mark` : ''}.
            </>
          ) : null}
        </p>
        <ol className="rel__rules">
          {constraints.map((c) => (
            <li key={c.rank} className={`rel__rule rel__rule--${c.tier}`}>
              <span className="rel__ruleTier">{TIER_LABEL[c.tier]}</span>
              <p className="rel__ruleText">{c.rule}</p>
              {goalByKey.has(c.key) ? (
                <p className={`rel__verdict rel__verdict--${goalByKey.get(c.key)!.status}`}>
                  <span className="rel__verdictTag">{GOAL_STATUS[goalByKey.get(c.key)!.status] ?? goalByKey.get(c.key)!.status}</span>
                  {goalByKey.get(c.key)!.detail}
                </p>
              ) : null}
              <p className="rel__ruleWhy">{c.why}</p>
            </li>
          ))}
        </ol>
        {upcoming.length > 0 && (
          <div className="rel__later">
            <h4 className="rel__laterHead">
              Adopted since this schedule was drawn
            </h4>
            <p className="rel__hint">
              {upcoming.length === 1 ? 'This rule was' : 'These rules were'} added after the {release.year} draw was
              locked, so {upcoming.length === 1 ? 'it is' : 'they are'} not part of the list above.{' '}
              {upcoming.length === 1 ? 'It applies' : 'They apply'} from{' '}
              {[...new Set(upcoming.map((c: any) => c.since))].sort().join(' and ')}.
            </p>
            <ul className="rel__laterList">
              {upcoming.map((c: any) => (
                <li key={c.rule}>
                  <span className="rel__ruleTier">From {c.since}</span> {c.rule}
                </li>
              ))}
            </ul>
          </div>
        )}
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
