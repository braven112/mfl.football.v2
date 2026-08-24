/**
 * Constructive schedule builder — the "advanced" path, currently AFL only.
 *
 * WHY CONSTRUCT RATHER THAN RE-TIME
 *
 * The planner's `simple` mode re-times an existing schedule by moving whole
 * rounds between weeks. That is safe and minimal, and it is also why its
 * output is bad: the rounds it inherits are whatever last year's schedule
 * happened to contain, so "maximise bye-free division games" just stacks every
 * rivalry round into the opening weeks. Measured on The League 2026 that gives
 * 16 of 24 division pairs meeting within three weeks of each other (one pair a
 * week apart) against 0 of 24 today. A rematch seven days later is the same
 * game twice.
 *
 * The fix is to stop treating the round set as given. The AFL's format pins it
 * exactly:
 *
 *   10 division rounds     double round-robin inside each 6-team division
 *    6 interdivision       6x6 against the other division in your conference
 *    1 cross-conference    Week 1, paired on last season's division finishes
 *   -- = 17 rounds, and 14 weeks + 3 doubleheaders = 17 slots.
 *
 * There is no slack. Every week's shape is therefore forced, and the ONLY
 * freedom left is which round lands in which slot and who is drawn against
 * whom inside it — which is exactly the freedom worth searching over.
 *
 * THE WEEK PLAN, AND WHY IT IS WHAT IT IS
 *
 * Per-team slots are 7 in Weeks 1-5, 4 in Weeks 6-9, 6 in Weeks 10-14. Spend
 * them as 1 cross-conference + 5 first-leg division early, 4 interdivision in
 * the middle, 5 second-leg division + 1 interdivision late. That is a perfect
 * fit with zero waste and it satisfies three goals at once:
 *
 *   - Every division pair meets once early and once late, minimum gap 6 weeks.
 *   - The last five weeks are a rivalry stretch run, ending all-division.
 *   - Division games take all 7 bye-free slots a franchise has (Weeks 1-4 and
 *     12; Week 1 loses one to the cross-conference game), which is the ceiling
 *     — 84 of 120. The other 36 are forced onto bye weeks by the format, so
 *     they go to the LIGHTEST ones (Weeks 10, 13, 14) and Week 11, where six
 *     NFL teams are out, is deliberately given an interdivision round.
 *
 * WHAT THE SEARCH ACTUALLY OPTIMISES
 *
 * Only the soft fairness terms, since the structure above already fixes the
 * drama ones. Fairness-first weighting: bye differential dominates, then
 * season-long net bye, then doubleheader and late-season opponent strength,
 * then home/away balance.
 */

import { goalWeight } from './schedule-constraints.mjs';

/* --------------------------------------------------------------- rounds */

/**
 * Circle-method round-robin: n-1 rounds of n/2 games, every pair exactly once.
 * `teams` order is part of the search space — permuting it changes which pairs
 * meet in which round, which is how the annealer reaches different schedules.
 */
export const roundRobinRounds = (teams) => {
  if (teams.length % 2 !== 0) throw new Error('round-robin needs an even number of teams');
  const n = teams.length;
  const fixed = teams[0];
  let rotating = teams.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r += 1) {
    const games = [{ away: fixed, home: rotating[0] }];
    for (let i = 1; i < rotating.length - i + 1; i += 1) {
      const a = rotating[i];
      const b = rotating[rotating.length - i];
      if (a === b) break;
      games.push({ away: a, home: b });
    }
    rounds.push(games);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
};

/** Complete bipartite decomposition: |b| rounds, each a perfect matching of a x b. */
export const bipartiteRounds = (a, b) => {
  if (a.length !== b.length) throw new Error('bipartite rounds need equal sides');
  return a.map((_, r) => a.map((team, i) => ({ away: team, home: b[(i + r) % b.length] })));
};

/**
 * Non-division rounds — every game a franchise plays outside its own division,
 * decomposed into full-league perfect matchings.
 *
 * Two shapes, because the two leagues ask different questions:
 *
 *   AFL       plays only the OTHER division in its conference, so each
 *             conference contributes one 6x6 bipartite matching per round and
 *             the two conferences stack into a 12-game round. 6 rounds.
 *   The League has no conferences: every franchise plays all 12 teams outside
 *             its division once. That is the complete 4-partite graph
 *             K(4,4,4,4), 12-regular, so it decomposes into 12 perfect
 *             matchings — built here by running a round-robin ON THE DIVISIONS.
 *             Four divisions pair off three ways ({01|23}, {02|13}, {03|12}),
 *             and each pairing supplies 4 bipartite rounds: 3 x 4 = 12.
 *
 * `pairings` is the search space: permuting a division's team order changes who
 * is drawn against whom in each round without changing the round set.
 */
export const nonDivisionRounds = (divisionNames, teamsByDivision, { conferences = null } = {}) => {
  if (conferences) {
    const perConference = Object.values(conferences).map(([sideA, sideB]) => bipartiteRounds(sideA, sideB));
    const count = perConference[0].length;
    return Array.from({ length: count }, (_, r) => perConference.flatMap((rounds) => rounds[r]));
  }
  // Round-robin on the divisions themselves.
  const names = [...divisionNames];
  if (names.length % 2 !== 0) throw new Error('a conference-less league needs an even number of divisions');
  const rounds = [];
  for (const pairing of divisionRoundRobin(names)) {
    const bySide = pairing.map(([a, b]) => bipartiteRounds(teamsByDivision[a], teamsByDivision[b]));
    for (let r = 0; r < bySide[0].length; r += 1) rounds.push(bySide.flatMap((side) => side[r]));
  }
  return rounds;
};

/** Circle method over divisions: n-1 pairings, each splitting them all into pairs. */
export const divisionRoundRobin = (names) => {
  const n = names.length;
  const fixed = names[0];
  let rotating = names.slice(1);
  const pairings = [];
  for (let r = 0; r < n - 1; r += 1) {
    const pairs = [[fixed, rotating[0]]];
    for (let i = 1; i < rotating.length - i + 1; i += 1) {
      const a = rotating[i];
      const b = rotating[rotating.length - i];
      if (a === b) break;
      pairs.push([a, b]);
    }
    pairings.push(pairs);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return pairings;
};

/** Same pairings, sides reversed — the second leg of a double round-robin. */
export const mirrorRound = (games) => games.map((g) => ({ away: g.home, home: g.away }));

/* ------------------------------------------------------------ week plan */

/**
 * Weeks a division pair must be kept apart. The league's rule is "never twice
 * inside three weeks", so 4 is the smallest gap that satisfies it.
 */
export const MIN_REMATCH_GAP = 4;

/**
 * What counts as a LIGHT bye week — the ones a forced bye-week division round
 * should be steered onto.
 *
 * Two is not arbitrary: the NFL never schedules a bye week with fewer than two
 * teams out, so this is the floor, and a two-team week means at most a couple
 * of rosters in a 24-team league lose a starter. It is a TARGET, not a
 * guarantee — some seasons have fewer light weeks than the format has forced
 * rounds, and the rematch guarantee can put a light week out of reach. The
 * planner always takes the lightest weeks its block can legally reach;
 * `describeForcedByeWeeks` reports whether that cleared the bar.
 */
export const LIGHT_BYE_WEEK_MAX = 2;

/**
 * Build the week plan for a season — DERIVED, never hard-coded.
 *
 * An earlier version of this file pinned the doubleheaders to Weeks 1, 2 and
 * 12 because that is where they belong in 2026. That is the exact bug this
 * whole module exists to prevent: the bye calendar moves, so 2025's late
 * bye-free week is 13, and a pinned plan silently contradicts the
 * doubleheader weeks the planner derives. `validateSeason` caught it, which is
 * the only reason it is not still here.
 *
 * The shape falls out of three facts and one preference:
 *
 *   - Week 1 holds the cross-conference round.
 *   - Each division pair meets once in the first leg and once in the second,
 *     so the legs must sit in disjoint early and late blocks.
 *   - The blocks are as SHORT as they can be while holding their rounds, which
 *     pushes the first leg to the front and the second to the stretch run and
 *     leaves the middle for interdivision play.
 *   - Preference: within a block, division rounds go to the weeks with the
 *     fewest NFL byes. A late block that exactly fits is grown by one week so
 *     an interdivision round can absorb the block's worst bye week — in 2026
 *     that is Week 11, with six NFL teams out.
 *
 * ONE CONSEQUENCE WORTH KNOWING. The all-division finale is a preference, not
 * an invariant, and fairness outranks it. In 2022 the final week had six NFL
 * teams out — the worst of that season — so the interdivision round lands
 * there and the season does NOT end on rivalry games. That is the league's
 * stated precedence, but it visibly changes how the run-in feels, so
 * tests/schedule-week-plan.test.ts asserts it rather than leaving it to
 * chance: the finale is all-division unless it is the season's worst bye week.
 */
export const buildWeekPlan = ({
  lastWeek,
  doubleheaders,
  byeCounts = {},
  divisionSize,
  conferenceSize,
  crossWeek = null,
  /**
   * Weeks a division pair must be kept apart. 4 satisfies the league's "never
   * twice inside three weeks" rule with nothing to spare, and it bounds how
   * far back the second leg's window may be widened in search of a light bye
   * week — see the block below.
   */
  minRematchGap = MIN_REMATCH_GAP,
}) => {
  const dh = new Set(doubleheaders);
  const slots = [];
  for (let week = 1; week <= lastWeek; week += 1) {
    for (let i = 0; i < (dh.has(week) ? 2 : 1); i += 1) slots.push(week);
  }
  const legRounds = divisionSize - 1; // one meeting with each division rival
  const crossRounds = crossWeek ? 1 : 0;
  // Everyone inside your conference but outside your division, once each. For
  // the AFL that is the other division in its conference (12 - 6 = 6); for a
  // conference-less league the "conference" is the whole league (16 - 4 = 12).
  const interRounds = conferenceSize - divisionSize;
  const needed = legRounds * 2 + interRounds + crossRounds;
  if (slots.length !== needed) {
    throw new Error(
      `week plan does not fit: ${lastWeek} weeks + ${doubleheaders.length} doubleheaders = ${slots.length} slots, ` +
        `but the format needs ${needed} (${legRounds * 2} division + ${interRounds} interdivision` +
        `${crossRounds ? ' + 1 cross-conference' : ''})`,
    );
  }
  if (crossWeek && !dh.has(crossWeek)) {
    throw new Error(`Week ${crossWeek} must be a doubleheader to hold both the cross-conference and a division round`);
  }

  const byes = (week) => byeCounts[week] ?? 0;
  const countSlots = (weeks) => weeks.reduce((n, w) => n + (dh.has(w) ? 2 : 1), 0);

  // Shortest prefix that holds the first leg (plus the cross-conference round
  // when the league has one), then EXTENDED over any further bye-free weeks.
  //
  // The extension matters where the format leaves slack. The AFL's blocks fit
  // exactly, so nothing grows. The League's first leg is 3 rounds into a
  // 4-slot minimum prefix, and without the extension all three land in Weeks 1
  // and 2 — 16 of 48 division games in Week 1 alone, the same front-loading
  // that makes the naive optimiser's output bad. Widening to every clean week
  // lets `spread` below put one rivalry round in each of Weeks 1-3 instead.
  const earlyWeeks = [];
  for (let week = 1; week <= lastWeek && countSlots(earlyWeeks) < legRounds + crossRounds; week += 1) {
    earlyWeeks.push(week);
  }
  // Slots available to the second leg if the first block ends at `week` — it
  // cannot start until `minRematchGap` weeks later.
  const lateCapacityAfter = (week) => {
    let n = 0;
    for (let w = week + minRematchGap; w <= lastWeek; w += 1) n += dh.has(w) ? 2 : 1;
    return n;
  };
  while (
    earlyWeeks.at(-1) + 1 <= lastWeek &&
    byes(earlyWeeks.at(-1) + 1) === 0 &&
    countSlots([...earlyWeeks, earlyWeeks.at(-1) + 1]) < slots.length - legRounds &&
    // Never extend so far that the second leg cannot fit behind the rematch
    // gap. The old bound was slot arithmetic alone, which is fine while byes
    // stop the extension early — every real calendar has byes by Week 6. Feed
    // it a season with NO byes and the extension eats the schedule: the first
    // leg runs to Week 12, the second has nowhere legal to go, and the planner
    // throws on the easiest calendar it will ever see.
    lateCapacityAfter(earlyWeeks.at(-1) + 1) >= legRounds
  ) {
    earlyWeeks.push(earlyWeeks.at(-1) + 1);
  }

  // Shortest suffix that holds the second leg, then WIDENED backwards to every
  // week the rematch guarantee still allows.
  //
  // The widening is the whole reason a forced bye-week division round can pick
  // which bye week it lands on. A shortest-suffix block only reaches the last
  // few weeks of the season, so in 2026 the AFL's three unavoidable ones were
  // stuck with Weeks 10, 13 and 14 — ten NFL teams out — while Week 9, with
  // two out, sat one week beyond the block's edge and could not be considered.
  // Widening puts every reachable week in front of `rankSlots`, which already
  // sorts by bye count, so the lightest ones win. Nothing is forced INTO the
  // wider window: the `preferLate` tie-break means an equal-bye earlier week
  // loses to the later one, so the block only actually moves when moving buys
  // a lighter week.
  //
  // The floor is the binding constraint, not a formality. A pair's rematch gap
  // is (its leg-2 week − its leg-1 week), and the worst case pairs the LAST
  // first-leg week with the FIRST second-leg week — so the earliest week the
  // window may reach is `minRematchGap` past the end of the early block, and
  // every draw is then safe by construction rather than by luck. `scoreSeason`
  // has no rematch term to steer with, so a window one week too wide would
  // produce a Week 4 / Week 5 rivalry rematch, score it as good, and be caught
  // only by tests/schedule-optimization.test.ts.
  const lateWeeks = [];
  for (let week = lastWeek; week >= 1 && countSlots(lateWeeks) < legRounds; week -= 1) lateWeeks.unshift(week);
  const earliestLate = earlyWeeks.at(-1) + minRematchGap;
  if (lateWeeks[0] < earliestLate) {
    throw new Error(
      `the second division leg needs Week ${lateWeeks[0]}, only ${lateWeeks[0] - earlyWeeks.at(-1)} week(s) after ` +
        `the first leg ends in Week ${earlyWeeks.at(-1)} — rivals would meet twice inside ${minRematchGap} weeks`,
    );
  }
  while (lateWeeks[0] - 1 >= earliestLate) lateWeeks.unshift(lateWeeks[0] - 1);
  if (lateWeeks[0] <= earlyWeeks.at(-1)) {
    throw new Error('early and late division blocks overlap — the season is too short for this format');
  }

  // Within a block, division rounds take the cleanest weeks. Ties break toward
  // the season's edges so the opener and the finale stay rivalry games.
  // Whatever a block does not spend on division becomes interdivision.
  // Rank a block's slots for division play: cleanest week first, then SPREAD —
  // a week's first slot outranks any week's second, so rivalry rounds land in
  // distinct weeks before they double up. Ties break toward the season's edges
  // so the opener and the finale stay rivalry games.
  const rankSlots = (weeks, preferLate) => {
    const seen = {};
    return weeks
      .flatMap((w) => (dh.has(w) ? [w, w] : [w]))
      .map((week, i) => {
        seen[week] = (seen[week] ?? 0) + 1;
        return { week, i, nth: seen[week] };
      })
      .sort(
        (a, b) =>
          byes(a.week) - byes(b.week) ||
          a.nth - b.nth ||
          (preferLate ? b.week - a.week : a.week - b.week),
      );
  };

  const assignBlock = (weeks, divisionCount, leg, preferLate) => {
    const expanded = weeks.flatMap((w) => (dh.has(w) ? [w, w] : [w]));
    const chosen = new Set(
      rankSlots(weeks, preferLate)
        .slice(0, divisionCount)
        .map((r) => r.i),
    );
    return expanded.map((week, i) => ({ week, kind: chosen.has(i) ? 'division' : 'inter', leg }));
  };

  const kindByWeek = new Map();
  const push = (week, slot) => {
    if (!kindByWeek.has(week)) kindByWeek.set(week, []);
    kindByWeek.get(week).push(slot);
  };

  // The cross-conference round, where a league has one, consumes one of Week 1's
  // two slots before the first leg is dealt.
  const earlySlots = earlyWeeks.flatMap((w) => (dh.has(w) ? [w, w] : [w]));
  if (crossWeek) {
    // Take the cross slot out of the early block by INDEX, and only when it is
    // actually there. `splice(indexOf(x), 1)` on a miss is `splice(-1, 1)`,
    // which silently deletes the last early slot instead — a division leg
    // vanishes and the plan comes back one round short, with nothing pointing
    // at this line. `dh.has(crossWeek)` does not cover it: the cross week can
    // sit outside the early block entirely.
    const at = earlySlots.indexOf(crossWeek);
    if (at === -1) {
      throw new Error(
        `crossWeek ${crossWeek} is not one of the early-block weeks (${earlyWeeks.join(', ')})`,
      );
    }
    earlySlots.splice(at, 1);
    push(crossWeek, { kind: 'cross' });
  }

  const earlySeen = {};
  const earlyChosen = new Set(
    earlySlots
      .map((week, i) => {
        earlySeen[week] = (earlySeen[week] ?? 0) + 1;
        return { week, i, nth: earlySeen[week] };
      })
      .sort((a, b) => byes(a.week) - byes(b.week) || a.nth - b.nth || a.week - b.week)
      .slice(0, legRounds)
      .map((r) => r.i),
  );
  earlySlots.forEach((week, i) =>
    push(week, earlyChosen.has(i) ? { kind: 'division', leg: 0 } : { kind: 'inter' }),
  );
  for (const s of assignBlock(lateWeeks, legRounds, 1, true)) {
    push(s.week, s.kind === 'division' ? { kind: 'division', leg: 1 } : { kind: 'inter' });
  }
  for (let week = earlyWeeks.at(-1) + 1; week < lateWeeks[0]; week += 1) {
    for (let i = 0; i < (dh.has(week) ? 2 : 1); i += 1) push(week, { kind: 'inter' });
  }

  const plan = [];
  for (let week = 1; week <= lastWeek; week += 1) plan.push({ week, slots: kindByWeek.get(week) ?? [] });

  const tally = plan.flatMap((w) => w.slots);
  const count = (kind, leg) => tally.filter((s) => s.kind === kind && (leg === undefined || s.leg === leg)).length;
  if (
    count('cross') !== crossRounds ||
    count('division', 0) !== legRounds ||
    count('division', 1) !== legRounds ||
    count('inter') !== interRounds
  ) {
    throw new Error(
      `week plan is unbalanced: ${count('division', 0)}/${count('division', 1)} division legs and ` +
        `${count('inter')} interdivision rounds, expected ${legRounds}/${legRounds} and ${interRounds}`,
    );
  }
  return plan;
};

/* ------------------------------------------------------------ objective */

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const variance = (xs) => {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
};

/**
 * Score a candidate season. LOWER IS BETTER.
 *
 * Terms are scaled so they are comparable before weighting; the weights then
 * express "fairness first". Drama is absent on purpose — AFL_WEEK_PLAN already
 * guarantees it structurally, so paying for it again here would only let the
 * search trade away fairness for something it already has.
 */
export const scoreSeason = (weeks, ctx, weights = {}) => {
  const w = {
    byeDifferential: 1.0,
    netByeAdvantage: 0.6,
    // Scaled from the published goal weights rather than tuned by hand, so the
    // optimiser cannot rank this differently than the page says it is ranked:
    // the light-bye-week goal outweighs bye luck 70 to 45, and byeDifferential
    // is bye luck's term at 1.0. The other four are legacy tuning, kept because
    // re-deriving them would change every existing draw for no stated reason;
    // a test pins that their ORDER still matches the goal weights.
    divisionByeCost: goalWeight('light-bye-weeks') / goalWeight('bye-luck'),
    doubleheaderStrength: 0.25,
    lateSeasonStrength: 0.25,
    homeAwayBalance: 0.15,
    ...weights,
  };
  const { byesFor, rating, doubleheaderWeeks, lateWeeks, franchiseIds, gamesPerTeam, divisionOf } = ctx;
  const dh = new Set(doubleheaderWeeks);
  const late = new Set(lateWeeks);

  let byeDiff = 0;
  // Starters missing from RIVALRY games specifically, summed over both sides.
  //
  // This is the term that makes the schedule choose a week for a particular
  // matchup rather than for the league as a whole. byeDifferential only cares
  // that the two sides are EQUALLY hurt — two division rivals both missing
  // three starters scores perfectly on it, which is exactly the game nobody
  // wants to play. Counting the absolute total, for division games only, is
  // what expresses "put rivals against each other in weeks neither is missing
  // anyone".
  let divisionByeTotal = 0;
  let divisionGames = 0;
  const net = {};
  const dhStrength = {};
  const lateStrength = {};
  const homeCount = {};
  for (const id of franchiseIds) {
    net[id] = 0;
    dhStrength[id] = 0;
    lateStrength[id] = 0;
    homeCount[id] = 0;
  }

  for (const [week, games] of weeks) {
    for (const g of games) {
      const ba = byesFor(g.away, week);
      const bb = byesFor(g.home, week);
      byeDiff += Math.abs(ba - bb);
      if (divisionOf && divisionOf[g.away] === divisionOf[g.home]) {
        divisionGames += 1;
        divisionByeTotal += ba + bb;
      }
      net[g.away] += bb - ba;
      net[g.home] += ba - bb;
      homeCount[g.home] += 1;
      if (dh.has(week)) {
        dhStrength[g.away] += rating[g.home] ?? 0;
        dhStrength[g.home] += rating[g.away] ?? 0;
      }
      if (late.has(week)) {
        lateStrength[g.away] += rating[g.home] ?? 0;
        lateStrength[g.home] += rating[g.away] ?? 0;
      }
    }
  }

  const target = gamesPerTeam / 2;
  const terms = {
    // Per game, so leagues of different sizes compare.
    byeDifferential: byeDiff / ((gamesPerTeam * franchiseIds.length) / 2),
    divisionByeCost: divisionGames ? divisionByeTotal / divisionGames : 0,
    netByeAdvantage: Math.sqrt(mean(franchiseIds.map((id) => net[id] ** 2))),
    doubleheaderStrength: Math.sqrt(variance(franchiseIds.map((id) => dhStrength[id]))),
    lateSeasonStrength: Math.sqrt(variance(franchiseIds.map((id) => lateStrength[id]))),
    homeAwayBalance: Math.sqrt(mean(franchiseIds.map((id) => (homeCount[id] - target) ** 2))),
  };
  const total = Object.entries(terms).reduce((sum, [k, v]) => sum + w[k] * v, 0);
  return { total, terms };
};

/* --------------------------------------------------------------- search */

/**
 * Even out home games by flipping sides.
 *
 * The constructions above are systematically lopsided — `bipartiteRounds` puts
 * one whole division on the road for all six interdivision games, and the
 * cross-conference round always travels the American League — so a freshly
 * materialised season can have franchises on 5 or 12 home games out of 17.
 *
 * Which side is "home" constrains nothing else, so this is a free repair
 * rather than a trade-off: flip any game whose flip reduces total squared
 * deviation from the target, repeat to a fixed point. With an odd game count
 * the best possible is 8/9, and this reaches it. Doing it as a post-pass
 * instead of inside the annealer keeps each search iteration cheap.
 */
export const balanceHomeAway = (weeks, franchiseIds, gamesPerTeam) => {
  const target = gamesPerTeam / 2;
  const home = {};
  for (const id of franchiseIds) home[id] = 0;
  for (const games of weeks.values()) for (const g of games) home[g.home] += 1;

  const cost = (id) => (home[id] - target) ** 2;
  for (let pass = 0; pass < 50; pass += 1) {
    let improved = false;
    for (const games of weeks.values()) {
      for (let i = 0; i < games.length; i += 1) {
        const g = games[i];
        const before = cost(g.home) + cost(g.away);
        home[g.home] -= 1;
        home[g.away] += 1;
        const after = cost(g.home) + cost(g.away);
        if (after < before) {
          games[i] = { away: g.home, home: g.away };
          improved = true;
        } else {
          home[g.home] += 1;
          home[g.away] -= 1;
        }
      }
    }
    if (!improved) break;
  }
  return weeks;
};

/** Deterministic PRNG — a schedule has to be reproducible from its seed. */
export const makeRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const shuffled = (xs, rng) => {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * A candidate is fully described by the orderings below; `materialise` turns
 * one into weeks. Keeping the state this small is what makes the search cheap
 * — every candidate is valid by construction, so there is no repair step and
 * no wasted evaluation on illegal schedules.
 */
const materialise = (state, ctx) => {
  const { divisions, conferences, crossRound, weekPlan } = ctx;

  // One ordering per division drives BOTH constructions — the round-robin
  // inside the division and the bipartite pairings against other divisions.
  // Permuting it is what lets the annealer reach a different schedule without
  // ever changing the round set.
  const ordered = state.teamOrder;

  const divisionPool = {};
  for (const division of Object.keys(divisions)) {
    const base = roundRobinRounds(ordered[division]);
    divisionPool[division] = [
      state.legOrder[division][0].map((r) => base[r]),
      state.legOrder[division][1].map((r) => mirrorRound(base[r])),
    ];
  }

  const conferenceTeams = conferences
    ? Object.fromEntries(Object.entries(conferences).map(([c, [a, b]]) => [c, [ordered[a], ordered[b]]]))
    : null;
  const pool = nonDivisionRounds(Object.keys(divisions), ordered, { conferences: conferenceTeams });
  const interPool = state.interSlotOrder.map((r) => pool[r]);

  const cursor = { division: [0, 0], inter: 0 };
  const weeks = new Map();
  for (const { week, slots } of weekPlan) {
    const games = [];
    for (const slot of slots) {
      if (slot.kind === 'cross') {
        games.push(...crossRound);
      } else if (slot.kind === 'division') {
        const i = cursor.division[slot.leg];
        for (const division of Object.keys(divisions)) games.push(...divisionPool[division][slot.leg][i]);
        cursor.division[slot.leg] += 1;
      } else {
        games.push(...interPool[cursor.inter]);
        cursor.inter += 1;
      }
    }
    weeks.set(week, games);
  }
  return weeks;
};

const randomState = (ctx, rng) => {
  const state = { teamOrder: {}, legOrder: {}, interSlotOrder: [] };
  for (const [division, teams] of Object.entries(ctx.divisions)) {
    state.teamOrder[division] = shuffled(teams, rng);
    const idx = teams.slice(0, teams.length - 1).map((_, i) => i);
    state.legOrder[division] = [shuffled(idx, rng), shuffled(idx, rng)];
  }
  const interCount = ctx.weekPlan.flatMap((w) => w.slots).filter((s) => s.kind === 'inter').length;
  state.interSlotOrder = shuffled(
    Array.from({ length: interCount }, (_, i) => i),
    rng,
  );
  return state;
};

const mutate = (state, ctx, rng) => {
  const next = {
    teamOrder: { ...state.teamOrder },
    legOrder: { ...state.legOrder },
    interSlotOrder: state.interSlotOrder,
  };
  const divisions = Object.keys(ctx.divisions);
  const swap = (arr) => {
    const out = arr.slice();
    const i = Math.floor(rng() * out.length);
    let j = Math.floor(rng() * out.length);
    if (i === j) j = (j + 1) % out.length;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };
  const pick = rng();
  if (pick < 0.4) {
    const d = divisions[Math.floor(rng() * divisions.length)];
    next.teamOrder[d] = swap(state.teamOrder[d]);
  } else if (pick < 0.75) {
    const d = divisions[Math.floor(rng() * divisions.length)];
    const leg = rng() < 0.5 ? 0 : 1;
    const legs = state.legOrder[d].slice();
    legs[leg] = swap(legs[leg]);
    next.legOrder[d] = legs;
  } else {
    next.interSlotOrder = swap(state.interSlotOrder);
  }
  return next;
};

/**
 * Simulated annealing with restarts. Returns the best season found plus its
 * score breakdown, so the caller can report WHICH fairness term is binding
 * rather than just a number.
 */
export const searchSeason = (ctx, { seed = 20260822, restarts = 6, iterations = 12000, weights } = {}) => {
  let best = null;
  for (let r = 0; r < restarts; r += 1) {
    const rng = makeRng(seed + r * 7919);
    let state = randomState(ctx, rng);
    let weeks = materialise(state, ctx);
    let score = scoreSeason(weeks, ctx, weights);
    for (let i = 0; i < iterations; i += 1) {
      const temperature = 1 - i / iterations;
      const candidate = mutate(state, ctx, rng);
      const candidateWeeks = materialise(candidate, ctx);
      const candidateScore = scoreSeason(candidateWeeks, ctx, weights);
      const delta = candidateScore.total - score.total;
      if (delta < 0 || rng() < Math.exp(-delta / Math.max(1e-6, 0.05 * temperature))) {
        state = candidate;
        weeks = candidateWeeks;
        score = candidateScore;
      }
    }
    if (!best || score.total < best.score.total) best = { state, weeks, score, restart: r };
  }
  // Sides are a free variable, so balance them once at the end and re-score —
  // annealing on them would only spend iterations on something with an exact fix.
  balanceHomeAway(best.weeks, ctx.franchiseIds, ctx.gamesPerTeam);
  best.score = scoreSeason(best.weeks, ctx, weights);
  return best;
};

export { materialise as materialiseSeason };
