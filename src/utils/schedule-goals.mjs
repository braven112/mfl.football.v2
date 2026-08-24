/**
 * The annual goal scorecard — how a season's schedule actually did against the
 * ranked goals, judged after the fact.
 *
 * WHY THIS EXISTS
 *
 * The league does not control the NFL's bye calendar, so the same goal is
 * easy one year and impossible the next: 2023 and 2024 can put every division
 * game the format allows in a bye-free week, 2026 cannot get three of them off
 * a bye no matter how it is drawn. A fixed list of goals with no per-season
 * verdict therefore reads as a promise the schedule keeps breaking, which is
 * exactly backwards — the goals are best-effort by construction and the
 * calendar decides how much effort is available.
 *
 * So every goal is scored against the season that was actually played, and the
 * score distinguishes the three reasons a goal can come up short:
 *
 *   met        achieved outright
 *   partial    achieved as far as the calendar allowed, with the shortfall
 *              named — this is the honest outcome for most bye-related goals
 *   blocked    not attainable at all this year; says what blocked it
 *   optimised  a soft objective the annealer minimises with no pass mark;
 *              reports the number rather than inventing a verdict
 *   n/a        the goal was not yet adopted when this season was drawn
 *
 * `optimised` is not a cop-out tier. Inventing a threshold for "doubleheader
 * opponents are balanced in strength" would make the scorecard a worse
 * document than reporting the spread and letting a reader judge it: the number
 * is meaningful, a pass mark for it would be arbitrary.
 *
 * SERVER SIDE ONLY. Scored once, at lock time, and stored in the reveal — the
 * reveal is a record, so its verdicts must not drift when the rules or this
 * file change later. `schedule-constraints.mjs` stays the client-safe half.
 */
import { divisionByeSplit, scheduleConstraints, upcomingConstraints } from './schedule-constraints.mjs';

/**
 * One scorer per goal key. Each returns `{ status, detail }`; `detail` is the
 * sentence shown next to the goal, and must read as an outcome, not a restated
 * rule.
 *
 * @param {object} f  season facts — see `scoreSeasonGoals`
 */
/**
 * Which goal a `validateSeason` problem belongs to.
 *
 * The scorers used to read `problems.length` as "is anything wrong", which
 * cross-wired them: 2017's calendar forces a Week 1 doubleheader onto a bye
 * (the constitution pins the cross-conference round there and the format
 * outranks the no-doubleheader-on-a-bye goal), and that ONE problem made the
 * scorecard report the season as also violating one-game-per-week and the
 * opponent counts, neither of which it did. A goal is only failed by its own
 * problems.
 */
export const problemGoal = (message) => {
  if (/doubleheader in Week \d+ falls on an NFL bye week/i.test(message)) return 'doubleheaders-off-byes';
  if (/does not play exactly its division rivals twice/i.test(message)) return 'opponent-counts';
  return 'one-game-per-week';
};

const problemsFor = (f, key) => (f.problems ?? []).filter((p) => problemGoal(p) === key);

const SCORERS = {
  'one-game-per-week': (f) => {
    const own = problemsFor(f, 'one-game-per-week');
    return own.length
      ? { status: 'blocked', detail: own.join('; ') }
      : { status: 'met', detail: `${f.games} games, every franchise the same number` };
  },

  'opponent-counts': (f) =>
    problemsFor(f, 'opponent-counts').length
      ? { status: 'blocked', detail: problemsFor(f, 'opponent-counts').join('; ') }
      : {
          status: 'met',
          detail: f.crossConference
            ? 'division rivals twice, the other division in the conference once, cross-conference in Week 1'
            : 'division rivals twice, everybody else once',
        },

  'doubleheaders-off-byes': (f) => {
    const bad = f.doubleheaders.filter((w) => f.byeCount(w) > 0);
    if (!bad.length) return { status: 'met', detail: `Weeks ${f.doubleheaders.join(', ')}, none with an NFL bye` };
    // The only way this happens is a week the FORMAT pins — the AFL's Week 1,
    // in a year the NFL put a bye there (2017). Say which weeks and how bad,
    // because this is the season the commissioner would stagger by hand.
    return {
      status: 'blocked',
      detail:
        `Week ${bad.map((w) => `${w} (${f.byeCount(w)} NFL teams out)`).join(', ')} — ` +
        `no bye-free week was available for a round the format pins there. This is the case for ` +
        `staggering doubleheaders franchise by franchise.`,
    };
  },

  // A goal now, not a hard rule — it ranks below getting division games off
  // bye weeks, so falling short of it can be the RIGHT outcome rather than a
  // failure. Scored partial, with the number, instead of blocked.
  'rematch-gap': (f) =>
    f.minRematchGap == null
      ? { status: 'optimised', detail: 'no repeat pairing to measure' }
      : f.minRematchGap > 3
        ? { status: 'met', detail: `closest rematch is ${f.minRematchGap} weeks apart` }
        : {
            status: 'partial',
            detail:
              `a rivalry repeats after ${f.minRematchGap} week(s) — inside the three-week target, ` +
              `traded away for a higher goal`,
          },

  'doubleheader-split': (f) => {
    const early = f.doubleheaders.filter((w) => w <= f.lastWeek / 2).length;
    const late = f.doubleheaders.length - early;
    // Two separate tests, and the second is the one with teeth. A franchise
    // whose extra games all landed in September has had its season
    // front-loaded, because the back half is the half that decides seeding.
    // With league-wide doubleheaders "every franchise" is satisfied by any one
    // week past 8; under the staggered last resort it has to hold per team,
    // which is why it is stated per franchise rather than per week.
    const afterWeek8 = f.doubleheadersAfterWeek8 ?? f.doubleheaders.filter((w) => w > 8).length;
    const balanced = Math.abs(early - late) <= 1;
    if (!afterWeek8) {
      return {
        status: 'blocked',
        detail: `no doubleheader after Week 8 — every extra game lands in the first half (Weeks ${f.doubleheaders.join(', ')})`,
      };
    }
    return balanced
      ? { status: 'met', detail: `${early} early, ${late} late; ${afterWeek8} after Week 8` }
      : {
          status: 'partial',
          detail: `${early} early, ${late} late (${afterWeek8} after Week 8) — the bye-free weeks did not allow an even split`,
        };
  },

  // The one goal where "short of target" has two completely different
  // meanings, so the verdict must not collapse them: games FORCED onto a bye
  // by the format are the floor and score as met-at-ceiling, while games the
  // league CHOSE to put there (the all-division finish) are a preference being
  // spent and score as partial. Same number, opposite stories.
  'division-bye-free-ceiling': (f) => {
    const split = divisionByeSplit({
      total: f.divisionGames,
      byeFree: f.byeFreeDivisionGames,
      ceiling: f.divisionGameCeiling,
    });
    if (!split || !split.onByes) {
      return { status: 'met', detail: `all ${f.divisionGames} division games clear of NFL byes` };
    }
    const headline =
      `${split.onByes} of ${split.total} division games (${split.percent}%) fall on a bye week`;
    if (split.atCeiling && !split.chosen) {
      return { status: 'met', detail: `${headline} — every one forced by the format; the floor, not a miss` };
    }
    if (split.chosen && !split.forced) {
      return {
        status: 'partial',
        detail: `${headline} — none forced; they buy the all-division finish in a year with byes in both closing weeks`,
      };
    }
    return {
      status: 'partial',
      detail: `${headline} — ${split.forced} forced by the format, ${split.chosen} spent on the all-division finish`,
    };
  },

  'division-spread': (f) => {
    const halves = f.divisionHalves ?? [];
    if (!halves.length) return { status: 'optimised', detail: 'not measured for this season' };
    const shares = halves.map((h) => (h.early + h.late ? h.late / (h.early + h.late) : 0.5));
    const worst = halves[shares.indexOf(shares.reduce((a, b) => (Math.abs(b - 0.5) > Math.abs(a - 0.5) ? b : a)))];
    const lo = Math.min(...shares);
    const hi = Math.max(...shares);
    const label = `every franchise plays ${Math.round(lo * 100)}-${Math.round(hi * 100)}% of its division games after the midpoint`;
    // A tenth either side of even is not a season anyone notices; a third is.
    if (lo >= 0.4 && hi <= 0.6) return { status: 'met', detail: label };
    if (lo >= 0.25 && hi <= 0.75) return { status: 'partial', detail: `${label} — lopsided but not decided early` };
    return {
      status: 'blocked',
      detail:
        `${label}. ${worst?.franchise ?? 'A franchise'} is the worst. A division race this front-loaded is ` +
        `over before the second half starts.`,
    };
  },

  'light-bye-weeks': (f) => {
    const weeks = f.divisionByeWeeks;
    // The sharper measure when we have it: how many rivalry games actually
    // lose a starter, rather than how many sit in a week with byes in it.
    const starters =
      f.cleanDivisionGames != null && f.divisionGameCount
        ? ` ${f.cleanDivisionGames} of ${f.divisionGameCount} rivalry games have both rosters at full strength` +
          `${f.divisionStarterByes != null ? ` (${f.divisionStarterByes} projected starters missing league-wide)` : ''}.`
        : '';
    if (!weeks.length) return { status: 'met', detail: `no division game falls on a bye week.${starters}` };
    const light = weeks.filter((w) => w.teamsOut <= f.lightByeWeekMax);
    const label = weeks.map((w) => `Wk ${w.week} (${w.teamsOut})`).join(', ');
    if (light.length === weeks.length) return { status: 'met', detail: `all on light weeks — ${label}.${starters}` };
    return {
      status: 'partial',
      detail:
        `${light.length} of ${weeks.length} on a week with ${f.lightByeWeekMax} or fewer NFL teams out — ${label}. ` +
        `No lighter week was reachable.${starters}`,
    };
  },

  'bye-luck': (f) => ({
    status: 'optimised',
    detail: `most- to least-favoured franchise differ by ${f.netByeSpread} across the season`,
  }),

  'opponent-strength': () => ({
    status: 'optimised',
    detail: 'balanced by the optimiser; no pass mark — see the doubleheader and late-season spreads',
  }),

  'worst-week-and-finale': (f) => {
    const finaleIsDivision = f.finaleAllDivision;
    const worstIsClean = f.worstByeWeek == null || !f.divisionByeWeeks.some((w) => w.week === f.worstByeWeek);
    if (finaleIsDivision && worstIsClean) {
      return { status: 'met', detail: `Week ${f.lastWeek} is all-division; the season's worst bye week is not` };
    }
    if (!finaleIsDivision && worstIsClean) {
      return {
        status: 'partial',
        detail: `the worst bye week is kept clear of rivalries, but Week ${f.lastWeek} is not all-division`,
      };
    }
    return { status: 'partial', detail: `a division round sits in the season's worst bye week (Week ${f.worstByeWeek})` };
  },

  'home-away': (f) =>
    f.homeGames.min === f.homeGames.max
      ? { status: 'met', detail: `every franchise hosts ${f.homeGames.min}` }
      : { status: 'met', detail: `${f.homeGames.min}–${f.homeGames.max} per franchise, an odd game count's best split` },
};

/**
 * Score a locked season against the goals that were in force when it was drawn.
 *
 * @param {object} facts
 * @param {number} facts.season           the season being scored
 * @param {boolean} facts.crossConference league plays a cross-conference round
 * @param {number} facts.lastWeek
 * @param {number} facts.games
 * @param {number[]} facts.doubleheaders
 * @param {(week:number)=>number} facts.byeCount   NFL teams out that week
 * @param {number} facts.divisionGames
 * @param {number} facts.byeFreeDivisionGames
 * @param {number} facts.divisionGameCeiling
 * @param {{week:number,teamsOut:number}[]} facts.divisionByeWeeks
 * @param {number|null} facts.worstByeWeek
 * @param {boolean} facts.finaleAllDivision
 * @param {number} facts.netByeSpread
 * @param {{min:number,max:number}} facts.homeGames
 * @param {number|null} facts.minRematchGap
 * @param {number} facts.lightByeWeekMax
 * @param {string[]} [facts.problems]     audit problems, if any
 */
export const scoreSeasonGoals = (facts) => {
  const f = { problems: [], ...facts };
  // The goal LIST is the same for every league; only these verdicts differ.
  const inForce = scheduleConstraints({ season: f.season });
  const later = upcomingConstraints({ season: f.season });

  const scored = inForce.map((c) => {
    const scorer = SCORERS[c.key];
    if (!scorer) throw new Error(`no scorer for schedule goal "${c.key}" — add one to schedule-goals.mjs`);
    const { status, detail } = scorer(f);
    return { key: c.key, rank: c.rank, tier: c.tier, status, detail };
  });

  return {
    goals: scored,
    // Named, not silently dropped: a reader of an old season should be able to
    // see which goals did not exist yet rather than wonder why the list is short.
    notYetAdopted: later.map((c) => ({ key: c.key, since: c.since })),
  };
};

/**
 * Assemble the facts from what `describeSeason` + `divisionGameCeiling` already
 * produce, so the lock paths and the backfill cannot compute them differently.
 *
 * `described.byWeek` carries divisionGames and nflByes per week, which is the
 * whole basis for the bye-related goals — no second pass over the schedule.
 */
export const goalFactsFromSeason = ({
  season,
  crossConference,
  lastWeek,
  described,
  ceiling,
  doubleheaders,
  lightByeWeekMax,
  problems = [],
}) => {
  const byeByWeek = new Map(described.byWeek.map((w) => [w.week, w.nflByes]));
  const divisionByeWeeks = described.byWeek
    .filter((w) => w.divisionGames > 0 && w.nflByes > 0)
    .map((w) => ({ week: w.week, teamsOut: w.nflByes }));
  const withByes = described.byWeek.filter((w) => w.nflByes > 0);
  const worst = withByes.length ? Math.max(...withByes.map((w) => w.nflByes)) : 0;
  const finale = described.byWeek.find((w) => w.week === lastWeek);

  return {
    season,
    crossConference,
    lastWeek,
    games: described.games,
    doubleheaders,
    // Derived from the week plan, so it is right for league-wide doubleheaders.
    // A staggered season would need this computed per franchise off the games
    // themselves — see the goal's `why`.
    doubleheadersAfterWeek8: doubleheaders.filter((w) => w > 8).length,
    byeCount: (week) => byeByWeek.get(week) ?? 0,
    divisionGames: ceiling.total,
    byeFreeDivisionGames: described.byeFreeDivisionGames,
    divisionGameCeiling: ceiling.ceiling,
    divisionByeWeeks,
    worstByeWeek: worst ? (withByes.find((w) => w.nflByes === worst)?.week ?? null) : null,
    // Every game in the last week is a division game — the rivalry finish.
    finaleAllDivision: Boolean(finale && finale.divisionGames === finale.games),
    divisionGameCount: described.divisionGameCount,
    divisionStarterByes: described.divisionStarterByes,
    cleanDivisionGames: described.cleanDivisionGames,
    divisionHalves: described.divisionHalves,
    netByeSpread: described.netByeSpread,
    homeGames: described.homeGames,
    minRematchGap: described.minRematchGap,
    lightByeWeekMax,
    problems,
  };
};

/** Roll-up for the page header: "8 met, 2 as far as the calendar allowed". */
export const summariseGoals = (goals) => {
  const n = (s) => goals.filter((g) => g.status === s).length;
  return { met: n('met'), partial: n('partial'), blocked: n('blocked'), optimised: n('optimised') };
};
