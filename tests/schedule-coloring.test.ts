/**
 * The edge-colouring search. One property matters more than all the others:
 * a Kempe swap must preserve a PROPER colouring. If it ever does not, the
 * planner emits a season where somebody plays twice in a round, and every
 * downstream check is measuring a schedule that cannot be played.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error - .mjs helpers shared with the node scripts
import {
  applyKempe,
  buildSlots,
  coloringFromWeeks,
  COLORING_WEIGHTS,
  kempeCycles,
  scoreColoring,
  searchColoring,
  weeksFromColoring,
} from '../src/utils/schedule-coloring.mjs';
// @ts-expect-error - .mjs helper shared with the node scripts
import { seasonShape, byeExposure } from '../src/utils/schedule-plan.mjs';
// @ts-expect-error - .mjs helper shared with the node scripts
import { regularSeasonGames } from '../src/utils/schedule-rules.mjs';
// @ts-expect-error - .mjs helper shared with the node scripts
import { HARD_MIN_REMATCH_GAP, MIN_REMATCH_GAP } from '../src/utils/schedule-builder.mjs';

const byes = require('../data/nfl/bye-weeks.json').seasons['2026'];

/** The live AFL 2026 season, decomposed into slots. A real, valid colouring. */
const load = () => {
  const read = (f: string) => require(`../data/afl-fantasy/mfl-feeds/2026/${f}.json`);
  const shape = seasonShape(read('league'));
  const weeks = regularSeasonGames(read('schedule')?.schedule?.weeklySchedule, shape.lastWeek);
  const doubleheaders = [...weeks.entries()]
    .filter(([, g]: any) => g.length > shape.franchiseIds.length / 2)
    .map(([w]: any) => w);
  const slots = buildSlots(shape.lastWeek, doubleheaders);
  return {
    shape,
    weeks,
    slots,
    doubleheaders,
    bySlot: coloringFromWeeks(weeks, slots),
    exposure: byeExposure(read('rosters'), read('players'), byes, shape.franchiseIds),
  };
};

/** Every franchise exactly once in every slot. */
const isProper = (bySlot: any[][], franchiseIds: string[]) =>
  bySlot.every((games) => {
    const seen = new Set<string>();
    for (const g of games) {
      if (seen.has(g.away) || seen.has(g.home)) return false;
      seen.add(g.away);
      seen.add(g.home);
    }
    return seen.size === franchiseIds.length;
  });

describe('coloringFromWeeks / weeksFromColoring', () => {
  it('decomposes a real season into proper slots and rebuilds it exactly', () => {
    const { bySlot, slots, shape, weeks } = load();
    expect(isProper(bySlot, shape.franchiseIds)).toBe(true);
    const rebuilt = weeksFromColoring(bySlot, slots);
    expect([...rebuilt.keys()]).toEqual([...weeks.keys()].sort((a: number, b: number) => a - b));
    for (const [w, games] of rebuilt) expect(games.length).toBe(weeks.get(w).length);
  });
});

describe('kempeCycles / applyKempe', () => {
  it('finds only even cycles longer than a single repeated pairing', () => {
    const { bySlot } = load();
    for (let i = 0; i < bySlot.length; i += 1) {
      for (let j = i + 1; j < bySlot.length; j += 1) {
        for (const c of kempeCycles(bySlot[i], bySlot[j])) {
          // Alternating means the two sides are equal in length, and a
          // 1-and-1 cycle is the same pair in both slots — a no-op, dropped.
          expect(c.a.length).toBe(c.b.length);
          expect(c.a.length + c.b.length).toBeGreaterThan(2);
        }
      }
    }
  });

  it('PRESERVES a proper colouring across every possible swap', () => {
    // The load-bearing invariant of the whole approach. Exhaustive over all
    // slot pairs and all their cycles on a real 17-slot, 204-game season.
    const { bySlot, shape } = load();
    let swaps = 0;
    for (let i = 0; i < bySlot.length; i += 1) {
      for (let j = i + 1; j < bySlot.length; j += 1) {
        for (const c of kempeCycles(bySlot[i], bySlot[j])) {
          const after = applyKempe(bySlot, i, j, c);
          swaps += 1;
          expect(isProper(after, shape.franchiseIds), `slots ${i}/${j}`).toBe(true);
          // Game count is conserved — nothing is dropped or duplicated.
          expect(after.flat().length).toBe(bySlot.flat().length);
        }
      }
    }
    expect(swaps).toBeGreaterThan(100);
  });

  it('conserves the exact multiset of games', () => {
    const { bySlot } = load();
    const key = (g: any) => `${g.away}-${g.home}`;
    const before = bySlot.flat().map(key).sort();
    const cycles = kempeCycles(bySlot[3], bySlot[4]);
    const after = applyKempe(bySlot, 3, 4, cycles[0]).flat().map(key).sort();
    expect(after).toEqual(before);
  });
});

describe('searchColoring', () => {
  const ctx = (l: ReturnType<typeof load>) => ({
    divisionOf: l.shape.divisionOf,
    byesFor: (id: string, week: number) => l.exposure[id]?.[week] ?? 0,
    rating: Object.fromEntries(l.shape.franchiseIds.map((id: string) => [id, 0])),
    franchiseIds: l.shape.franchiseIds,
    byeFreeWeeks: [1, 2, 3, 4, 12],
    lastWeek: l.shape.lastWeek,
    doubleheaderWeeks: l.doubleheaders,
    minRematchGap: MIN_REMATCH_GAP,
    hardMinRematchGap: HARD_MIN_REMATCH_GAP,
    frozenSlots: new Set<number>(),
  });

  it('never returns worse than the season it was seeded with', () => {
    // It keeps the best state ever seen, not the last. A season is a one-shot
    // artefact — ending on a worse draw than one already found would be
    // indefensible, and annealing accepts uphill moves by design.
    const l = load();
    const out = searchColoring(l.bySlot, l.slots, ctx(l), { iterations: 2000, restarts: 1 });
    expect(out.score.total).toBeLessThanOrEqual(out.seedScore.total);
  });

  it('returns a proper colouring', () => {
    const l = load();
    const out = searchColoring(l.bySlot, l.slots, ctx(l), { iterations: 3000, restarts: 1 });
    expect(isProper(out.bySlot, l.shape.franchiseIds)).toBe(true);
  });

  it('never trades the rematch gap below the hard floor', () => {
    const l = load();
    const out = searchColoring(l.bySlot, l.slots, ctx(l), { iterations: 5000, restarts: 1 });
    const weeks = weeksFromColoring(out.bySlot, l.slots);
    const met: Record<string, number[]> = {};
    for (const [week, games] of weeks) {
      for (const g of games as any[]) {
        if (l.shape.divisionOf[g.away] !== l.shape.divisionOf[g.home]) continue;
        (met[[g.away, g.home].sort().join('-')] ??= []).push(week);
      }
    }
    for (const [pair, ws] of Object.entries(met)) {
      if (ws.length < 2) continue;
      const sorted = [...ws].sort((a, b) => a - b);
      expect(sorted[1] - sorted[0], pair).toBeGreaterThanOrEqual(HARD_MIN_REMATCH_GAP);
    }
  });

  it('never regresses the top goal to buy the lesser ones', () => {
    // A plain weighted sum lets the five lower goals club together and pay for
    // a loss on the highest-weighted one — an AFL run pushed division games on
    // byes from 36 to 38 doing exactly that. The ranking gives flexibility on
    // the LESSER goals, so this one ratchets.
    const l = load();
    const c = ctx(l);
    const before = scoreColoring(l.bySlot, l.slots, c, COLORING_WEIGHTS());
    const out = searchColoring(l.bySlot, l.slots, c, { iterations: 6000, restarts: 1 });
    expect(out.score.terms.divisionByeFree).toBeLessThanOrEqual(before.terms.divisionByeFree + 1e-9);
  });

  it('never moves a constitutionally pinned round out of its week', () => {
    // The AFL's Week 1 cross-conference slot is the ONLY clean slot holding
    // non-division games, so it is the only place a rivalry game can move to,
    // and the optimiser found it immediately. The result scored beautifully
    // and was illegal. Frozen slots are the enforcement.
    const l = load();
    const crossSlots = new Set(
      l.bySlot
        .map((games: any[], i: number) => ({ i, games }))
        .filter(({ games }: any) =>
          games.some((g: any) => l.shape.conferenceOf[g.away] !== l.shape.conferenceOf[g.home]),
        )
        .map(({ i }: any) => i),
    );
    expect(crossSlots.size).toBeGreaterThan(0);
    const out = searchColoring(l.bySlot, l.slots, { ...ctx(l), frozenSlots: crossSlots }, {
      iterations: 6000,
      restarts: 1,
    });
    for (const i of crossSlots) {
      expect(JSON.stringify(out.bySlot[i]), `slot ${i} moved`).toBe(JSON.stringify(l.bySlot[i]));
    }
  });

  it('is deterministic — the reveal locks ONE schedule', () => {
    const l = load();
    const a = searchColoring(l.bySlot, l.slots, ctx(l), { iterations: 2000, restarts: 1, seed: 7 });
    const b = searchColoring(l.bySlot, l.slots, ctx(l), { iterations: 2000, restarts: 1, seed: 7 });
    expect(a.score.total).toBe(b.score.total);
    expect(JSON.stringify(a.bySlot)).toBe(JSON.stringify(b.bySlot));
  });
});

describe('COLORING_WEIGHTS', () => {
  it('comes from the published goal weights and sums to 1', () => {
    const w = COLORING_WEIGHTS();
    expect(Object.values(w).reduce((a: number, b: any) => a + b, 0)).toBeCloseTo(1, 10);
    // Ordering must match the published ranking, or the optimiser is chasing a
    // different priority list than the reveal page shows.
    expect(w.divisionByeFree).toBeGreaterThan(w.divisionByeCost);
    expect(w.divisionByeCost).toBeGreaterThan(w.rematchGap);
    expect(w.rematchGap).toBeGreaterThan(w.byeLuck);
    expect(w.byeLuck).toBeGreaterThan(w.opponentStrength);
    expect(w.opponentStrength).toBeGreaterThan(w.finale);
  });
});

describe('the division-spread goal', () => {
  // Local copy — the searchColoring block's `ctx` is scoped to that describe.
  const ctx = (l: ReturnType<typeof load>) => ({
    divisionOf: l.shape.divisionOf,
    byesFor: (id: string, week: number) => l.exposure[id]?.[week] ?? 0,
    rating: Object.fromEntries(l.shape.franchiseIds.map((id: string) => [id, 0])),
    franchiseIds: l.shape.franchiseIds,
    byeFreeWeeks: [1, 2, 3, 4, 12],
    lastWeek: l.shape.lastWeek,
    doubleheaderWeeks: l.doubleheaders,
    minRematchGap: MIN_REMATCH_GAP,
    hardMinRematchGap: HARD_MIN_REMATCH_GAP,
    frozenSlots: new Set<number>(),
  });

  /**
   * This goal exists because of a specific failure. Told only to keep division
   * games off bye weeks, the optimiser put all 48 of The League's into Weeks
   * 1-4 and 12 and left Weeks 5-11, 13 and 14 without a single one — perfect on
   * the goal above it, and a division race decided by Week 4. The structured
   * builder had prevented that for free with its two-leg block, so nobody had
   * ever had to write it down.
   */
  it('scores a September pile-up worse than an even split', () => {
    const l = load();
    const c = ctx(l);
    const w = COLORING_WEIGHTS();
    const even = scoreColoring(l.bySlot, l.slots, c, w);
    // The live season is spread by construction, so it should score ~0 here.
    expect(even.terms.divisionSpread).toBeLessThan(0.1);

    // Force every division game into the first half and confirm the term reacts.
    const front = l.bySlot.map((games: any[], i: number) =>
      l.slots[i].week > l.shape.lastWeek / 2
        ? games.filter((g: any) => l.shape.divisionOf[g.away] !== l.shape.divisionOf[g.home])
        : games,
    );
    expect(scoreColoring(front, l.slots, c, w).terms.divisionSpread).toBeGreaterThan(0.5);
  });

  it('lets bye-freeness regress ONLY when spread is bought with it', () => {
    // The two top goals genuinely trade — bye-free weeks cluster early, so a
    // schedule can be clean or spread but rarely both. A hard ratchet on
    // bye-freeness would let it win every time and hand back the pile-up.
    const w = COLORING_WEIGHTS();
    expect(w.divisionByeFree).toBeGreaterThan(w.divisionSpread);
    expect(w.divisionSpread).toBeGreaterThan(w.divisionByeCost);
  });
});
