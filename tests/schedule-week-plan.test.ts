import { describe, it, expect } from 'vitest';
// @ts-expect-error - .mjs helper shared with the node scripts (see its header)
import {
  buildWeekPlan,
  roundRobinRounds,
  bipartiteRounds,
  balanceHomeAway,
  LIGHT_BYE_WEEK_MAX,
  MIN_REMATCH_GAP,
} from '../src/utils/schedule-builder.mjs';
// @ts-expect-error - .mjs helper shared with the node scripts (see its header)
import { byeCountsByWeek, byeFreeWeeks, chooseDoubleheaderWeeks } from '../src/utils/schedule-rules.mjs';
import byeData from '../data/nfl/bye-weeks.json';

/**
 * `buildWeekPlan` shipped hard-coded once: doubleheaders pinned to Weeks 1, 2
 * and 12 because that is where they belong in 2026. The bye calendar moves —
 * 2024 and 2025's clean late week is 13, not 12 — so the pinned plan
 * contradicted the doubleheader weeks the planner derived, and every franchise
 * ended up with the wrong number of games in the late doubleheader week.
 *
 * These tests exist so that cannot come back. The load-bearing property is not
 * "the plan looks like 2026" — it is that the plan is DERIVED from whichever
 * weeks are clean that season.
 */
const SEASONS = Object.keys((byeData as any).seasons);

const planFor = (
  year: string,
  { lastWeek = 14, divisionSize = 6, conferenceSize = 12, doubleheaderCount = 3, crossWeek = 1 } = {},
) => {
  const byes = (byeData as any).seasons[year];
  const clean = byeFreeWeeks(byes, lastWeek);
  const doubleheaders = chooseDoubleheaderWeeks({
    count: doubleheaderCount,
    byeFree: clean,
    startWindow: [1, 2, 3, 4],
    endWindow: [lastWeek - 2, lastWeek - 1, lastWeek],
    // Mirrors planSchedule. Week 1 holds the cross-conference round, so it
    // must carry two rounds whether or not it is bye-free — 2017 put a bye in
    // Week 1 and this helper, which used to omit `required`, threw on it while
    // the real planner scheduled the season. A test helper that calls the code
    // differently from production tests something production never does.
    required: crossWeek ? [crossWeek] : [],
    byeCounts: byeCountsByWeek(byes),
    lastWeek,
  });
  return {
    doubleheaders,
    clean,
    byeCounts: byeCountsByWeek(byes),
    plan: buildWeekPlan({
      lastWeek,
      doubleheaders,
      byeCounts: byeCountsByWeek(byes),
      divisionSize,
      conferenceSize,
      crossWeek,
    }),
  };
};

describe('buildWeekPlan', () => {
  for (const year of SEASONS) {
    describe(`${year}`, () => {
      const { plan, doubleheaders, clean, byeCounts } = planFor(year);
      const slots = plan.flatMap((w: any) => w.slots);
      const kind = (k: string, leg?: number) =>
        slots.filter((s: any) => s.kind === k && (leg === undefined || s.leg === leg));

      it('produces exactly the round set the format requires', () => {
        expect(kind('cross')).toHaveLength(1);
        expect(kind('division', 0)).toHaveLength(5);
        expect(kind('division', 1)).toHaveLength(5);
        expect(kind('inter')).toHaveLength(6);
      });

      it('gives every week the number of slots its doubleheader status implies', () => {
        for (const { week, slots: s } of plan) {
          expect(s.length, `week ${week}`).toBe(doubleheaders.includes(week) ? 2 : 1);
        }
      });

      it('puts the cross-conference round in Week 1 alongside a division round', () => {
        const week1 = plan.find((w: any) => w.week === 1)!;
        expect(week1.slots.map((s: any) => s.kind).sort()).toEqual(['cross', 'division']);
      });

      it('separates the two legs so rivals meet once early and once late', () => {
        const legWeeks = (leg: number) =>
          plan.filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === leg)).map((w: any) => w.week);
        const early = legWeeks(0);
        const late = legWeeks(1);
        expect(Math.max(...early)).toBeLessThan(Math.min(...late));
        // Every pair therefore meets at least this far apart.
        expect(Math.min(...late) - Math.max(...early)).toBeGreaterThan(3);
      });

      // The rivalry finale yields to fairness, and only to fairness. In 2022 the
      // final week had SIX NFL teams out — the worst of that season — so the
      // interdivision round goes there and the season ends on non-division
      // games. That is the league's stated precedence (fairness first), not a
      // bug, but it is a visible change to how the season feels, so it is
      // asserted rather than left to chance.
      it('ends the season on division games unless the finale is the worst bye week', () => {
        const finale = plan.at(-1)!;
        const allDivision = finale.slots.every((s: any) => s.kind === 'division');
        if (allDivision) return;
        const worst = Math.max(
          ...plan.map((w: any) => byeCounts[w.week] ?? 0),
        );
        expect(
          byeCounts[finale.week] ?? 0,
          `Week ${finale.week} is not all-division but is not the worst bye week either`,
        ).toBe(worst);
      });

    // A bye-free week in the MIDDLE of the season may still get an
    // interdivision round: confining the two legs to an early and a late block
    // is what guarantees rivals meet once early and once late, so a clean week
    // inside neither block is unreachable.
    //
    // This comment used to name 2023's and 2024's clean Week 8 as the example.
    // It was wrong about why — those weeks were unreachable because the late
    // block was the shortest suffix, not because the format forbade them, and
    // widening the block to the rematch bound now reaches both (see
    // 'gives forced bye-week division rounds the lightest weeks the gap rule
    // allows'). Kept as the weaker, always-true property; the optimality test
    // below is the one with teeth.
    it('within each block, division rounds take the cleanest weeks', () => {
      for (const leg of [0, 1]) {
        const blockWeeks = plan
          .filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === leg))
          .map((w: any) => w.week);
        const lo = Math.min(...blockWeeks);
        const hi = Math.max(...blockWeeks);
        const block = plan.filter((w: any) => w.week >= lo && w.week <= hi);
        const divisionByes = block
          .filter((w: any) => w.slots.some((s: any) => s.kind === 'division'))
          .map((w: any) => byeCounts[w.week] ?? 0);
        const interByes = block
          .filter((w: any) => w.slots.some((s: any) => s.kind === 'inter'))
          .map((w: any) => byeCounts[w.week] ?? 0);
        if (!interByes.length) continue;
        expect(
          Math.min(...interByes),
          `leg ${leg}: an interdivision round sits in a cleaner week than a division round`,
        ).toBeGreaterThanOrEqual(Math.max(...divisionByes));
      }
    });

      // Not "every clean slot is a division round" — the spread rule
      // deliberately leaves a clean week's SECOND slot to interdivision so
      // rivalry rounds land in distinct weeks, which costs nothing because the
      // COUNT is what matters. This asserts that count is maximal: as many
      // division rounds sit in bye-free weeks as the block has clean slots.
      it('places as many division rounds in bye-free weeks as each block can hold', () => {
        for (const leg of [0, 1]) {
          const blockWeeks = plan
            .filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === leg))
            .map((w: any) => w.week);
          const lo = Math.min(...blockWeeks);
          const hi = Math.max(...blockWeeks);
          const block = plan.filter((w: any) => w.week >= lo && w.week <= hi);
          const blockSlots = block.flatMap((w: any) => w.slots.map(() => w.week));
          // Clean slots the DIVISION rounds can actually reach — the
          // cross-conference round is pinned to Week 1 by the constitution, so
          // a clean slot it occupies was never available to them.
          //
          // Missing that reservation is why this assertion passed for years:
          // every calendar it had seen (2022-2026) was bye-free through Week 4,
          // so the early block never had to reach a bye week and the
          // subtraction never mattered. Backfilling 2011-2021 brought in the
          // opposite shape — byes starting in Week 4 — where the block runs
          // Weeks 1-4 and the fifth rivalry round has nowhere clean left.
          const crossCleanSlots = block.reduce(
            (n: number, w: any) =>
              n + ((byeCounts[w.week] ?? 0) === 0 ? w.slots.filter((sl: any) => sl.kind === 'cross').length : 0),
            0,
          );
          const cleanSlots =
            blockSlots.filter((w: number) => (byeCounts[w] ?? 0) === 0).length - crossCleanSlots;
          const rounds = block.reduce(
            (n: number, w: any) => n + w.slots.filter((sl: any) => sl.kind === 'division' && sl.leg === leg).length,
            0,
          );
          const placedClean = block.reduce(
            (n: number, w: any) =>
              n +
              ((byeCounts[w.week] ?? 0) === 0
                ? w.slots.filter((sl: any) => sl.kind === 'division' && sl.leg === leg).length
                : 0),
            0,
          );
          expect(placedClean, `leg ${leg}: ${placedClean} bye-free of ${rounds}, block has ${cleanSlots} clean slots`).toBe(
            Math.min(rounds, cleanSlots),
          );
        }
      });

      /**
       * The forced bye-week division rounds must take the LIGHTEST bye weeks
       * the rematch rule lets them reach.
       *
       * This is the property the shortest-suffix late block used to violate
       * silently. In 2026 the AFL's three unavoidable bye-week rounds sat on
       * Weeks 10, 13 and 14 — ten NFL teams out — while Week 9, with two out,
       * was one week past the block's edge and never considered. Nothing
       * failed, because "within a block, division rounds take the cleanest
       * weeks" was true: the block was simply too narrow to contain the answer.
       *
       * So this asserts against the weeks the gap rule ALLOWS, not the weeks
       * the block happens to span. Compared at week granularity rather than
       * slot: a doubleheader's second clean slot deliberately goes to
       * interdivision (the spread rule), so a per-slot comparison would fail on
       * a rule that is working correctly.
       */
      it('gives forced bye-week division rounds the lightest weeks the gap rule allows', () => {
        const weeksWithLeg = (leg: number) =>
          plan.filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === leg)).map((w: any) => w.week);
        const earliestLate = Math.max(...weeksWithLeg(0)) + MIN_REMATCH_GAP;
        const used = new Set(weeksWithLeg(1));
        const reachable = plan.filter((w: any) => w.week >= earliestLate).map((w: any) => w.week);
        const bye = (w: number) => byeCounts[w] ?? 0;

        const heaviestUsed = Math.max(...[...used].map(bye));
        const unused = reachable.filter((w: number) => !used.has(w));
        if (!unused.length) return;
        expect(
          Math.min(...unused.map(bye)),
          `a reachable week is lighter than a week the second leg took — used ` +
            `${[...used].map((w) => `${w}:${bye(w)}`).join(' ')} / free ${unused.map((w) => `${w}:${bye(w)}`).join(' ')}`,
        ).toBeGreaterThanOrEqual(heaviestUsed);
      });

      /**
       * The widening is bounded by the rematch rule and by nothing else. Too
       * narrow and light weeks stay unreachable (the bug above); one week too
       * wide and a pair can be drawn into Weeks 4 and 5, which `scoreSeason`
       * has no term to prevent and only the season audit would catch.
       */
      it('starts the second leg exactly MIN_REMATCH_GAP after the first leg ends, at the earliest', () => {
        const early = plan.filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === 0)).map((w: any) => w.week);
        const late = plan.filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === 1)).map((w: any) => w.week);
        expect(Math.min(...late) - Math.max(...early)).toBeGreaterThanOrEqual(MIN_REMATCH_GAP);
      });

      /**
       * Reported, not asserted: whether the target was actually met. Some
       * seasons have fewer light weeks than the format has forced rounds, and
       * the rematch guarantee can put one out of reach — neither is a bug, and
       * failing the build on the NFL's bye calendar would be absurd. The test
       * above is the real guarantee; this one keeps the shortfall visible.
       */
      it('reports how many forced bye-week division rounds cleared the light-week bar', () => {
        const onBye = plan
          .filter((w: any) => w.slots.some((s: any) => s.kind === 'division'))
          .map((w: any) => w.week)
          .filter((w: number) => (byeCounts[w] ?? 0) > 0);
        const heavy = onBye.filter((w: number) => (byeCounts[w] ?? 0) > LIGHT_BYE_WEEK_MAX);
        if (heavy.length) {
          console.log(
            `  [${year}] ${onBye.length - heavy.length}/${onBye.length} forced bye-week division rounds on light ` +
              `(<=${LIGHT_BYE_WEEK_MAX}) weeks; heavier: ${heavy.map((w: number) => `wk${w}:${byeCounts[w]}`).join(' ')}`,
          );
        }
        expect(onBye.every((w: number) => (byeCounts[w] ?? 0) > 0)).toBe(true);
      });

      /**
       * ...unless the format leaves nothing to swap in. 2014's worst bye week
       * is Week 4, six teams out, and Weeks 1-4 are exactly the span the first
       * leg needs for its five rivalry rounds plus the cross-conference round —
       * six slots, six rounds, no interdivision round anywhere in the block to
       * trade for it.
       *
       * The unconditional version of this assertion passed only because every
       * calendar it had seen was bye-free through Week 4. It was asserting a
       * property of 2022-2026, not of the scheduler.
       */
      it('keeps rivalry games out of the season’s worst bye week when it has anything to swap', () => {
        const worst = Object.entries(byeCounts)
          .map(([w, n]) => ({ week: Number(w), n: Number(n) }))
          .filter((r) => r.week <= 14)
          .sort((a, b) => b.n - a.n)[0];
        const row = plan.find((w: any) => w.week === worst.week)!;
        if (row.slots.every((s: any) => s.kind === 'inter')) return;

        // It carries a division round, so prove nothing could have taken its
        // place: the block that week belongs to must be fully spoken for.
        const leg = row.slots.find((s: any) => s.kind === 'division')?.leg;
        const blockWeeks = plan
          .filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === leg))
          .map((w: any) => w.week);
        const block = plan.filter(
          (w: any) => w.week >= Math.min(...blockWeeks) && w.week <= Math.max(...blockWeeks),
        );
        const spare = block.reduce(
          (n: number, w: any) => n + w.slots.filter((s: any) => s.kind === 'inter').length,
          0,
        );
        expect(
          spare,
          `week ${worst.week} has ${worst.n} NFL teams out and carries a division round, ` +
            `but its block has ${spare} interdivision round(s) that could have taken it`,
        ).toBe(0);
      });
    });
  }

  it('refuses a week/doubleheader combination the format cannot fill', () => {
    expect(() =>
      buildWeekPlan({
        lastWeek: 14,
        doubleheaders: [1, 2],
        byeCounts: {},
        divisionSize: 6,
        conferenceSize: 12,
        crossWeek: 1,
      }),
    ).toThrow(/needs 17/);
  });

  it('refuses to put the cross-conference round in a single-game week', () => {
    expect(() =>
      buildWeekPlan({
        lastWeek: 14,
        doubleheaders: [2, 3, 12],
        byeCounts: {},
        divisionSize: 6,
        conferenceSize: 12,
        crossWeek: 1,
      }),
    ).toThrow(/must be a doubleheader/);
  });
});

describe('buildWeekPlan for a conference-less league (The League: 16 teams, 4x4)', () => {
  const byes = (byeData as any).seasons['2026'];
  const plan = buildWeekPlan({
    lastWeek: 14,
    doubleheaders: [1, 2, 3, 12],
    byeCounts: byeCountsByWeek(byes),
    divisionSize: 4,
    conferenceSize: 16,
    crossWeek: null,
  });
  const slots = plan.flatMap((w: any) => w.slots);

  it('needs no cross-conference round and plays every other division', () => {
    expect(slots.filter((s: any) => s.kind === 'cross')).toHaveLength(0);
    expect(slots.filter((s: any) => s.kind === 'division' && s.leg === 0)).toHaveLength(3);
    expect(slots.filter((s: any) => s.kind === 'division' && s.leg === 1)).toHaveLength(3);
    expect(slots.filter((s: any) => s.kind === 'inter')).toHaveLength(12);
  });

  // The League has bye-free slots for every division game (ceiling 48 of 48),
  // so its bye-week rounds are BOUGHT, not forced — the all-division finale in
  // a year when Weeks 13 and 14 both carry byes. The light-week rule still
  // governs which bye week that finale lands on.
  it('puts its bye-week division rounds on the lightest weeks the gap rule allows', () => {
    const byeCounts = byeCountsByWeek(byes);
    const weeksWithLeg = (leg: number) =>
      plan.filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === leg)).map((w: any) => w.week);
    const used = new Set(weeksWithLeg(1));
    const earliestLate = Math.max(...weeksWithLeg(0)) + MIN_REMATCH_GAP;
    const bye = (w: number) => byeCounts[w] ?? 0;
    const unused = plan.map((w: any) => w.week).filter((w: number) => w >= earliestLate && !used.has(w));
    expect(Math.min(...unused.map(bye))).toBeGreaterThanOrEqual(Math.max(...[...used].map(bye)));
    // 2026 concretely: the finale is Week 14, two NFL teams out (ARI, DAL) —
    // the lightest non-zero week on the calendar.
    expect(bye(14)).toBeLessThanOrEqual(LIGHT_BYE_WEEK_MAX);
    expect(used.has(14)).toBe(true);
  });

  it('spreads the first leg across distinct weeks instead of stacking Week 1', () => {
    const earlyWeeks = plan
      .filter((w: any) => w.slots.some((s: any) => s.kind === 'division' && s.leg === 0))
      .map((w: any) => w.week);
    // The minimum prefix holding 3 rounds is Weeks 1-2, which would put two
    // rivalry rounds in Week 1 — a third of the division schedule in the
    // highest-variance week of the year. The block extends over clean weeks so
    // each gets one instead.
    expect(new Set(earlyWeeks).size).toBe(3);
    for (const week of earlyWeeks) {
      expect(plan.find((w: any) => w.week === week)!.slots.filter((s: any) => s.kind === 'division')).toHaveLength(1);
    }
  });
});

describe('round constructions', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('round-robin plays every pair exactly once across n-1 rounds', () => {
    const rounds = roundRobinRounds(six);
    expect(rounds).toHaveLength(5);
    const seen = new Set<string>();
    for (const round of rounds) {
      expect(round).toHaveLength(3);
      const teams = round.flatMap((g: any) => [g.away, g.home]);
      expect(new Set(teams).size, 'a franchise appears twice in one round').toBe(6);
      for (const g of round) seen.add([g.away, g.home].sort().join('-'));
    }
    expect(seen.size).toBe(15); // C(6,2)
  });

  it('bipartite rounds pair every a with every b exactly once', () => {
    const rounds = bipartiteRounds(six, ['u', 'v', 'w', 'x', 'y', 'z']);
    expect(rounds).toHaveLength(6);
    const seen = new Set<string>();
    for (const round of rounds) {
      expect(new Set(round.flatMap((g: any) => [g.away, g.home])).size).toBe(12);
      for (const g of round) seen.add(`${g.away}-${g.home}`);
    }
    expect(seen.size).toBe(36);
  });

  it('balances home games to within one of half, from a lopsided start', () => {
    // bipartiteRounds puts one whole side on the road every round — exactly the
    // skew the post-pass exists to undo.
    const weeks = new Map(bipartiteRounds(six, ['u', 'v', 'w', 'x', 'y', 'z']).map((r: any, i: number) => [i + 1, r]));
    const ids = [...six, 'u', 'v', 'w', 'x', 'y', 'z'];
    const homeCounts = () => {
      const n: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
      for (const games of weeks.values()) for (const g of games as any[]) n[g.home] += 1;
      return Object.values(n);
    };
    expect(Math.max(...homeCounts()) - Math.min(...homeCounts())).toBe(6); // fully lopsided
    balanceHomeAway(weeks, ids, 6);
    expect(Math.max(...homeCounts()) - Math.min(...homeCounts())).toBeLessThanOrEqual(1);
  });
});
