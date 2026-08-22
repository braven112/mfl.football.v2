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

/** Same pairings, sides reversed — the second leg of a double round-robin. */
export const mirrorRound = (games) => games.map((g) => ({ away: g.home, home: g.away }));

/* ------------------------------------------------------------ week plan */

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
export const buildWeekPlan = ({ lastWeek, doubleheaders, byeCounts = {}, divisionSize, crossWeek = 1 }) => {
  const dh = new Set(doubleheaders);
  const slots = [];
  for (let week = 1; week <= lastWeek; week += 1) {
    for (let i = 0; i < (dh.has(week) ? 2 : 1); i += 1) slots.push(week);
  }
  const legRounds = divisionSize - 1; // one meeting with each division rival
  const interRounds = divisionSize; // 6x6 against the other division in your conference
  const needed = legRounds * 2 + interRounds + 1;
  if (slots.length !== needed) {
    throw new Error(
      `week plan does not fit: ${lastWeek} weeks + ${doubleheaders.length} doubleheaders = ${slots.length} slots, ` +
        `but the format needs ${needed} (${legRounds * 2} division + ${interRounds} interdivision + 1 cross-conference)`,
    );
  }
  if (!dh.has(crossWeek)) {
    throw new Error(`Week ${crossWeek} must be a doubleheader to hold both the cross-conference and a division round`);
  }

  const byes = (week) => byeCounts[week] ?? 0;
  const countSlots = (weeks) => weeks.reduce((n, w) => n + (dh.has(w) ? 2 : 1), 0);

  // Shortest prefix that holds the cross-conference round plus the first leg.
  const earlyWeeks = [];
  for (let week = 1; week <= lastWeek && countSlots(earlyWeeks) < legRounds + 1; week += 1) earlyWeeks.push(week);

  // Shortest suffix that holds the second leg, grown by one week when it fits
  // exactly and carries byes, so an interdivision round can take the worst.
  const lateWeeks = [];
  for (let week = lastWeek; week >= 1 && countSlots(lateWeeks) < legRounds; week -= 1) lateWeeks.unshift(week);
  const first = lateWeeks[0];
  if (countSlots(lateWeeks) === legRounds && lateWeeks.some((w) => byes(w) > 0) && first - 1 > earlyWeeks.at(-1)) {
    lateWeeks.unshift(first - 1);
  }
  if (lateWeeks[0] <= earlyWeeks.at(-1)) {
    throw new Error('early and late division blocks overlap — the season is too short for this format');
  }

  // Within a block, division rounds take the cleanest weeks. Ties break toward
  // the season's edges so the opener and the finale stay rivalry games.
  // Whatever a block does not spend on division becomes interdivision.
  const assignBlock = (weeks, divisionCount, leg, preferLate) => {
    const expanded = weeks.flatMap((w) => (dh.has(w) ? [w, w] : [w]));
    const chosen = new Set(
      expanded
        .map((week, i) => ({ week, i }))
        .sort((a, b) => byes(a.week) - byes(b.week) || (preferLate ? b.week - a.week : a.week - b.week))
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

  // The cross-conference round consumes one of Week 1's two slots before the
  // first leg is dealt, so the early block is dealt over what is left.
  const earlySlots = earlyWeeks.flatMap((w) => (dh.has(w) ? [w, w] : [w]));
  const crossAt = earlySlots.indexOf(crossWeek);
  earlySlots.splice(crossAt, 1);
  push(crossWeek, { kind: 'cross' });

  const earlyChosen = new Set(
    earlySlots
      .map((week, i) => ({ week, i }))
      .sort((a, b) => byes(a.week) - byes(b.week) || a.week - b.week)
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
  if (count('division', 0) !== legRounds || count('division', 1) !== legRounds || count('inter') !== interRounds) {
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
    doubleheaderStrength: 0.25,
    lateSeasonStrength: 0.25,
    homeAwayBalance: 0.15,
    ...weights,
  };
  const { byesFor, rating, doubleheaderWeeks, lateWeeks, franchiseIds, gamesPerTeam } = ctx;
  const dh = new Set(doubleheaderWeeks);
  const late = new Set(lateWeeks);

  let byeDiff = 0;
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

  const divisionPool = {};
  for (const [division, teams] of Object.entries(divisions)) {
    const base = roundRobinRounds(state.teamOrder[division]);
    divisionPool[division] = [
      state.legOrder[division][0].map((r) => base[r]),
      state.legOrder[division][1].map((r) => mirrorRound(base[r])),
    ];
  }
  const interPool = {};
  for (const [conference, [sideA, sideB]] of Object.entries(conferences)) {
    const base = bipartiteRounds(sideA, state.interOrder[conference]);
    interPool[conference] = state.interSlotOrder[conference].map((r) => base[r]);
    void sideB;
  }

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
        const i = cursor.inter;
        for (const conference of Object.keys(conferences)) games.push(...interPool[conference][i]);
        cursor.inter += 1;
      }
    }
    weeks.set(week, games);
  }
  return weeks;
};

const randomState = (ctx, rng) => {
  const state = { teamOrder: {}, legOrder: {}, interOrder: {}, interSlotOrder: {} };
  for (const [division, teams] of Object.entries(ctx.divisions)) {
    state.teamOrder[division] = shuffled(teams, rng);
    const idx = teams.slice(0, teams.length - 1).map((_, i) => i);
    state.legOrder[division] = [shuffled(idx, rng), shuffled(idx, rng)];
  }
  for (const [conference, [, sideB]] of Object.entries(ctx.conferences)) {
    state.interOrder[conference] = shuffled(sideB, rng);
    state.interSlotOrder[conference] = shuffled(
      sideB.map((_, i) => i),
      rng,
    );
  }
  return state;
};

const mutate = (state, ctx, rng) => {
  const next = {
    teamOrder: { ...state.teamOrder },
    legOrder: { ...state.legOrder },
    interOrder: { ...state.interOrder },
    interSlotOrder: { ...state.interSlotOrder },
  };
  const divisions = Object.keys(ctx.divisions);
  const conferences = Object.keys(ctx.conferences);
  const swap = (arr) => {
    const out = arr.slice();
    const i = Math.floor(rng() * out.length);
    let j = Math.floor(rng() * out.length);
    if (i === j) j = (j + 1) % out.length;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };
  const pick = rng();
  if (pick < 0.35) {
    const d = divisions[Math.floor(rng() * divisions.length)];
    next.teamOrder[d] = swap(state.teamOrder[d]);
  } else if (pick < 0.7) {
    const d = divisions[Math.floor(rng() * divisions.length)];
    const leg = rng() < 0.5 ? 0 : 1;
    const legs = state.legOrder[d].slice();
    legs[leg] = swap(legs[leg]);
    next.legOrder[d] = legs;
  } else if (pick < 0.85) {
    const c = conferences[Math.floor(rng() * conferences.length)];
    next.interOrder[c] = swap(state.interOrder[c]);
  } else {
    const c = conferences[Math.floor(rng() * conferences.length)];
    next.interSlotOrder[c] = swap(state.interSlotOrder[c]);
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
