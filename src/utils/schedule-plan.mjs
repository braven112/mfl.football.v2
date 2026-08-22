/**
 * One planner, two callers.
 *
 *   scripts/generate-schedule.mjs                                   (CLI)
 *   src/pages/api/schedule-plan.ts                                  (admin page)
 *
 * Feed access is INJECTED (`readFeed`) rather than done here, because the two
 * callers reach the same files differently and neither should be able to drift
 * from the other's answer. The planner itself is pure: same feeds in, same
 * schedule out, no clock and no filesystem.
 *
 * Read docs/claude/rules/schedule-optimization.md before changing any rule in
 * here. The short version of what it protects:
 *
 *   - The late doubleheader week is NOT a constant. It is whichever of Week 12
 *     or 13 is bye-free that season, and it flips. Copying last year's week
 *     numbers has shipped a doubleheader onto a bye twice.
 *   - "Maximize bye-free division games" is a trap as a lone objective — it
 *     stacks every rivalry game into Weeks 1-3.
 *   - Report division-game counts against `divisionGameCeiling`, never against
 *     zero: the AFL's format forces 36 of 120 onto bye weeks no matter what.
 */
import {
  asArray,
  buildCrossConferencePairs,
  byeCountsByWeek,
  byeFreeWeeks,
  chooseDoubleheaderWeeks,
  decomposeSeasonIntoRounds,
  divisionFinishRanks,
  divisionGameCeiling,
  doubleheaderWeeks,
  pairKey,
  regularSeasonGames,
} from './schedule-rules.mjs';
import { buildWeekPlan, searchSeason } from './schedule-builder.mjs';

/**
 * Per-league policy. `mode` is the league's own decision about how much
 * disruption it wants, not a capability difference:
 *
 *   simple        move the doubleheader off the bye week, touch nothing else
 *   constructive  rebuild the season from the format's round structure
 */
export const SCHEDULE_POLICY = {
  theleague: {
    // Both leagues now build constructively. The League ran `simple` while the
    // two were being compared; it was adopted on the numbers — bye spread 17 to
    // 4 and home/away 7-11 to 9-9, neither of which re-timing can reach, since
    // moving rounds between weeks never changes which side is home.
    // `keepDivisionFinish` no longer applies in this mode: the constructive
    // week plan ends on division games by construction. `mode: 'simple'` is
    // still reachable per call for a minimal in-season repair.
    mode: 'constructive',
    startWindow: [1, 2, 3, 4],
    endWindow: [12, 13, 14],
    doubleheaderCount: 4,
    keepDivisionFinish: true,
    crossConference: null,
  },
  'afl-fantasy': {
    mode: 'constructive',
    startWindow: [1, 2, 3, 4],
    endWindow: [12, 13, 14],
    doubleheaderCount: 3,
    keepDivisionFinish: false,
    crossConference: {
      week: 1,
      anchorYear: 2024,
      anchorPairing: [
        ['North', 'East'],
        ['South', 'West'],
      ],
      alternatePairing: [
        ['North', 'West'],
        ['South', 'East'],
      ],
      protectedRivalries: [['Computer Jocks', 'Jewpacabra']],
    },
  },
};

/** Franchise/division/conference shape for one season. */
const seasonShape = (leagueJson) => {
  const meta = leagueJson?.league;
  if (!meta) return null;
  const divisionName = {};
  const divisionConference = {};
  for (const d of asArray(meta.divisions?.division)) {
    divisionName[d.id] = d.name;
    divisionConference[d.id] = d.conference;
  }
  const franchiseIds = [];
  const name = {};
  const divisionOf = {};
  const conferenceOf = {};
  for (const f of asArray(meta.franchises?.franchise)) {
    franchiseIds.push(f.id);
    name[f.id] = f.name;
    divisionOf[f.id] = divisionName[String(f.division)] ?? String(f.division);
    conferenceOf[f.id] = divisionConference[String(f.division)] ?? '00';
  }
  return {
    meta,
    franchiseIds,
    name,
    divisionOf,
    conferenceOf,
    lastWeek: Number(meta.lastRegularSeasonWeek),
    divisionCount: Number(meta.divisions?.count ?? 1),
  };
};

/** Rostered players on bye, per franchise per week. Empty map if feeds absent. */
const byeExposure = (rostersJson, playersJson, byes, franchiseIds) => {
  const table = {};
  for (const id of franchiseIds) table[id] = {};
  const teamOf = {};
  for (const p of asArray(playersJson?.players?.player)) teamOf[p.id] = p.team;
  for (const f of asArray(rostersJson?.rosters?.franchise)) {
    for (const p of asArray(f.player)) {
      const week = byes[teamOf[p.id]];
      if (!week) continue;
      table[f.id] ??= {};
      table[f.id][week] = (table[f.id][week] ?? 0) + 1;
    }
  }
  return table;
};

/** Prior-season strength, z-scored on win rate. Used to BALANCE, never to seed. */
const priorRatings = (standingsJson, franchiseIds) => {
  const raw = {};
  for (const f of asArray(standingsJson?.leagueStandings?.franchise)) {
    const [w, l, t] = String(f.h2hwlt ?? '').split('-').map(Number);
    const games = (w || 0) + (l || 0) + (t || 0);
    raw[f.id] = games ? ((w || 0) + (t || 0) * 0.5) / games : 0.5;
  }
  const values = franchiseIds.map((id) => raw[id] ?? 0.5);
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((n, v) => n + (v - mu) ** 2, 0) / values.length) || 1;
  const rating = {};
  for (const id of franchiseIds) rating[id] = ((raw[id] ?? 0.5) - mu) / sd;
  return rating;
};

const buildCrossRound = (shape, policy, year, prevLeagueJson, prevStandingsJson) => {
  const prevShape = seasonShape(prevLeagueJson);
  if (!prevShape || !prevStandingsJson) {
    throw new Error(`cannot build the cross-conference round: ${year - 1} league/standings feeds are missing`);
  }
  const prevRank = divisionFinishRanks(
    prevStandingsJson.leagueStandings?.franchise,
    prevShape.divisionOf,
  );
  const flip = (year - policy.crossConference.anchorYear) % 2 !== 0;
  const divisionPairing = flip ? policy.crossConference.alternatePairing : policy.crossConference.anchorPairing;

  const byName = {};
  for (const id of shape.franchiseIds) byName[shape.name[id]] = id;
  const skipped = [];
  const protectedPairs = [];
  for (const [a, b] of policy.crossConference.protectedRivalries) {
    if (byName[a] && byName[b]) protectedPairs.push([byName[a], byName[b]]);
    else skipped.push(`${a} / ${b}`);
  }
  const pairs = buildCrossConferencePairs({
    prevRank,
    divisionPairing,
    protectedPairs,
    conferenceOf: shape.conferenceOf,
    franchiseIds: shape.franchiseIds,
  });
  // American League franchise travels — matches the side convention in the feeds.
  const games = pairs.map(({ away, home }) =>
    shape.conferenceOf[away] === '00' ? { away, home } : { away: home, home: away },
  );
  return { games, pairs, divisionPairing, flip, skippedRivalries: skipped };
};

/* ------------------------------------------------------------- reporting */

/** Everything the page and the CLI both want to show about a candidate season. */
export const describeSeason = (weeks, shape, { byes, exposure, byeFree, doubleheaders }) => {
  const cleanSet = new Set(byeFree);
  const dhSet = new Set(doubleheaders);
  const isDivision = (g) => shape.divisionOf[g.away] === shape.divisionOf[g.home];

  const net = {};
  const home = {};
  const played = {};
  for (const id of shape.franchiseIds) {
    net[id] = 0;
    home[id] = 0;
    played[id] = 0;
  }
  const met = {};
  const byWeek = [];
  let byeFreeDivision = 0;
  let byeDiffTotal = 0;
  let gameCount = 0;

  for (const week of [...weeks.keys()].sort((a, b) => a - b)) {
    const games = weeks.get(week);
    let division = 0;
    for (const g of games) {
      gameCount += 1;
      played[g.away] += 1;
      played[g.home] += 1;
      home[g.home] += 1;
      const ba = exposure[g.away]?.[week] ?? 0;
      const bb = exposure[g.home]?.[week] ?? 0;
      byeDiffTotal += Math.abs(ba - bb);
      net[g.away] += bb - ba;
      net[g.home] += ba - bb;
      if (isDivision(g)) {
        division += 1;
        (met[pairKey(g.away, g.home)] ??= []).push(week);
      }
    }
    if (cleanSet.has(week)) byeFreeDivision += division;
    byWeek.push({
      week,
      games: games.length,
      divisionGames: division,
      nflByes: byeCountsByWeek(byes)[week] ?? 0,
      doubleheader: dhSet.has(week),
    });
  }

  const gaps = Object.values(met)
    .filter((w) => w.length > 1)
    .map((w) => Math.abs(w[1] - w[0]));
  const netValues = shape.franchiseIds.map((id) => net[id]);
  const homeValues = shape.franchiseIds.map((id) => home[id]);

  return {
    byWeek,
    games: gameCount,
    byeFreeDivisionGames: byeFreeDivision,
    meanByeDifferential: gameCount ? byeDiffTotal / gameCount : 0,
    netByeSpread: netValues.length ? Math.max(...netValues) - Math.min(...netValues) : 0,
    netByeByFranchise: shape.franchiseIds
      .map((id) => ({ franchise: shape.name[id], net: net[id] }))
      .sort((a, b) => a.net - b.net),
    minRematchGap: gaps.length ? Math.min(...gaps) : null,
    meanRematchGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    rematchesWithinThreeWeeks: gaps.filter((g) => g <= 3).length,
    homeGames: { min: Math.min(...homeValues), max: Math.max(...homeValues) },
    gamesPerFranchise: [...new Set(Object.values(played))],
  };
};

/** Hard checks. Anything here failing means DO NOT PASTE. */
export const validateSeason = (weeks, shape, { byeFree, doubleheaders }) => {
  const problems = [];
  const cleanSet = new Set(byeFree);

  for (const week of doubleheaders) {
    if (!cleanSet.has(week)) problems.push(`doubleheader in Week ${week} falls on an NFL bye week`);
  }
  const played = {};
  const opponents = {};
  for (const id of shape.franchiseIds) played[id] = 0;
  for (const [week, games] of weeks) {
    const perWeek = {};
    for (const g of games) {
      for (const id of [g.away, g.home]) {
        played[id] = (played[id] ?? 0) + 1;
        perWeek[id] = (perWeek[id] ?? 0) + 1;
      }
      ((opponents[g.away] ??= {})[g.home] ??= 0), (opponents[g.away][g.home] += 1);
      ((opponents[g.home] ??= {})[g.away] ??= 0), (opponents[g.home][g.away] += 1);
    }
    const expected = doubleheaders.includes(week) ? 2 : 1;
    const wrong = Object.entries(perWeek).filter(([, n]) => n !== expected);
    if (wrong.length) problems.push(`Week ${week}: ${wrong.length} franchise(s) do not play exactly ${expected} game(s)`);
    if (Object.keys(perWeek).length !== shape.franchiseIds.length) {
      problems.push(`Week ${week}: ${shape.franchiseIds.length - Object.keys(perWeek).length} franchise(s) have no game`);
    }
  }
  if (new Set(Object.values(played)).size > 1) problems.push('franchises do not all play the same number of games');

  for (const id of shape.franchiseIds) {
    const twice = Object.entries(opponents[id] ?? {})
      .filter(([, n]) => n >= 2)
      .map(([other]) => other)
      .sort();
    const mates = shape.franchiseIds
      .filter((other) => other !== id && shape.divisionOf[other] === shape.divisionOf[id])
      .sort();
    if (twice.join(',') !== mates.join(',')) {
      problems.push(`${shape.name[id]} does not play exactly its division rivals twice`);
    }
  }
  return problems;
};

/** `WW,AAAA,HHHH` lines for MFL's advanced schedule editor. */
export const toMflScheduleText = (weeks) => {
  const lines = [];
  for (const week of [...weeks.keys()].sort((a, b) => a - b)) {
    for (const g of weeks.get(week)) lines.push(`${String(week).padStart(2, '0')},${g.away},${g.home}`);
  }
  return lines.join('\n');
};

/* ---------------------------------------------------------------- planner */

/**
 * @param {object} args
 * @param {string} args.slug              league registry slug
 * @param {number} args.year              season to plan
 * @param {(year:number,feed:string)=>any} args.readFeed  parsed feed or null
 * @param {Record<string,number>} args.byes  NFL team -> bye week
 * @param {{restarts?:number,iterations?:number,seed?:number}} [args.search]
 */
export const planSchedule = ({ slug, year, readFeed, byes, search = {}, mode }) => {
  const base = SCHEDULE_POLICY[slug];
  if (!base) throw new Error(`no scheduling policy for league: ${slug}`);
  const policy = mode && mode !== base.mode ? { ...base, mode } : base;
  const shape = seasonShape(readFeed(year, 'league'));
  if (!shape) throw new Error(`missing league feed for ${slug} ${year}`);

  const clean = byeFreeWeeks(byes, shape.lastWeek);
  const doubleheaders = chooseDoubleheaderWeeks({
    count: policy.doubleheaderCount,
    byeFree: clean,
    startWindow: policy.startWindow,
    endWindow: policy.endWindow,
  });

  const currentSchedule = readFeed(year, 'schedule')?.schedule?.weeklySchedule;
  const current = currentSchedule ? regularSeasonGames(currentSchedule, shape.lastWeek) : new Map();
  const exposure = byeExposure(readFeed(year, 'rosters'), readFeed(year, 'players'), byes, shape.franchiseIds);

  let weeks;
  let crossConference = null;
  let fairness = null;

  if (policy.mode === 'constructive') {
    const cross = policy.crossConference
      ? buildCrossRound(shape, policy, year, readFeed(year - 1, 'league'), readFeed(year - 1, 'standings'))
      : null;
    if (cross) crossConference = {
      divisionPairing: cross.divisionPairing,
      alternateYear: cross.flip,
      skippedRivalries: cross.skippedRivalries,
      pairs: cross.pairs.map((p) => ({
        away: shape.name[p.away],
        home: shape.name[p.home],
        protectedRivalry: p.protectedRivalry,
      })),
    };
    const divisions = {};
    for (const id of shape.franchiseIds) (divisions[shape.divisionOf[id]] ??= []).push(id);
    // Conferences are keyed by DIVISION NAME so the builder can re-read the
    // annealer's current team ordering; a captured team array would freeze it.
    // A league whose divisions all share one conference has no cross-conference
    // structure at all, so it schedules against every division instead.
    const byConference = {};
    for (const name of Object.keys(divisions)) (byConference[shape.conferenceOf[divisions[name][0]]] ??= []).push(name);
    const conferences = Object.keys(byConference).length > 1 ? byConference : null;
    const divisionSize = shape.franchiseIds.length / shape.divisionCount;
    const crossWeek = policy.crossConference?.week ?? null;
    const conferenceSize = conferences
      ? shape.franchiseIds.length / Object.keys(conferences).length
      : shape.franchiseIds.length;
    const gamesPerTeam = (divisionSize - 1) * 2 + (conferenceSize - divisionSize) + (crossWeek ? 1 : 0);
    // Derived from THIS season's doubleheaders and byes. Never pinned — a
    // hard-coded plan silently contradicts the weeks the planner chose the
    // moment the bye calendar moves.
    const weekPlan = buildWeekPlan({
      lastWeek: shape.lastWeek,
      doubleheaders,
      byeCounts: byeCountsByWeek(byes),
      divisionSize,
      conferenceSize,
      crossWeek,
    });
    const best = searchSeason(
      {
        divisions,
        conferences,
        crossRound: cross?.games ?? [],
        weekPlan,
        franchiseIds: shape.franchiseIds,
        gamesPerTeam,
        doubleheaderWeeks: doubleheaders,
        lateWeeks: [shape.lastWeek - 2, shape.lastWeek - 1, shape.lastWeek],
        rating: priorRatings(readFeed(year - 1, 'standings'), shape.franchiseIds),
        byesFor: (id, week) => exposure[id]?.[week] ?? 0,
      },
      { restarts: search.restarts ?? 6, iterations: search.iterations ?? 12000, seed: search.seed ?? 20260822 },
    );
    weeks = best.weeks;
    fairness = best.score;
  } else {
    if (!current.size) throw new Error(`simple mode needs the current ${year} schedule feed, which is missing`);
    weeks = replanBySwappingDoubleheader(current, shape, { doubleheaders, byeFree: clean });
  }

  const ceiling = divisionGameCeiling({
    teamCount: shape.franchiseIds.length,
    divisionSize: shape.franchiseIds.length / shape.divisionCount,
    byeFree: clean,
    doubleheaders,
    reservedSlotsPerTeam: policy.crossConference && policy.mode === 'constructive' ? 1 : 0,
  });

  return {
    slug,
    year,
    mode: policy.mode,
    leagueName: shape.meta.name,
    lastWeek: shape.lastWeek,
    byeFreeWeeks: clean,
    doubleheaderWeeks: doubleheaders,
    currentDoubleheaderWeeks: current.size ? doubleheaderWeeks(current) : [],
    weeks,
    text: toMflScheduleText(weeks),
    crossConference,
    fairness,
    divisionGameCeiling: ceiling,
    plan: describeSeason(weeks, shape, { byes, exposure, byeFree: clean, doubleheaders }),
    currentPlan: current.size
      ? describeSeason(current, shape, {
          byes,
          exposure,
          byeFree: clean,
          doubleheaders: doubleheaderWeeks(current),
        })
      : null,
    problems: validateSeason(weeks, shape, { byeFree: clean, doubleheaders }),
    changedWeeks: current.size ? changedWeeks(current, weeks, shape.lastWeek) : null,
  };
};

/**
 * Simple mode: keep every week's rounds, and only redeal the weeks whose
 * doubleheader status changes.
 *
 * Which of the pooled rounds ends up in the single-game week is a free choice,
 * so it goes to the one with the fewest division games — a strict improvement
 * that disrupts nothing else on the calendar.
 */
const replanBySwappingDoubleheader = (current, shape, { doubleheaders, byeFree }) => {
  const rounds = decomposeSeasonIntoRounds(current, shape);
  const dhSet = new Set(doubleheaders);
  const wasDh = new Set(doubleheaderWeeks(current));
  const touched = [...new Set([...wasDh, ...doubleheaders])]
    .filter((w) => wasDh.has(w) !== dhSet.has(w))
    .sort((a, b) => a - b);

  const weeks = new Map();
  const place = (week, games) => {
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(...games);
  };
  const pool = [];
  for (const r of rounds) {
    if (touched.includes(r.sourceWeek)) pool.push(r);
    else place(r.sourceWeek, r.games);
  }
  pool.sort((a, b) => a.divisionGames - b.divisionGames);

  const openings = [];
  for (const w of touched) for (let i = 0; i < (dhSet.has(w) ? 2 : 1); i += 1) openings.push(w);
  if (openings.length !== pool.length) {
    throw new Error(`simple mode: ${pool.length} rounds to redeal but ${openings.length} openings`);
  }
  // Fewest-division rounds go to the bye weeks first.
  openings.sort((a, b) => (byeFree.includes(a) ? 1 : 0) - (byeFree.includes(b) ? 1 : 0) || a - b);
  openings.forEach((week, i) => place(week, pool[i].games));
  return weeks;
};

/** Weeks whose set of matchups differs from the published schedule. */
const changedWeeks = (current, planned, lastWeek) => {
  const keys = (games) =>
    (games ?? [])
      .map((g) => pairKey(g.away, g.home))
      .sort()
      .join('|');
  const changed = [];
  for (let w = 1; w <= lastWeek; w += 1) {
    if (keys(current.get(w)) !== keys(planned.get(w))) changed.push(w);
  }
  return changed;
};
