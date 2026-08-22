/**
 * Constructive schedule builder — the "advanced" path, currently AFL only.
 *
 * WHY CONSTRUCT RATHER THAN RE-TIME
 *
 * scripts/optimize-league-schedule.mjs re-times an existing schedule by moving
 * whole rounds between weeks. That is safe and minimal, and it is also why its
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
 * Slot shape for a 14-week, 17-round AFL season. `kind` picks which pool a
 * round comes from; `leg` separates first from second meetings.
 */
export const AFL_WEEK_PLAN = [
  { week: 1, slots: [{ kind: 'cross' }, { kind: 'division', leg: 0 }] },
  { week: 2, slots: [{ kind: 'division', leg: 0 }, { kind: 'division', leg: 0 }] },
  { week: 3, slots: [{ kind: 'division', leg: 0 }] },
  { week: 4, slots: [{ kind: 'division', leg: 0 }] },
  { week: 5, slots: [{ kind: 'inter' }] },
  { week: 6, slots: [{ kind: 'inter' }] },
  { week: 7, slots: [{ kind: 'inter' }] },
  { week: 8, slots: [{ kind: 'inter' }] },
  { week: 9, slots: [{ kind: 'inter' }] },
  { week: 10, slots: [{ kind: 'division', leg: 1 }] },
  // Week 11 has six NFL teams on bye in 2026 — the heaviest week of the year.
  // It gets the one late interdivision round so no rivalry game lands there.
  { week: 11, slots: [{ kind: 'inter' }] },
  { week: 12, slots: [{ kind: 'division', leg: 1 }, { kind: 'division', leg: 1 }] },
  { week: 13, slots: [{ kind: 'division', leg: 1 }] },
  { week: 14, slots: [{ kind: 'division', leg: 1 }] },
];

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
