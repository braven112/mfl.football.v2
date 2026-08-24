/**
 * Schedule construction rules shared by the optimizer and the annual audit.
 *
 *   src/utils/schedule-plan.mjs            builds a compliant schedule
 *   tests/schedule-optimization.test.ts    checks the live one against these
 *
 * Both leagues state the same three scheduling goals (see
 * src/data/league-constitution.ts and src/data/afl-constitution.ts):
 *
 *   1. Doubleheaders must not land on an NFL bye week.
 *   2. Doubleheaders are split as evenly as possible between the start and
 *      the end of the season.
 *   3. Division games should avoid NFL bye weeks whenever possible.
 *
 * Goal 3 is a MAXIMIZE, not a MUST. Whether it can be fully satisfied is pure
 * arithmetic — `divisionGameCeiling` below — and for the AFL the answer is no:
 * six-team divisions ask for more division games than the bye-free weeks have
 * slots. Reporting "72 division games on byes" without that ceiling reads as a
 * failure when a chunk of it is forced by the format.
 *
 * THE LOAD-BEARING IDEA: rounds, not games.
 *
 * A season is a multigraph where every franchise has degree = games played. A
 * regular multigraph decomposes into perfect matchings, and one perfect
 * matching is exactly "one game for every franchise" — a ROUND. A normal week
 * is one round; a doubleheader week is two. So re-timing a schedule is not a
 * matter of moving individual games around (which breaks the one-game-per-team
 * invariant the moment you move the first one) — it is decomposing the season
 * into rounds and then choosing which week each round is played.
 *
 * That framing is what makes the optimizer safe: every matchup, every
 * home/away side, and every opponent count survives untouched. Only the week
 * label changes. The one thing it cannot fix is a WRONG opponent, which is why
 * the AFL's cross-conference round is rebuilt separately, before rounds are
 * assigned to weeks.
 */

export const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/* ------------------------------------------------------------------ byes */

/** `{ week: number of NFL teams on bye }` for a season of data/nfl/bye-weeks.json. */
/**
 * Every bye week an NFL team has, as an array.
 *
 * The stored shape is `{ TEAM: week }` because the NFL has always given each
 * team exactly one bye. It has been openly discussing a second one alongside an
 * 18-game season, and the failure mode if that lands is silent: a
 * `{ TEAM: [6, 12] }` payload makes `counts[week]` key off the string "6,12",
 * so every week reads as bye-free and the planner cheerfully schedules
 * doubleheaders into byes. Accepting both shapes costs one line and removes a
 * whole class of wrong-but-quiet output.
 */
export const byeWeeksOf = (byesForSeason, team) => {
  const value = byesForSeason?.[team];
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map(Number).filter((w) => Number.isInteger(w) && w > 0);
};

export const byeCountsByWeek = (byesForSeason) => {
  const counts = {};
  for (const team of Object.keys(byesForSeason ?? {})) {
    for (const week of byeWeeksOf(byesForSeason, team)) counts[week] = (counts[week] ?? 0) + 1;
  }
  return counts;
};

/** Regular-season weeks with ZERO NFL teams on bye — the only weeks fully clean. */
export const byeFreeWeeks = (byesForSeason, lastRegularSeasonWeek) => {
  const counts = byeCountsByWeek(byesForSeason);
  const out = [];
  for (let w = 1; w <= lastRegularSeasonWeek; w += 1) if (!counts[w]) out.push(w);
  return out;
};

/* -------------------------------------------------------------- schedule */

/**
 * `{ week: [{ away, home }] }` for the regular season only.
 *
 * Playoff weeks are dropped by week number rather than by "has matchups",
 * because an unplayed season carries empty playoff weeks and a played one
 * carries full ones — the same schedule must parse identically in August and
 * in January.
 */
export const regularSeasonGames = (weeklySchedule, lastRegularSeasonWeek) => {
  const byWeek = new Map();
  for (const week of asArray(weeklySchedule)) {
    const w = Number(week.week);
    if (!Number.isInteger(w) || w < 1 || w > lastRegularSeasonWeek) continue;
    const games = [];
    for (const matchup of asArray(week.matchup)) {
      const sides = asArray(matchup.franchise);
      if (sides.length !== 2) continue;
      if (sides[0].id === sides[1].id) continue; // MFL bye row, not a game
      const home = sides.find((s) => String(s.isHome) === '1') ?? sides[1];
      const away = sides.find((s) => s !== home);
      games.push({ away: away.id, home: home.id });
    }
    if (games.length) byWeek.set(w, games);
  }
  return byWeek;
};

/** Weeks in which at least one franchise plays twice. */
export const doubleheaderWeeks = (gamesByWeek) => {
  const out = [];
  for (const [week, games] of gamesByWeek) {
    const seen = new Map();
    for (const g of games) {
      for (const id of [g.away, g.home]) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    if ([...seen.values()].some((n) => n > 1)) out.push(week);
  }
  return out.sort((a, b) => a - b);
};

/**
 * Split one week into rounds (perfect matchings).
 *
 * A single-game week is already a round. A doubleheader week is a 2-regular
 * multigraph: a disjoint union of cycles, and an EVEN cycle 2-colours into two
 * perfect matchings by alternating around it. An odd cycle does not, and there
 * is no repair for it here — it means the week is not two clean rounds, so we
 * throw rather than emit a round in which some franchise plays twice.
 */
export const splitWeekIntoRounds = (games, week) => {
  const degree = new Map();
  for (const g of games) {
    for (const id of [g.away, g.home]) degree.set(id, (degree.get(id) ?? 0) + 1);
  }
  const degrees = new Set(degree.values());
  if (degrees.size !== 1) {
    throw new Error(`week ${week}: franchises play unequal numbers of games (${[...degrees].join('/')})`);
  }
  const perTeam = [...degrees][0];
  if (perTeam === 1) return [games];
  if (perTeam !== 2) throw new Error(`week ${week}: ${perTeam} games per franchise is not supported`);

  const incident = new Map();
  games.forEach((g, i) => {
    for (const id of [g.away, g.home]) {
      if (!incident.has(id)) incident.set(id, []);
      incident.get(id).push(i);
    }
  });

  const colour = new Array(games.length).fill(-1);
  const other = (i, id) => (games[i].away === id ? games[i].home : games[i].away);

  for (let start = 0; start < games.length; start += 1) {
    if (colour[start] !== -1) continue;
    // Walk the cycle this edge belongs to, collecting it in traversal order.
    const cycle = [];
    let edge = start;
    let node = games[start].home;
    do {
      cycle.push(edge);
      const [x, y] = incident.get(node);
      const next = x === edge ? y : x;
      node = other(next, node);
      edge = next;
    } while (edge !== start);
    if (cycle.length % 2 !== 0) {
      throw new Error(`week ${week}: odd cycle of ${cycle.length} games cannot split into two rounds`);
    }
    cycle.forEach((e, i) => {
      colour[e] = i % 2;
    });
  }
  return [games.filter((_, i) => colour[i] === 0), games.filter((_, i) => colour[i] === 1)];
};

/**
 * Decompose a whole regular season into rounds, tagged with what each is worth.
 * `sourceWeek` is kept purely so a diff can say where a round used to be played.
 */
export const decomposeSeasonIntoRounds = (gamesByWeek, { divisionOf, conferenceOf }) => {
  const rounds = [];
  for (const week of [...gamesByWeek.keys()].sort((a, b) => a - b)) {
    for (const games of splitWeekIntoRounds(gamesByWeek.get(week), week)) {
      rounds.push({
        sourceWeek: week,
        games,
        divisionGames: games.filter((g) => divisionOf[g.away] === divisionOf[g.home]).length,
        crossConferenceGames: games.filter((g) => conferenceOf[g.away] !== conferenceOf[g.home]).length,
      });
    }
  }
  return rounds;
};

/* ----------------------------------------------------------- doubleheaders */

/**
 * Pick doubleheader weeks: bye-free, split as evenly as possible between the
 * start and the end of the season, earliest-and-latest first within each half.
 *
 * `startWindow`/`endWindow` are the league's own ideal windows. Weeks in them
 * that carry byes are simply not offered — goal 1 outranks goal 2, so a league
 * that cannot fill its end window (2026 offers exactly one clean late week)
 * gets an uneven split rather than a doubleheader on a bye.
 */
export const chooseDoubleheaderWeeks = ({
  count,
  byeFree,
  startWindow,
  endWindow,
  required = [],
  byeCounts = {},
  lastWeek = 0,
}) => {
  const clean = new Set(byeFree);
  // A week the FORMAT forces to hold two rounds — the AFL's Week 1, which the
  // constitution pins the cross-conference round to while a division round
  // shares the slot. It is taken whether or not it is bye-free, because the
  // format outranks the no-doubleheader-on-a-bye goal: 2017 had a Week 1 bye
  // and the planner threw rather than scheduling the season at all. Taking it
  // and letting the scorecard report the goal as failed is the honest outcome;
  // refusing to produce a season is not.
  const forced = required.filter((w) => Number.isInteger(w));
  const early = startWindow.filter((w) => clean.has(w)).sort((a, b) => a - b);
  // DESCENDING, so the LATEST clean week in the window is taken first. That is
  // the finale-doubleheader goal and it is the whole of its implementation:
  // the league wants the season to finish on a double rather than taper off.
  // It read as an arbitrary sort order for years and is exactly the kind of
  // line someone tidies into ascending without knowing what it does.
  const late = endWindow.filter((w) => clean.has(w)).sort((a, b) => b - a);

  const remaining = Math.max(0, count - forced.length);
  // The late share comes from the FULL count, discounting only forced weeks
  // that are themselves late.
  //
  // It used to be `floor(remaining / 2)`, which subtracted the forced week
  // before halving. The forced week is Week 1 — always early — so subtracting
  // it shrank the pool the LATE share was drawn from and skewed the whole
  // split early: AFL 2011 got 2/0 with two clean end weeks going spare, and
  // 2015 and 2017 got 3/1 where 2/2 was available. Four seasons, and the
  // league's stated preference is doubleheaders at the start AND the end, as
  // evenly as the calendar allows.
  const forcedLate = forced.filter((w) => endWindow.includes(w)).length;
  const wantLate = Math.max(0, Math.floor(count / 2) - forcedLate);
  const takeLate = late.filter((w) => !forced.includes(w)).slice(0, Math.min(wantLate, late.length));
  const takeEarly = early
    .filter((w) => !forced.includes(w))
    .slice(0, remaining - takeLate.length);
  const picked = [...forced, ...takeEarly, ...takeLate];

  if (picked.length < count) {
    // Not enough clean weeks in either window; widen to any clean week.
    for (const w of byeFree) {
      if (picked.length >= count) break;
      if (!picked.includes(w)) picked.push(w);
    }
  }
  // Still short: the season has FEWER bye-free weeks than the format needs
  // doubleheaders, so one has to land on a bye. Replaying 2013-2020 found this
  // is not hypothetical — those seasons ran 13 weeks against an 18-round
  // format, needing five doubleheaders where only four weeks were bye-free.
  // The planner used to throw and produce no season at all.
  //
  // The format outranks the no-doubleheader-on-a-bye goal, so take the
  // LIGHTEST bye weeks going and let the scorecard report the goal as failed.
  // A season with one doubleheader on a two-team bye week beats no season.
  if (picked.length < count && lastWeek) {
    const rest = [];
    for (let w = 1; w <= lastWeek; w += 1) if (!picked.includes(w)) rest.push(w);
    rest.sort((a, b) => (byeCounts[a] ?? 0) - (byeCounts[b] ?? 0) || a - b);
    for (const w of rest) {
      if (picked.length >= count) break;
      picked.push(w);
    }
  }
  return picked.sort((a, b) => a - b);
};

/* ------------------------------------------------------ division ceilings */

/**
 * The most division games that can be bye-free, and why.
 *
 * A franchise has a fixed number of game slots in the bye-free weeks (1 per
 * normal week, 2 per doubleheader). Slots reserved for another rule — the
 * AFL's Week 1 cross-conference game — are not available to division games.
 * Whatever is left is the per-team cap; below it, the format itself is the
 * binding constraint and no amount of scheduling skill helps.
 */
export const divisionGameCeiling = ({
  teamCount,
  divisionSize,
  byeFree,
  doubleheaders,
  reservedSlotsPerTeam = 0,
}) => {
  const dhSet = new Set(doubleheaders);
  const slots = byeFree.reduce((n, w) => n + (dhSet.has(w) ? 2 : 1), 0);
  const available = Math.max(0, slots - reservedSlotsPerTeam);
  const divisionGamesPerTeam = (divisionSize - 1) * 2;
  const perTeam = Math.min(divisionGamesPerTeam, available);
  const total = (teamCount * divisionGamesPerTeam) / 2;
  return {
    total,
    ceiling: (teamCount * perTeam) / 2,
    forcedOntoByeWeeks: total - (teamCount * perTeam) / 2,
    slotsPerTeam: slots,
    divisionGamesPerTeam,
  };
};

/** Division games played in weeks with no NFL byes. */
export const byeFreeDivisionGames = (gamesByWeek, divisionOf, byeFree) => {
  const clean = new Set(byeFree);
  let n = 0;
  for (const [week, games] of gamesByWeek) {
    if (!clean.has(week)) continue;
    n += games.filter((g) => divisionOf[g.away] === divisionOf[g.home]).length;
  }
  return n;
};

/* ------------------------------------------- AFL cross-conference pairing */

/**
 * Rank each franchise within its division using MFL's own standings order.
 *
 * MFL's `leagueStandings` row order already applies the constitution's
 * tiebreaker chain, including head-to-head we cannot reproduce, so it is read
 * as given and never re-sorted (see docs/claude/rules/standings-brackets-draft-order.md).
 */
export const divisionFinishRanks = (standingsFranchises, divisionOf) => {
  const rank = {};
  const seen = {};
  for (const f of asArray(standingsFranchises)) {
    const div = divisionOf[f.id];
    if (div == null) continue;
    seen[div] = (seen[div] ?? 0) + 1;
    rank[f.id] = { division: div, rank: seen[div] };
  }
  return rank;
};

/**
 * The AFL's Week 1 cross-conference round.
 *
 * Each franchise plays the team that finished in the same slot of the paired
 * opposite-conference division. The division pairing alternates year to year,
 * so it is passed in rather than derived.
 *
 * `protectedPairs` are permanent rivalries that outrank the formula. Locking
 * one can leave a division short a partner — in an alternating year the
 * protected pair may even straddle two different division pairings — so
 * whoever is left over in each conference is matched against whoever is left
 * over in the other, in finish order. That fallback is the whole reason this
 * returns leftovers explicitly instead of assuming the zip always balances.
 */
export const buildCrossConferencePairs = ({
  prevRank,
  divisionPairing,
  protectedPairs = [],
  conferenceOf,
  franchiseIds,
}) => {
  const used = new Set();
  const pairs = [];

  for (const [a, b] of protectedPairs) {
    if (!franchiseIds.includes(a) || !franchiseIds.includes(b)) continue;
    if (conferenceOf[a] === conferenceOf[b]) {
      throw new Error(`protected pair ${a}/${b} is not cross-conference`);
    }
    pairs.push({ away: a, home: b, protectedRivalry: true });
    used.add(a);
    used.add(b);
  }

  const inDivision = (division) =>
    franchiseIds
      .filter((id) => prevRank[id]?.division === division && !used.has(id))
      .sort((x, y) => prevRank[x].rank - prevRank[y].rank);

  for (const [divA, divB] of divisionPairing) {
    const left = inDivision(divA);
    const right = inDivision(divB);
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
      pairs.push({ away: left[i], home: right[i], protectedRivalry: false });
      used.add(left[i]);
      used.add(right[i]);
    }
  }

  // Anyone orphaned by a protected pair, matched across conferences in finish order.
  const leftovers = (conference) =>
    franchiseIds
      .filter((id) => conferenceOf[id] === conference && !used.has(id) && prevRank[id])
      .sort((x, y) => prevRank[x].rank - prevRank[y].rank);
  const conferences = [...new Set(franchiseIds.map((id) => conferenceOf[id]))].sort();
  const orphanA = leftovers(conferences[0]);
  const orphanB = leftovers(conferences[1]);
  for (let i = 0; i < Math.min(orphanA.length, orphanB.length); i += 1) {
    pairs.push({ away: orphanA[i], home: orphanB[i], protectedRivalry: false });
    used.add(orphanA[i]);
    used.add(orphanB[i]);
  }

  const unmatched = franchiseIds.filter((id) => !used.has(id));
  if (unmatched.length) {
    throw new Error(`cross-conference pairing left ${unmatched.length} franchise(s) unmatched: ${unmatched.join(',')}`);
  }
  return pairs;
};

/** `{ '0005-0018': true }` style key so a pairing set can be compared order-free. */
export const pairKey = (a, b) => [a, b].sort().join('-');
