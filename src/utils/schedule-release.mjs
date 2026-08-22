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
export const marqueeMatchups = (
  weeks,
  { divisionOf, conferenceOf, name, winRate, lastChampionship, lastWeek, doubleheaderWeeks = [] },
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
      // Both coming off a strong season reads as a heavyweight bout even
      // without a trophy or a division between them.
      if ((winRate[a] ?? 0) >= 0.6 && (winRate[b] ?? 0) >= 0.6) {
        score += 18;
        why.push('two of last year’s best');
      }
      scored.push({ week, away: a, home: b, awayName: name[a], homeName: name[b], score, why });
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
  return picked.slice(0, limit).sort((x, y) => x.week - y.week);
};
