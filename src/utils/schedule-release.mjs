/**
 * Schedule Release Day — when each league reveals next season's schedule, and
 * which games get put in the window.
 *
 * THE EVENT
 *
 * A cron locks the generated schedule at the release moment; from then on every
 * owner who opens the page sees the SAME schedule and the same marquee games,
 * and the commissioner pastes that exact one into MFL. The lock is what makes
 * it an event rather than a slot machine: the optimiser is simulated
 * annealing, so two owners hitting "generate" would otherwise get two
 * different valid schedules, and fifteen of sixteen owners would be looking at
 * a season that never happens.
 *
 * THE DATES
 *
 * Set by the league, and one of them is derived rather than fixed:
 *
 *   The League   June 1. A plain calendar date — comfortably after the rookie
 *                draft (one week after the NFL draft, so early May) and after
 *                the NFL schedule release (mid-May), with nothing else on the
 *                calendar until August cutdowns.
 *   AFL          The Sunday two weeks before the National League draft. The NL
 *                draft is the Sunday eight days before Labor Day, so this is
 *                Labor Day minus 22 days. NOT a fixed date — it moves with
 *                Labor Day every year, exactly like the draft it is anchored
 *                to.
 *
 * Neither date is allowed to fire before the NFL has actually published the
 * bye calendar (`releaseIsReady`). Both sit weeks after a normal mid-May
 * release, but the NFL moved this release from April to May once already, and
 * a reveal that runs without bye data would schedule against nothing.
 */

import { rivalryPairKey as pairKey, describeSeries } from './rivalry-intensity.mjs';

/** Labor Day: first Monday in September, as a UTC date. */
export const laborDay = (year) => {
  const d = new Date(Date.UTC(year, 8, 1));
  // 1 = Monday. Advance to the first one.
  d.setUTCDate(1 + ((8 - d.getUTCDay()) % 7));
  return d;
};

/**
 * AFL National League draft: the Sunday eight days before Labor Day.
 * (The American League drafts live the Saturday before that.)
 */
export const aflNationalLeagueDraft = (year) => {
  const d = laborDay(year);
  d.setUTCDate(d.getUTCDate() - 8);
  return d;
};

const addDays = (date, n) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

/**
 * When a league reveals its schedule. Returns a UTC Date at midnight; the
 * cron owns the time of day, so nothing here depends on a timezone.
 */
export const scheduleReleaseDate = (slug, year) => {
  switch (slug) {
    case 'theleague':
      return new Date(Date.UTC(year, 5, 1)); // June 1
    case 'afl-fantasy':
      return addDays(aflNationalLeagueDraft(year), -14);
    default:
      return null;
  }
};

/**
 * Is this league ready to reveal? Date has arrived AND the NFL bye calendar
 * for the season exists. The bye check is the load-bearing one — a reveal
 * without it would produce a schedule built against no bye data at all.
 */
export const releaseIsReady = (slug, year, now, byesForSeason) => {
  const date = scheduleReleaseDate(slug, year);
  if (!date) return { ready: false, reason: `no release date configured for ${slug}` };
  if (!byesForSeason || Object.keys(byesForSeason).length !== 32) {
    return { ready: false, reason: `NFL bye calendar for ${year} has not landed yet`, date };
  }
  if (now < date) return { ready: false, reason: `release day is ${date.toISOString().slice(0, 10)}`, date };
  return { ready: true, date };
};

/* ------------------------------------------------------------- marquee */

/**
 * Prior-season win rate per franchise, from MFL's standings feed.
 * Order is MFL's own and is never re-sorted, but only the RECORD is read here,
 * so nothing depends on the row order either way.
 */
export const priorWinRates = (standingsFranchises) => {
  const rate = {};
  for (const f of standingsFranchises ?? []) {
    const [w, l, t] = String(f.h2hwlt ?? '').split('-').map(Number);
    const games = (w || 0) + (l || 0) + (t || 0);
    rate[f.id] = games ? ((w || 0) + (t || 0) * 0.5) / games : 0.5;
  }
  return rate;
};

/**
 * Score every game and return the best few — the "tease" on the reveal page
 * and the spine of Schefter's release column.
 *
 * Scoring is deterministic on purpose: the same locked schedule must produce
 * the same marquee list for every owner who loads the page, and for the
 * article generated hours later. Nothing here samples or shuffles.
 *
 * The weights say what the league finds interesting, in order: two good teams
 * playing (the base), a title rematch, a season-deciding rivalry game, and the
 * weeks that carry extra weight — the opener, the finale, a doubleheader.
 */
/**
 * "Two of last year's best" is a SCORING signal, not a headline.
 *
 * It applies to a lot of games — any two teams that both cleared .600 — so
 * left alone it turned up on three of four cards in the 2026 draw and read as
 * boilerplate. It keeps its weight in the score (it is a real reason a game is
 * worth watching), but it is only ever SAID when it is the only thing a game
 * has going for it, and then on at most one card, so it means "this one is
 * here on quality alone" rather than "we ran out of things to write".
 */
/** A series shorter than this is a scheduling coincidence, not a rivalry. */
export const RIVALRY_MEETINGS_TO_MENTION = 6;

/** The reason a Throwback Week pick carries, so the reveal page can spot it. */
export const THROWBACK_REASON = 'throwback week — old-school uniforms';

export const GENERIC_QUALITY_REASON = 'two of last year’s best';

/**
 * Decide what each card actually SAYS, once all four are known.
 *
 * Two reasons are true of too many games to print on every card:
 *
 *   the series line   every pairing in a sixteen-year league has history, so
 *                     annotating all four is wallpaper. It goes on the single
 *                     most-charged rivalry in the set, plus the Throwback Week
 *                     card, where the old rivalry IS the reason for the pick.
 *   the quality tag   any two teams over .600 qualify. Printed only when a
 *                     game has nothing more specific to say, and then once.
 *
 * Both keep their full weight in the score either way — this is about wording,
 * not about which games get picked.
 */
const trimReasons = (picks, nameOf) => {
  const withSeries = picks.filter((p) => p.series);
  let loudest = null;
  for (const p of withSeries) {
    if (!loudest || p.series.intensity > loudest.series.intensity) loudest = p;
  }

  let spentGeneric = false;
  return picks.map((p) => {
    const why = [...p.why];
    const saysSeries = p.series && (p === loudest || p.why.includes(THROWBACK_REASON));
    if (saysSeries) {
      const line = describeSeries(p.series, p.away, p.home, nameOf);
      // Ahead of the throwback line so the card reads "old rivalry, in old
      // uniforms" rather than the other way round.
      if (line) why.unshift(line);
    }

    const others = why.filter((w) => w !== GENERIC_QUALITY_REASON);
    if (others.length > 0) return { ...p, why: others };
    if (!why.includes(GENERIC_QUALITY_REASON)) return { ...p, why };
    if (spentGeneric) return { ...p, why: [] };
    spentGeneric = true;
    return { ...p, why };
  });
};

export const marqueeMatchups = (
  weeks,
  {
    divisionOf,
    conferenceOf,
    name,
    winRate,
    lastChampionship,
    lastWeek,
    doubleheaderWeeks = [],
    /**
     * Career head-to-head per pairing, keyed by `pairKey` — see
     * `rivalrySeriesByPair`. Absent for a league with no ingested history, and
     * everything below degrades to the old behaviour rather than throwing.
     */
    rivalry = {},
    /**
     * Throwback Week, if the league runs one (`THROWBACK_WEEKS`, TheLeague
     * only today). One marquee slot is RESERVED for its best old rivalry.
     */
    throwbackWeek = null,
  },
  limit = 4,
) => {
  const dh = new Set(doubleheaderWeeks);
  const champs = lastChampionship ? [lastChampionship.champion, lastChampionship.runnerUp].filter(Boolean) : [];
  const isTitleRematch = (a, b) => champs.length === 2 && champs.includes(a) && champs.includes(b);

  const scored = [];
  for (const [week, games] of weeks) {
    for (const g of games) {
      const a = g.away;
      const b = g.home;
      const strength = (winRate[a] ?? 0.5) + (winRate[b] ?? 0.5);
      const division = divisionOf[a] === divisionOf[b];
      const crossConference = conferenceOf && conferenceOf[a] !== conferenceOf[b];

      let score = strength * 100;
      const why = [];
      if (isTitleRematch(a, b)) {
        score += 60;
        why.push('championship rematch');
      }
      if (week === lastWeek && division) {
        score += 22;
        why.push('division title on the line in the final week');
      } else if (division) {
        score += 12;
        why.push('division rivalry');
      }
      if (week === 1) {
        score += 14;
        why.push('opening week');
      }
      if (week === lastWeek) {
        score += 10;
        why.push('final week');
      }
      if (dh.has(week)) {
        score += 8;
        why.push('doubleheader week');
      }
      if (crossConference && week === 1) {
        score += 16;
        why.push('cross-conference opener');
      }
      // A long series between the same two owners is a reason to watch a game
      // this year's records say nothing about. Scored off the SHARED intensity
      // formula (`rivalry-intensity.mjs`) so the tease agrees with the rivalry
      // pages instead of inventing a second ranking.
      const series = rivalry[pairKey(a, b)];
      const rivalrySays = series && series.games >= RIVALRY_MEETINGS_TO_MENTION;
      if (rivalrySays) score += Math.min(30, series.intensity * 5);
      if (week === throwbackWeek) {
        score += 10;
        why.push(THROWBACK_REASON);
      }
      // Both coming off a strong season reads as a heavyweight bout even
      // without a trophy or a division between them.
      // Weighted always; only SAID when nothing else fits (trimGenericReasons).
      if ((winRate[a] ?? 0) >= 0.6 && (winRate[b] ?? 0) >= 0.6) {
        score += 18;
        why.push(GENERIC_QUALITY_REASON);
      }
      scored.push({
        week,
        away: a,
        home: b,
        awayName: name[a],
        homeName: name[b],
        score,
        why,
        // Carried, not printed: which cards SAY it is decided once the four are
        // known, in `trimReasons`. Every game in a sixteen-year league has some
        // history, so a series line on all four reads as boilerplate — the same
        // failure as the generic quality tag below.
        series: rivalrySays ? series : null,
      });
    }
  }

  scored.sort((x, y) => y.score - x.score || x.week - y.week);

  // Spread the picks across DIFFERENT WEEKS and different franchises. Score
  // alone does not do this: the AFL plays all twelve of its cross-conference
  // games in Week 1, so the opener + doubleheader + cross-conference bonuses
  // stack identically on every one of them and the raw top four came back as
  // four Week 1 games. A tease that covers one week of a fourteen-week season
  // is not a tease.
  const picked = [];
  const usedTeams = new Set();
  const usedWeeks = new Set();
  const take = (g) => {
    picked.push(g);
    usedTeams.add(g.away);
    usedTeams.add(g.home);
    usedWeeks.add(g.week);
  };
  const isPicked = (g) => picked.some((p) => p.week === g.week && p.away === g.away && p.home === g.home);

  // Throwback Week gets a RESERVED slot, claimed BEFORE anything else.
  //
  // Two things this ordering buys. It guarantees the week appears at all — the
  // whole point of it is the old uniforms, and quietly showing none of its
  // games is indistinguishable from the league not running the week. And it
  // gets the RIGHT game: ranked by rivalry rather than by score, because score
  // is dominated by opening-week and quality bonuses that say nothing about
  // how old a grudge is. Claiming it last instead (the first cut) let Weeks 1
  // and 14 take both franchises of the week's best series first, leaving a
  // nine-meeting pairing standing in for a fifteen-meeting one decided by a
  // single game.
  if (throwbackWeek != null) {
    const inWeek = scored.filter((g) => g.week === throwbackWeek);
    const best =
      inWeek.filter((g) => g.series).sort((x, y) => y.series.intensity - x.series.intensity)[0] ??
      inWeek[0];
    if (best) take(best);
  }

  for (const g of scored) {
    if (picked.length >= limit) break;
    if (usedWeeks.has(g.week) || usedTeams.has(g.away) || usedTeams.has(g.home)) continue;
    take(g);
  }
  // Relax week-distinctness, then franchise-distinctness, rather than ever
  // returning fewer games than asked for.
  for (const pass of [1, 2]) {
    for (const g of scored) {
      if (picked.length >= limit) break;
      if (isPicked(g)) continue;
      if (pass === 1 && (usedTeams.has(g.away) || usedTeams.has(g.home))) continue;
      take(g);
    }
  }
  return trimReasons(
    picked.slice(0, limit).sort((x, y) => x.week - y.week),
    (id) => name[id] ?? '',
  );
};

/* ---------------------------------------------------------------- tease */

/**
 * The homepage tease, decided ONCE for both leagues.
 *
 * There are two independent hero resolvers — `resolveHeroState` for The League
 * and `resolveAflHeroState` for the AFL — and they share no code. Putting the
 * countdown decision in either of them would mean writing it twice and having
 * one of them drift, which is the failure this repo has already shipped in
 * other places. Both call this instead; all they own is how the result looks.
 *
 * @param {string} slug
 * @param {Date} now
 * @param {{ revealed?: boolean, leadDays?: number, year?: number }} [opts]
 *   revealed  the reveal has already been locked, so tease the RESULT
 *   leadDays  how long before release day the tease starts (default 21)
 */
/** How long "drops today" may stand before the tease gives up and steps aside. */
const IMMINENT_GRACE_DAYS = 2;

export const scheduleReleaseTease = (slug, now, { revealed = false, leadDays = 21, year } = {}) => {
  const season = year ?? now.getUTCFullYear();
  const date = scheduleReleaseDate(slug, season);
  if (!date) return { show: false };

  const msLeft = date.getTime() - now.getTime();
  const dayMs = 86_400_000;
  // Ceil so the day of release reads "today" and the day before reads "1 day",
  // rather than a partial day rounding down to zero and claiming it is out.
  const daysUntil = Math.ceil(msLeft / dayMs);

  if (revealed) {
    // Once it is out, keep it on the homepage for a week — that is the window
    // in which owners actually go looking for their schedule.
    const daysSince = Math.floor(-msLeft / dayMs);
    return daysSince <= 7
      ? { show: true, phase: 'out', date, daysUntil: 0, daysSince }
      : { show: false, phase: 'out', date };
  }

  if (msLeft <= 0) {
    // Date has passed but nothing is locked: the cron has not run yet, or it
    // could not (no bye calendar). Say "any moment", never a negative count —
    // but only BRIEFLY. An unbounded "drops today" is a hero that hijacks the
    // homepage for the rest of the offseason whenever a reveal fails to fire,
    // which is exactly what it did on first wiring: eighteen hero tests in late
    // June and July went red because this branch never expired.
    const daysOverdue = Math.floor(-msLeft / dayMs);
    return daysOverdue <= IMMINENT_GRACE_DAYS
      ? { show: true, phase: 'imminent', date, daysUntil: 0, daysOverdue }
      : { show: false, phase: 'overdue', date, daysOverdue };
  }
  if (daysUntil > leadDays) return { show: false, phase: 'early', date, daysUntil };
  return { show: true, phase: 'countdown', date, daysUntil };
};

/** Human copy for the tease, so both heroes read identically. */
export const scheduleReleaseTeaseCopy = (tease, leagueName = '') => {
  if (!tease?.show) return null;
  const when = tease.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  if (tease.phase === 'out') {
    return {
      kicker: 'Schedule Release',
      title: 'The Schedule Is Out',
      summary: `Every ${leagueName || 'league'} matchup for the coming season, and the four games worth circling.`,
    };
  }
  if (tease.phase === 'imminent') {
    return {
      kicker: 'Schedule Release — Today',
      title: 'The Schedule Drops Today',
      summary: 'The draw locks today. Same schedule, same headline matchups, for everyone.',
    };
  }
  const days = tease.daysUntil;
  return {
    kicker: `Schedule Release — ${when}`,
    title: days === 1 ? 'The Schedule Drops Tomorrow' : `The Schedule Drops in ${days} Days`,
    summary: 'One draw, locked, for the whole league. Nobody gets a different schedule.',
  };
};
