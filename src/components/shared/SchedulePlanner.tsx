/**
 * Commissioner tool: generate a season's schedule and copy it into MFL.
 *
 * The deliverable is the TEXTAREA. MFL has no schedule write API, so applying
 * a schedule means a human pasting `WW,AAAA,HHHH` lines into
 * Commissioner -> Setup -> Schedule -> the advanced editor — which overwrites
 * the entire fantasy schedule with no undo. Everything else on this page
 * exists so that paste is an informed one: what changes, what it fixes, and a
 * blocking check that refuses to hand over a schedule that breaks a rule.
 *
 * Colours are theme tokens throughout. A hard-coded hex here would look right
 * in light mode and ship white-on-white in dark.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type WeekRow = {
  week: number;
  games: number;
  divisionGames: number;
  nflByes: number;
  doubleheader: boolean;
};

type SeasonSummary = {
  games: number;
  byeFreeDivisionGames: number;
  meanByeDifferential: number;
  netByeSpread: number;
  netByeByFranchise: { franchise: string; net: number }[];
  minRematchGap: number | null;
  meanRematchGap: number | null;
  rematchesWithinThreeWeeks: number;
  homeGames: { min: number; max: number };
  gamesPerFranchise: number[];
  byWeek: WeekRow[];
};

type Plan = {
  slug: string;
  year: number;
  mode: 'simple' | 'constructive';
  leagueName: string;
  lastWeek: number;
  byeFreeWeeks: number[];
  doubleheaderWeeks: number[];
  currentDoubleheaderWeeks: number[];
  text: string;
  crossConference: {
    divisionPairing: string[][];
    alternateYear: boolean;
    skippedRivalries: string[];
    pairs: { away: string; home: string; protectedRivalry: boolean }[];
  } | null;
  divisionGameCeiling: { total: number; ceiling: number; forcedOntoByeWeeks: number };
  plan: SeasonSummary;
  currentPlan: SeasonSummary | null;
  problems: string[];
  changedWeeks: number[] | null;
};

const num = (v: number | null, digits = 2) => (v == null ? '—' : v.toFixed(digits));

export default function SchedulePlanner({
  leagueSlug,
  leagueName,
  defaultYear,
  seasons,
}: {
  leagueSlug: string;
  leagueName: string;
  defaultYear: number;
  /** Seasons with a stored NFL bye calendar. Offering anything else would
   *  just produce the "no bye calendar" error from the API. */
  seasons: number[];
}) {
  const [year, setYear] = useState(defaultYear);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/schedule-plan?league=${encodeURIComponent(leagueSlug)}&year=${year}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setPlan(body as Plan);
    } catch (err: any) {
      setPlan(null);
      setError(err?.message ?? 'Could not generate a schedule');
    } finally {
      setLoading(false);
    }
  }, [leagueSlug, year]);

  const copy = useCallback(async () => {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(plan.text);
    } catch {
      // Clipboard API needs a secure context and can be blocked outright.
      // Selecting the text still lets the commissioner copy by hand, which is
      // the whole job — so fall back rather than reporting failure.
      textareaRef.current?.focus();
      textareaRef.current?.select();
      return;
    }
    setCopied(true);
  }, [plan]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const years = useMemo(
    () => (seasons?.length ? [...seasons].sort((a, b) => b - a) : [defaultYear]),
    [seasons, defaultYear],
  );

  const blocked = (plan?.problems.length ?? 0) > 0;

  return (
    <div className="sched">
      <div className="sched__bar">
        <label className="sched__field">
          <span>Season</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={loading}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="sched__go" onClick={generate} disabled={loading}>
          {loading ? 'Generating…' : `Generate ${leagueName} schedule`}
        </button>
      </div>

      {error && (
        <p className="sched__error" role="alert">
          {error}
        </p>
      )}

      {plan && (
        <>
          {blocked ? (
            <div className="sched__block" role="alert">
              <strong>Do not paste this.</strong> The generated schedule breaks {plan.problems.length} rule
              {plan.problems.length === 1 ? '' : 's'}:
              <ul>
                {plan.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="sched__ok">
              Passes every structural check — {plan.plan.games} games, {plan.plan.gamesPerFranchise.join('/')} per
              franchise, doubleheaders in {plan.doubleheaderWeeks.join(', ')} (all bye-free).
            </p>
          )}

          <div className="sched__pasteHead">
            <h3>MFL schedule</h3>
            <button type="button" className="sched__copy" onClick={copy} disabled={blocked}>
              {copied ? 'Copied ✓' : 'Copy to clipboard'}
            </button>
          </div>
          <p className="sched__hint">
            Paste into <strong>Commissioner → Setup → Schedule</strong> (the advanced editor). Format is{' '}
            <code>week,away,home</code>. Saving <strong>overwrites the entire fantasy schedule</strong> — there is no
            undo.
          </p>
          <textarea
            ref={textareaRef}
            className="sched__text"
            readOnly
            spellCheck={false}
            value={plan.text}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={`${plan.leagueName} ${plan.year} schedule in MFL format`}
          />

          <div className="sched__grid">
            <section className="sched__card">
              <h4>What changes</h4>
              <dl>
                <dt>Doubleheaders</dt>
                <dd>
                  {plan.currentDoubleheaderWeeks.length ? plan.currentDoubleheaderWeeks.join(', ') : '—'} →{' '}
                  <strong>{plan.doubleheaderWeeks.join(', ')}</strong>
                </dd>
                <dt>Bye-free weeks</dt>
                <dd>{plan.byeFreeWeeks.join(', ')}</dd>
                <dt>Weeks affected</dt>
                <dd>
                  {plan.changedWeeks == null
                    ? 'no published schedule to compare'
                    : plan.changedWeeks.length === 0
                      ? 'none'
                      : `${plan.changedWeeks.length} of ${plan.lastWeek} — weeks ${plan.changedWeeks.join(', ')}`}
                </dd>
                <dt>Method</dt>
                <dd>{plan.mode === 'simple' ? 'minimal — move the doubleheader only' : 'full constructive rebuild'}</dd>
              </dl>
            </section>

            <section className="sched__card">
              <h4>Fairness</h4>
              <table className="sched__compare">
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">Now</th>
                    <th scope="col">New</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">
                      Division games bye-free
                      <small> / ceiling {plan.divisionGameCeiling.ceiling}</small>
                    </th>
                    <td>{plan.currentPlan?.byeFreeDivisionGames ?? '—'}</td>
                    <td>
                      <strong>{plan.plan.byeFreeDivisionGames}</strong>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Season net bye spread</th>
                    <td>{plan.currentPlan?.netByeSpread ?? '—'}</td>
                    <td>
                      <strong>{plan.plan.netByeSpread}</strong>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Mean bye differential / game</th>
                    <td>{num(plan.currentPlan?.meanByeDifferential ?? null)}</td>
                    <td>
                      <strong>{num(plan.plan.meanByeDifferential)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Minimum rematch gap</th>
                    <td>{plan.currentPlan?.minRematchGap ?? '—'}</td>
                    <td>
                      <strong>{plan.plan.minRematchGap ?? '—'}</strong>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Home games (min–max)</th>
                    <td>
                      {plan.currentPlan ? `${plan.currentPlan.homeGames.min}–${plan.currentPlan.homeGames.max}` : '—'}
                    </td>
                    <td>
                      <strong>
                        {plan.plan.homeGames.min}–{plan.plan.homeGames.max}
                      </strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="sched__note">
                {plan.divisionGameCeiling.forcedOntoByeWeeks > 0
                  ? `${plan.divisionGameCeiling.forcedOntoByeWeeks} of ${plan.divisionGameCeiling.total} division games are forced onto bye weeks by the format — the ceiling, not a scheduling failure.`
                  : 'Every division game can be bye-free this season.'}
              </p>
            </section>
          </div>

          <section className="sched__card">
            <h4>Week by week</h4>
            <div className="sched__scroll">
              <table className="sched__weeks">
                <thead>
                  <tr>
                    <th scope="col">Week</th>
                    <th scope="col">NFL byes</th>
                    <th scope="col">Games</th>
                    <th scope="col">Division</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {plan.plan.byWeek.map((w) => (
                    <tr key={w.week} className={w.nflByes === 0 ? 'is-clean' : undefined}>
                      <th scope="row">{w.week}</th>
                      <td>{w.nflByes || '—'}</td>
                      <td>{w.games}</td>
                      <td>{w.divisionGames || '—'}</td>
                      <td>{w.doubleheader ? <span className="sched__tag">Doubleheader</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {plan.crossConference && (
            <section className="sched__card">
              <h4>Week 1 cross-conference</h4>
              <p className="sched__note">
                Paired on last season&rsquo;s division finishes ·{' '}
                {plan.crossConference.divisionPairing.map((p) => p.join('/')).join(' + ')}
                {plan.crossConference.alternateYear ? ' (alternate year)' : ''}
              </p>
              <ul className="sched__pairs">
                {plan.crossConference.pairs.map((p) => (
                  <li key={`${p.away}-${p.home}`}>
                    {p.away} <span aria-label="at">@</span> {p.home}
                    {p.protectedRivalry && <span className="sched__tag sched__tag--rival">Protected rivalry</span>}
                  </li>
                ))}
              </ul>
              {plan.crossConference.skippedRivalries.length > 0 && (
                <p className="sched__note sched__note--warn">
                  Protected rivalry not scheduled (franchise not found this season):{' '}
                  {plan.crossConference.skippedRivalries.join(', ')}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
