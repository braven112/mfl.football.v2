/**
 * Edge-colouring schedule search — the mode that can put two teams' division
 * games in different weeks.
 *
 * WHAT THE STRUCTURED BUILDER CANNOT DO
 *
 * `schedule-builder.mjs` composes a season from structured pieces: a
 * circle-method round-robin inside each division, complete-bipartite between
 * divisions. Those constructions can only emit PURE rounds — all-division or
 * all-interdivision — so every franchise plays a division game in exactly the
 * same weeks as every other. 13 of 14 AFL weeks in 2026 are single-type. That
 * is not a rule anyone wrote; it is a side effect of how the rounds are built.
 *
 * A perfect matching does not have to be pure. `{n1-n2, n3-n4, s1-s2, s5-s6,
 * n5-s3, n6-s4}` is a legal round with two North internal games, two South
 * internal and two cross-division: some teams play a rival that week, others do
 * not. Reaching those rounds means giving up the constructions and searching
 * the colourings directly.
 *
 * THE MODEL
 *
 * A season is a multigraph — franchises are vertices, required games are edges.
 * Assigning games to rounds is EDGE COLOURING: a proper colouring (no two edges
 * at a vertex sharing a colour) is exactly "nobody plays twice in a round".
 * Colours here are SLOTS, and each slot belongs to a week; a doubleheader week
 * owns two slots, which is how a franchise legitimately plays twice that week.
 *
 * WHY IT IS SEEDED FROM THE STRUCTURED BUILDER
 *
 * Not for a head start — for feasibility. A Δ-regular multigraph is not always
 * Δ-edge-colourable (the Petersen graph is the standard counterexample), so
 * there is no guarantee a random start can be repaired into a legal season. The
 * structured builder's output IS a proper colouring, which proves one exists,
 * and every move below preserves properness. The search therefore cannot fail;
 * the worst case is that it returns what it started with.
 *
 * THE MOVE
 *
 * Kempe chains. Take two slots: every franchise has degree exactly 2 in the
 * union of their matchings, so the union is a disjoint set of even cycles. Swap
 * the colours along any one cycle and both slots are still perfect matchings.
 * That is the entire neighbourhood, and it is enough — any colouring is
 * reachable from any other by a sequence of them in practice.
 *
 * WHAT IT COSTS
 *
 * The structured builder guarantees the drama goals for free: legs in disjoint
 * blocks means a rematch gap, a late block means a stretch run. A free
 * colouring guarantees NONE of them, so every goal that was structural has to
 * become a scored term. That is the trade, and it is why `scoreColoring` scores
 * the whole published goal list rather than the fairness subset `scoreSeason`
 * carries.
 */
import { pairKey } from './schedule-rules.mjs';
import { goalWeight } from './schedule-constraints.mjs';

/* ------------------------------------------------------------------ slots */

/**
 * One slot per round, tagged with the week it is played in. A doubleheader week
 * contributes two, which is the only way a franchise plays twice in a week.
 */
export const buildSlots = (lastWeek, doubleheaderWeeks) => {
  const dh = new Set(doubleheaderWeeks);
  const slots = [];
  for (let week = 1; week <= lastWeek; week += 1) {
    slots.push({ week });
    if (dh.has(week)) slots.push({ week });
  }
  return slots;
};

/** A `Map<week, games[]>` season -> one game list per slot, in week order. */
export const coloringFromWeeks = (weeks, slots) => {
  const bySlot = slots.map(() => []);
  const nextFor = {};
  for (const week of [...weeks.keys()].sort((a, b) => a - b)) {
    const indices = slots.map((s, i) => (s.week === week ? i : -1)).filter((i) => i >= 0);
    const games = weeks.get(week);
    if (!indices.length) throw new Error(`no slot for week ${week}`);
    // A week's games split evenly across its slots: with two slots every
    // franchise appears once in each half, which is what the source season
    // already guarantees.
    const perSlot = games.length / indices.length;
    nextFor[week] = 0;
    for (let k = 0; k < indices.length; k += 1) {
      bySlot[indices[k]] = games.slice(k * perSlot, (k + 1) * perSlot);
    }
  }
  return bySlot;
};

/** Slot lists -> the `Map<week, games[]>` the rest of the planner speaks. */
export const weeksFromColoring = (bySlot, slots) => {
  const weeks = new Map();
  bySlot.forEach((games, i) => {
    const week = slots[i].week;
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(...games);
  });
  return new Map([...weeks].sort((a, b) => a[0] - b[0]));
};

/* ------------------------------------------------------------- the move */

/**
 * Connected components of the union of two slots' matchings, as cycles of games.
 *
 * Every franchise has exactly one game in each slot, so degree 2 in the union
 * and every component is an even cycle. A component of length 2 is the same
 * pair meeting in both slots; swapping it changes nothing, so it is dropped.
 */
export const kempeCycles = (gamesA, gamesB) => {
  const partnerA = new Map();
  const partnerB = new Map();
  const gameA = new Map();
  const gameB = new Map();
  for (const g of gamesA) {
    partnerA.set(g.away, g.home);
    partnerA.set(g.home, g.away);
    gameA.set(g.away, g);
    gameA.set(g.home, g);
  }
  for (const g of gamesB) {
    partnerB.set(g.away, g.home);
    partnerB.set(g.home, g.away);
    gameB.set(g.away, g);
    gameB.set(g.home, g);
  }

  const seen = new Set();
  const cycles = [];
  for (const start of partnerA.keys()) {
    if (seen.has(start)) continue;
    const inA = [];
    const inB = [];
    let node = start;
    let useA = true;
    // Alternate A-edge, B-edge until we come back to where we started.
    for (let guard = 0; guard < partnerA.size * 2 + 2; guard += 1) {
      seen.add(node);
      const next = useA ? partnerA.get(node) : partnerB.get(node);
      if (next == null) break;
      (useA ? inA : inB).push(useA ? gameA.get(node) : gameB.get(node));
      node = next;
      useA = !useA;
      if (node === start && useA) break;
    }
    const uniqueA = [...new Set(inA)];
    const uniqueB = [...new Set(inB)];
    if (uniqueA.length + uniqueB.length > 2) cycles.push({ a: uniqueA, b: uniqueB });
  }
  return cycles;
};

/** Swap one cycle's games between two slots. Returns fresh arrays. */
export const applyKempe = (bySlot, i, j, cycle) => {
  const out = bySlot.slice();
  const moveA = new Set(cycle.a);
  const moveB = new Set(cycle.b);
  out[i] = [...bySlot[i].filter((g) => !moveA.has(g)), ...cycle.b];
  out[j] = [...bySlot[j].filter((g) => !moveB.has(g)), ...cycle.a];
  return out;
};

/* -------------------------------------------------------------- objective */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const variance = (xs) => {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
};

/**
 * Weights come from the published goal list, normalised to sum to 1, so the
 * optimiser is literally chasing the scorecard. The structured builder's
 * `scoreSeason` carries five hand-tuned fairness terms and leaves the rest to
 * structure; here nothing is structural, so every tradeable goal needs a term
 * and its published weight is the only defensible number to use.
 *
 * `home-away` is absent on purpose: which side is home constrains nothing else,
 * so `balanceHomeAway` fixes it exactly afterwards rather than the search
 * spending iterations on it.
 */
export const COLORING_WEIGHTS = () => {
  const raw = {
    divisionByeFree: goalWeight('division-bye-free-ceiling'),
    divisionByeCost: goalWeight('light-bye-weeks'),
    rematchGap: goalWeight('rematch-gap'),
    byeLuck: goalWeight('bye-luck'),
    opponentStrength: goalWeight('opponent-strength'),
    finale: goalWeight('worst-week-and-finale'),
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total]));
};

/**
 * Score a colouring. LOWER IS BETTER, and every term is scaled to roughly 0..1
 * before weighting so the published weights mean what they say.
 *
 * @param {object[][]} bySlot
 * @param {{week:number}[]} slots
 * @param {object} ctx
 */
export const scoreColoring = (bySlot, slots, ctx, weights) => {
  const {
    divisionOf, byesFor, rating, franchiseIds, byeFreeWeeks: clean,
    lastWeek, doubleheaderWeeks, minRematchGap,
  } = ctx;
  const w = weights ?? COLORING_WEIGHTS();
  const cleanSet = new Set(clean);
  const dh = new Set(doubleheaderWeeks);
  const late = new Set([lastWeek - 2, lastWeek - 1, lastWeek]);

  let divisionGames = 0;
  let divisionOnBye = 0;
  let divisionStarterByes = 0;
  let byeDiff = 0;
  let games = 0;
  let finaleNonDivision = 0;
  let finaleGames = 0;

  const net = {};
  const dhStrength = {};
  const lateStrength = {};
  for (const id of franchiseIds) {
    net[id] = 0;
    dhStrength[id] = 0;
    lateStrength[id] = 0;
  }
  const met = {};

  bySlot.forEach((slotGames, i) => {
    const week = slots[i].week;
    for (const g of slotGames) {
      games += 1;
      const ba = byesFor(g.away, week);
      const bb = byesFor(g.home, week);
      byeDiff += Math.abs(ba - bb);
      net[g.away] += bb - ba;
      net[g.home] += ba - bb;
      if (dh.has(week)) {
        dhStrength[g.away] += rating[g.home] ?? 0;
        dhStrength[g.home] += rating[g.away] ?? 0;
      }
      if (late.has(week)) {
        lateStrength[g.away] += rating[g.home] ?? 0;
        lateStrength[g.home] += rating[g.away] ?? 0;
      }
      if (week === lastWeek) {
        finaleGames += 1;
        if (divisionOf[g.away] !== divisionOf[g.home]) finaleNonDivision += 1;
      }
      if (divisionOf[g.away] === divisionOf[g.home]) {
        divisionGames += 1;
        if (!cleanSet.has(week)) divisionOnBye += 1;
        divisionStarterByes += ba + bb;
        (met[pairKey(g.away, g.home)] ??= []).push(week);
      }
    }
  });

  // Rivals meeting too close together. Charged QUADRATICALLY in the shortfall:
  // a flat or linear penalty leaves the search indifferent between a
  // three-week gap and a one-week one, and the first run of this optimiser
  // duly traded the gap down to two weeks to buy bye-week gains. Squaring it
  // means a small encroachment is cheap and a big one is not.
  //
  // `hardMinGap` is a separate, absolute floor enforced as a move filter, not
  // a price. The league demoted the three-week rule from inviolable to ideal,
  // which permits trading it — it does not permit rivals playing back-to-back.
  let rematchPenalty = 0;
  let repeats = 0;
  let worstGap = Infinity;
  for (const weeks of Object.values(met)) {
    if (weeks.length < 2) continue;
    const sorted = [...weeks].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k += 1) {
      repeats += 1;
      const gap = sorted[k] - sorted[k - 1];
      worstGap = Math.min(worstGap, gap);
      const short = Math.max(0, minRematchGap - gap);
      rematchPenalty += (short / minRematchGap) ** 2;
    }
  }

  const netValues = franchiseIds.map((id) => net[id]);
  const terms = {
    divisionByeFree: divisionGames ? divisionOnBye / divisionGames : 0,
    // Two starters missing from a rivalry game is the reference point for "bad".
    divisionByeCost: divisionGames ? Math.min(1, divisionStarterByes / (divisionGames * 2)) : 0,
    rematchGap: repeats ? rematchPenalty / repeats : 0,
    byeLuck:
      (games ? Math.min(1, byeDiff / games / 3) : 0) * 0.6 +
      Math.min(1, (Math.max(...netValues, 0) - Math.min(...netValues, 0)) / 12) * 0.4,
    opponentStrength: Math.min(1, (Math.sqrt(variance(franchiseIds.map((id) => dhStrength[id]))) +
      Math.sqrt(variance(franchiseIds.map((id) => lateStrength[id])))) / 4),
    finale: finaleGames ? finaleNonDivision / finaleGames : 0,
  };
  const total = Object.entries(terms).reduce((sum, [k, v]) => sum + (w[k] ?? 0) * v, 0);
  return { total, terms, minRematchGap: repeats ? worstGap : Infinity };
};

/* ---------------------------------------------------------------- search */

/** Deterministic RNG — the reveal locks ONE schedule, so nothing may sample. */
const makeRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/**
 * Anneal a colouring with Kempe swaps, starting from a known-good one.
 *
 * Returns the BEST state ever seen, not the last — annealing accepts uphill
 * moves and a season is a one-shot artefact, so ending on a worse draw than one
 * already found would be indefensible. It therefore cannot do worse than the
 * seed it was handed.
 */
export const searchColoring = (seedBySlot, slots, ctx, { seed = 20260824, iterations = 20000, restarts = 3 } = {}) => {
  const weights = COLORING_WEIGHTS();
  const seedScore = scoreColoring(seedBySlot, slots, ctx, weights);
  let best = { bySlot: seedBySlot, score: seedScore };

  for (let r = 0; r < restarts; r += 1) {
    const rng = makeRng(seed + r * 7919);
    let current = seedBySlot;
    let score = seedScore;
    for (let i = 0; i < iterations; i += 1) {
      const a = Math.floor(rng() * slots.length);
      let b = Math.floor(rng() * slots.length);
      if (a === b) b = (b + 1) % slots.length;
      const cycles = kempeCycles(current[a], current[b]);
      if (!cycles.length) continue;
      const cycle = cycles[Math.floor(rng() * cycles.length)];
      const candidate = applyKempe(current, a, b, cycle);
      const candidateScore = scoreColoring(candidate, slots, ctx, weights);
      // Absolute floor, never a price. Demoting the three-week rule to a goal
      // lets the optimiser trade it; it does not license a one-week rematch.
      if (candidateScore.minRematchGap < (ctx.hardMinRematchGap ?? 3)) continue;
      const delta = candidateScore.total - score.total;
      const temperature = 1 - i / iterations;
      if (delta < 0 || rng() < Math.exp(-delta / Math.max(1e-9, 0.02 * temperature))) {
        current = candidate;
        score = candidateScore;
        if (score.total < best.score.total) best = { bySlot: current, score };
      }
    }
  }
  return { ...best, seedScore };
};
