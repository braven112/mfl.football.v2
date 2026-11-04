/**
 * Ask the History — the league's all-play side competition.
 *
 * The AFL runs a competition next to its head-to-head season: every team
 * plays every other team every week (all-play), Weeks 1-17. It began in 2017
 * as the last AFL Cup, one combined 24-team table, and split into the Premier
 * League and the D-League in 2018 (promotion and relegation between them).
 * Before that the AFL Cup was a knockout (2015-2016) whose games MFL never
 * kept, so those seasons have a winner on record and no table.
 *
 * None of this is in league-history.json, so the model used to read "Premier
 * League" as the soccer one (Brandon, 2026-11-03). Every fact here comes from
 * a file that already records it, never from the prompt:
 *
 * - which seasons were all-play, and what the combined table was called:
 *   the league config's `tierCompetition` (`firstSeason`, `combinedTableName`,
 *   and the per-season cutoff week, `resolveTierCutoffWeek`);
 * - who was in which tier each split season: `tier-history.json`;
 * - who won: `awards-history.json` (the award slugs below), which is also
 *   where the AFL Cup's knockout winners live;
 * - the records: each season's `weekly-results.json`, through the same
 *   accumulator the standings page and the tier roll-forward use
 *   (`accumulateAllPlay`, all-play.mjs), so a table here matches the
 *   standings page row for row.
 *
 * Seasons are credited to the OWNER who held the team, like every other unit
 * (records follow the owner, not the franchise slot).
 */

import { accumulateAllPlay, resolveTierCutoffWeek } from '../all-play.mjs';

export const COMPETITION_UNITS = ['competitionSeasons', 'competitionOwners', 'competitionTitles'];

/** The award slugs (awards-history.json) that are this competition's titles. */
export const COMPETITION_AWARDS = {
  'premier-league': 'Premier League',
  'dleague-champion': 'D-League',
  'afl-cup': 'AFL Cup',
};

/** Ranks in the Premier League that are paid (constitution: top 4 win money). */
const PREMIER_PAID = 4;

export const COMPETITION_FIELDS = {
  competitionSeasons: {
    year: { type: 'number', label: 'Season' },
    competition: { type: 'string', label: 'Competition', desc: 'Premier League | D-League | AFL Cup (2017, one combined table)' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    w: { type: 'number', label: 'AP W', desc: 'all-play wins (one per team outscored, every week)' },
    l: { type: 'number', label: 'AP L', desc: 'all-play losses' },
    t: { type: 'number', label: 'AP T', desc: 'all-play ties' },
    winPct: { type: 'number', label: 'AP %', desc: '(w + t/2) / (w + l + t)' },
    pf: { type: 'number', label: 'PF', desc: 'points scored in the competition weeks (the tiebreaker)' },
    weeks: { type: 'number', label: 'Weeks', desc: 'weeks counted' },
    rank: { type: 'number', label: 'Rank', desc: 'finish in its own table (Premier League, D-League or the 2017 AFL Cup), 1 = best' },
    overallRank: { type: 'number', label: 'All-24 rank', desc: 'finish among every team that season, both tiers together' },
    tableSize: { type: 'number', label: 'Teams', desc: 'teams in its table' },
    champion: { type: 'boolean', label: 'Champion', desc: 'won its table (from the league awards)' },
    paid: { type: 'boolean', label: 'In the money', desc: 'Premier League top 4, the D-League champion, or the AFL Cup winner' },
    nextTier: { type: 'string', label: 'Next season', desc: 'Premier League | D-League: where the same owner played the next season ("" if none on record)' },
    promoted: { type: 'boolean', label: 'Promoted', desc: 'D-League (or the 2017 table) to the Premier League the next season, same owner' },
    relegated: { type: 'boolean', label: 'Relegated', desc: 'Premier League to the D-League the next season, same owner' },
    complete: { type: 'boolean', label: 'Complete', desc: 'false only for the season still being played' },
  },
  competitionOwners: {
    owner: { type: 'string', label: 'Owner' },
    team: { type: 'string', label: 'Latest team' },
    seasons: { type: 'number', label: 'Seasons' },
    w: { type: 'number', label: 'AP W', desc: 'all-play wins over the counted seasons' },
    l: { type: 'number', label: 'AP L' },
    t: { type: 'number', label: 'AP T' },
    winPct: { type: 'number', label: 'AP %' },
    pf: { type: 'number', label: 'PF' },
    titles: { type: 'number', label: 'Titles', desc: 'titles won in the counted competition(s) and years, AFL Cup knockout wins included' },
    premierSeasons: { type: 'number', label: 'PL seasons' },
    dleagueSeasons: { type: 'number', label: 'DL seasons' },
    premierTitles: { type: 'number', label: 'PL titles' },
    dleagueTitles: { type: 'number', label: 'DL titles' },
    cupTitles: { type: 'number', label: 'Cups', desc: 'AFL Cup titles (2015-2017)' },
    premierPaid: { type: 'number', label: 'PL top 4', desc: 'Premier League top-4 (paid) finishes' },
    promotions: { type: 'number', label: 'Promoted' },
    relegations: { type: 'number', label: 'Relegated' },
    firstYear: { type: 'number', label: 'First' },
    lastYear: { type: 'number', label: 'Last' },
    active: { type: 'boolean', label: 'Active', desc: 'owns a team in the latest season' },
  },
  competitionTitles: {
    year: { type: 'number', label: 'Season' },
    competition: { type: 'string', label: 'Title', desc: 'Premier League | D-League | AFL Cup' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    format: { type: 'string', label: 'Format', desc: 'all-play | knockout (the 2015-2016 AFL Cup; no table on record)' },
    w: { type: 'number', label: 'AP W', desc: 'all-play wins that season (null for a knockout)' },
    l: { type: 'number', label: 'AP L' },
    winPct: { type: 'number', label: 'AP %' },
  },
};

export const COMPETITION_DEFAULT_COLUMNS = {
  competitionSeasons: ['year', 'competition', 'team', 'owner', 'w', 'l', 'winPct', 'rank'],
  competitionOwners: ['owner', 'seasons', 'w', 'l', 'winPct', 'titles'],
  competitionTitles: ['year', 'competition', 'team', 'owner', 'format', 'w', 'l'],
};

export const COMPETITION_UNIT_WORDS = {
  competitionSeasons: 'all-play competition team-seasons',
  competitionOwners: 'owners in the all-play competition',
  competitionTitles: 'all-play competition and AFL Cup titles',
};

/** `competition` query values: one table, every table, or the two-tier era (2018 on). */
export const COMPETITION_SCOPES = ['all', 'Premier League', 'D-League', 'AFL Cup', 'tiers'];

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Better first: all-play % desc, then PF desc (the constitution's tiebreaker), then id. Same as afl-tier-standings.mjs byAllPlay. */
const byAllPlay = (rec) => (a, b) => {
  const ra = rec.get(a);
  const rb = rec.get(b);
  return rb.pct - ra.pct || rb.pf - ra.pf || (a < b ? -1 : a > b ? 1 : 0);
};

/**
 * Whether a league carries the competition: it declares it in its config and
 * records its tiers. Data, not a slug check.
 * @param {any} data
 */
export function hasCompetitions(data) {
  return Number.isInteger(data?.tierCompetition?.firstSeason) && !!data?.tierHistory?.seasons;
}

/**
 * Build every competition unit's rows once per dataset.
 *
 * @param {object} p ask-query.mjs's prepared dataset (owner attribution, latest year)
 * @param {{ tierCompetition: any, tierHistory: any, awards: any, weekly: Record<string, any> }} data
 * @param {{ year: number | null, week: number | null, inProgress: boolean }} asOf
 */
export function prepareCompetitions(p, data, asOf) {
  const { tierCompetition, tierHistory, awards, weekly } = data;
  const first = tierCompetition.firstSeason;
  const combinedName = tierCompetition.combinedTableName || 'Combined table';
  const ownerOf = (y, f) => p.ix.entity(p.ix.entityOf(y, f));
  const teamName = (y, f) => p.ix.team(y, f)?.n ?? f;
  const seasonDone = new Map(p.ix.ds.seasons.map((s) => [s.y, !!s.done]));

  const awardsByYear = new Map((awards?.seasons ?? []).map((s) => [Number(s.year), s.awards ?? {}]));
  const membershipOf = (y) => tierHistory.seasons?.[String(y)]?.membership ?? null;

  const seasons = [];
  const years = Object.keys(weekly)
    .map(Number)
    .filter((y) => y >= first)
    .sort((a, b) => a - b);
  for (const y of years) {
    let cutoff = resolveTierCutoffWeek(tierCompetition, y);
    // The season being played counts only its final weeks, like every other unit.
    if (asOf.inProgress && y === asOf.year) cutoff = Math.min(cutoff, asOf.week ?? 0);
    const rec = accumulateAllPlay(weekly[y], cutoff);
    const counted = (weekly[y]?.weeks ?? []).filter((w) => Number(w.week) <= cutoff && Object.values(w.scores ?? {}).some((s) => Number(s) > 0)).length;
    if (!rec.size || !counted) continue;
    const membership = membershipOf(y);
    const tableOf = (f) => (membership ? membership[f] ?? null : combinedName);
    const ids = [...rec.keys()].filter((f) => tableOf(f));
    const overall = ids.slice().sort(byAllPlay(rec));
    const tables = new Map();
    for (const f of overall) {
      const name = tableOf(f);
      if (!tables.has(name)) tables.set(name, []);
      tables.get(name).push(f);
    }
    const yearAwards = awardsByYear.get(y) ?? {};
    const winners = new Map();
    for (const [slug, comp] of Object.entries(COMPETITION_AWARDS)) {
      const a = yearAwards[slug];
      if (a) winners.set(comp, a.sourceFranchiseId ?? a.franchiseId);
    }
    const done = seasonDone.get(y) ?? true;
    for (const [table, list] of tables) {
      list.forEach((f, i) => {
        const r = rec.get(f);
        const owner = ownerOf(y, f);
        const rank = i + 1;
        const champion = done && winners.get(table) === f;
        seasons.push({
          year: y,
          competition: table,
          team: teamName(y, f),
          owner: owner.name,
          w: r.wins,
          l: r.losses,
          t: r.ties,
          winPct: r3(r.pct),
          pf: r2(r.pf),
          weeks: counted,
          rank,
          overallRank: overall.indexOf(f) + 1,
          tableSize: list.length,
          champion,
          paid: done && (table === 'Premier League' ? rank <= PREMIER_PAID : champion),
          complete: done,
          _key: owner.key,
          _franchiseId: f,
          _ownerSlug: owner.ownerSlug,
        });
      });
    }
  }

  // Where the same owner played next season: promotion and relegation follow
  // the OWNER, because a new owner always starts in the D-League whatever tier
  // the slot held (constitution), and that is not a relegation.
  const tierByOwnerYear = new Map(seasons.map((s) => [`${s._key}|${s.year}`, s.competition]));
  for (const s of seasons) {
    const next = tierByOwnerYear.get(`${s._key}|${s.year + 1}`) ?? '';
    const nextTier = next === 'Premier League' || next === 'D-League' ? next : '';
    s.nextTier = nextTier;
    s.promoted = s.competition !== 'Premier League' && nextTier === 'Premier League';
    s.relegated = s.competition === 'Premier League' && nextTier === 'D-League';
  }

  // Every title, the AFL Cup's knockout seasons included.
  const titles = [];
  const seasonRow = new Map(seasons.map((s) => [`${s.year}|${s.competition}|${s._franchiseId}`, s]));
  for (const [y, yearAwards] of [...awardsByYear].sort((a, b) => a[0] - b[0])) {
    for (const [slug, comp] of Object.entries(COMPETITION_AWARDS)) {
      const a = yearAwards[slug];
      if (!a) continue;
      const f = a.sourceFranchiseId ?? a.franchiseId;
      const row = seasonRow.get(`${y}|${comp}|${f}`);
      const owner = f ? ownerOf(y, f) : { name: null, key: null, ownerSlug: null };
      titles.push({
        year: y,
        competition: comp,
        team: (f && p.ix.team(y, f)?.n) || a.name,
        owner: owner.name,
        format: row ? 'all-play' : 'knockout',
        w: row?.w ?? null,
        l: row?.l ?? null,
        winPct: row?.winPct ?? null,
        _key: owner.key,
        _franchiseId: f ?? null,
        _ownerSlug: owner.ownerSlug,
      });
    }
  }

  return { competitionSeasons: seasons, competitionTitles: titles };
}

/** Does a season (or title) row fall inside a `competition` scope? */
export function inCompetition(row, scope) {
  if (!scope || scope === 'all') return true;
  if (scope === 'tiers') return row.competition === 'Premier League' || row.competition === 'D-League';
  return row.competition === scope;
}

/**
 * One row per owner over the season rows and titles inside the scope, so
 * "best Premier League record" totals only the seasons asked about.
 */
export function competitionOwnerRows(pc, latestHoldings, scope, inYears) {
  const by = new Map();
  const blank = (s) => ({
    owner: s.owner,
    team: s.team,
    seasons: 0, w: 0, l: 0, t: 0, pf: 0,
    titles: 0, premierSeasons: 0, dleagueSeasons: 0, premierTitles: 0, dleagueTitles: 0, cupTitles: 0,
    premierPaid: 0, promotions: 0, relegations: 0,
    firstYear: s.year, lastYear: s.year,
    active: latestHoldings.has(s._key),
    _franchiseId: s._franchiseId,
    _ownerSlug: s._ownerSlug,
  });
  const get = (s) => {
    if (!by.has(s._key)) by.set(s._key, blank(s));
    return by.get(s._key);
  };
  for (const s of pc.competitionSeasons) {
    if (!inCompetition(s, scope) || !inYears(s.year)) continue;
    const o = get(s);
    o.seasons++;
    o.w += s.w;
    o.l += s.l;
    o.t += s.t;
    o.pf = r2(o.pf + s.pf);
    if (s.competition === 'Premier League') o.premierSeasons++;
    if (s.competition === 'D-League') o.dleagueSeasons++;
    if (s.competition === 'Premier League' && s.paid) o.premierPaid++;
    if (s.promoted) o.promotions++;
    if (s.relegated) o.relegations++;
    if (s.year >= o.lastYear) {
      o.lastYear = s.year;
      o.team = s.team;
      o._franchiseId = s._franchiseId;
    }
    o.firstYear = Math.min(o.firstYear, s.year);
  }
  for (const t of pc.competitionTitles) {
    if (!t._key || !inCompetition(t, scope) || !inYears(t.year)) continue;
    const o = get(t);
    o.titles++;
    if (t.competition === 'Premier League') o.premierTitles++;
    if (t.competition === 'D-League') o.dleagueTitles++;
    if (t.competition === 'AFL Cup') o.cupTitles++;
    o.firstYear = Math.min(o.firstYear, t.year);
    o.lastYear = Math.max(o.lastYear, t.year);
  }
  return [...by.values()].map((o) => {
    const n = o.w + o.l + o.t;
    return { ...o, winPct: n ? r3((o.w + o.t / 2) / n) : 0 };
  });
}

/**
 * The competition's story for the model's prompt, built from the same rows:
 * when each table ran and who won each title. Names only, no numbers, so every
 * stat still has to come from a query.
 */
export function describeCompetitions(pc, tierCompetition) {
  const seasons = pc.competitionSeasons;
  if (!seasons.length && !pc.competitionTitles.length) return '';
  const years = (comp) => [...new Set(seasons.filter((s) => s.competition === comp).map((s) => s.year))];
  const span = (ys) => (ys.length ? (ys.length === 1 ? `${ys[0]}` : `${ys[0]}-${ys.at(-1)}`) : '');
  const combined = tierCompetition.combinedTableName || 'Combined table';
  const combinedYears = years(combined);
  const premierYears = years('Premier League');
  // How many of the combined table went up: the next season's Premier League, same owners.
  const seedSize = (y) => seasons.filter((s) => s.year === y && s.nextTier === 'Premier League').length;
  const knockout = pc.competitionTitles.filter((t) => t.format === 'knockout');
  const cutoffs = Object.entries(tierCompetition.cutoffWeekByYear ?? {})
    .map(([y, w]) => `${y} ended at Week ${w}`)
    .join('; ');
  const lines = [
    `This league runs an all-play side competition next to its head-to-head season: every week each team plays every other team, so a week is worth one all-play win for each team outscored. It runs Weeks 1-${tierCompetition.cutoffWeek ?? 17}${cutoffs ? ` (${cutoffs})` : ''}. It is this league's own competition, nothing to do with soccer or any other league.`,
    knockout.length || combinedYears.length
      ? `${combined}: ${knockout.length ? `a knockout in ${knockout.map((t) => t.year).join(' and ')} (only its winners are on record, no games)` : ''}${knockout.length && combinedYears.length ? ', then ' : ''}${combinedYears.length ? `one combined all-play table of every team in ${span(combinedYears)}` : ''}. ${combinedYears.length ? `${span(combinedYears)} was the last ${combined} and the first all-play season; its top ${seedSize(combinedYears.at(-1))} entered the first Premier League and the rest started in the D-League.` : ''}`
      : '',
    premierYears.length
      ? `Premier League and D-League: from ${premierYears[0]} the all-play table is split into two tiers. The Premier League's top ${PREMIER_PAID} are paid, its bottom teams are relegated and the D-League's top teams promoted; new owners start in the D-League. Both tiers play one league-wide all-play schedule, so records from either tier compare directly.`
      : '',
    `Titles: ${pc.competitionTitles.map((t) => `${t.year} ${t.competition} ${t.team}${t.owner ? ` (${t.owner})` : ''}`).join('; ')}.`,
  ];
  return lines.filter(Boolean).join('\n');
}
