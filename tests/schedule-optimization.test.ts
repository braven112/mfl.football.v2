import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error - .mjs helper shared with the node scripts (see its header)
import {
  byeCountsByWeek,
  byeFreeWeeks,
  buildCrossConferencePairs,
  divisionFinishRanks,
  divisionGameCeiling,
  doubleheaderWeeks,
  pairKey,
  regularSeasonGames,
} from '../src/utils/schedule-rules.mjs';
// @ts-expect-error - .mjs helper shared with the node scripts (see its header)
import { buildWeekPlan } from '../src/utils/schedule-builder.mjs';

/**
 * The annual schedule audit.
 *
 * Every rule here is one the league states and has already broken at least
 * once, in a way nothing caught:
 *
 *  - 2026 shipped a doubleheader in Week 13 with four NFL teams on bye, in
 *    BOTH leagues, because the week number was copied from 2025 instead of
 *    re-derived. 2022-2025 all got it right; the bye calendar moved and the
 *    schedule did not.
 *  - The AFL's Week 1 cross-conference pairings were last recomputed for 2024.
 *    2025 and 2026 are the same sheet, scoring 2 of 12 against the rule that
 *    reproduces 12 of 12 in 2022, 2023 and 2024.
 *
 * So the tests are written against the CURRENT PUBLISHED FEED, not against the
 * planner's output — a planner checking its own work proves nothing. When one
 * fails, the fix is to regenerate and paste:
 *
 *   node scripts/fetch-nfl-bye-weeks.mjs          # refresh the bye calendar
 *   node scripts/generate-schedule.mjs --league=afl-fantasy
 *   node scripts/generate-schedule.mjs --league=theleague
 *
 * A season that has not been scheduled yet is skipped rather than failed —
 * these run year-round and must not go red every February.
 */
/**
 * Feeds root. `SCHEDULE_AUDIT_ROOT` points the audit at a candidate schedule
 * instead of the published one, so a plan can be checked BEFORE it is pasted —
 * pasting overwrites the whole fantasy schedule and there is no undo:
 *
 *   node scripts/stage-schedule-plan.mjs
 *   SCHEDULE_AUDIT_ROOT=$(node scripts/stage-schedule-plan.mjs --print-root) \
 *     pnpm vitest run tests/schedule-optimization.test.ts
 */
const ROOT = process.env.SCHEDULE_AUDIT_ROOT
  ? path.resolve(process.env.SCHEDULE_AUDIT_ROOT)
  : path.resolve(__dirname, '..');
const BYES_ROOT = path.resolve(__dirname, '..');
const readJson = (p: string): any => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const asArray = <T>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const BYES = readJson(path.join(BYES_ROOT, 'data/nfl/bye-weeks.json'))?.seasons ?? {};

/** Season under audit: the newest year that has both a bye calendar and a schedule. */
const LEAGUES = [
  { slug: 'theleague', dir: 'data/theleague', divisionSize: 4, doubleheaders: 4, crossConference: false },
  { slug: 'afl-fantasy', dir: 'data/afl-fantasy', divisionSize: 6, doubleheaders: 3, crossConference: true },
];

const loadSeason = (dir: string, year: string) => {
  const feeds = path.join(ROOT, dir, 'mfl-feeds', year);
  const meta = readJson(path.join(feeds, 'league.json'))?.league;
  const schedule = readJson(path.join(feeds, 'schedule.json'))?.schedule?.weeklySchedule;
  if (!meta || !schedule) return null;

  const divisionName: Record<string, string> = {};
  const divisionConference: Record<string, string> = {};
  for (const d of asArray<any>(meta.divisions?.division)) {
    divisionName[d.id] = d.name;
    divisionConference[d.id] = d.conference;
  }
  const franchiseIds: string[] = [];
  const name: Record<string, string> = {};
  const divisionOf: Record<string, string> = {};
  const conferenceOf: Record<string, string> = {};
  for (const f of asArray<any>(meta.franchises?.franchise)) {
    franchiseIds.push(f.id);
    name[f.id] = f.name;
    divisionOf[f.id] = divisionName[String(f.division)] ?? String(f.division);
    conferenceOf[f.id] = divisionConference[String(f.division)] ?? '00';
  }
  const lastWeek = Number(meta.lastRegularSeasonWeek);
  const games = regularSeasonGames(schedule, lastWeek);
  if (!games.size) return null;
  return { meta, feeds, franchiseIds, name, divisionOf, conferenceOf, lastWeek, games };
};

const auditYear = (dir: string) => {
  const years = Object.keys(BYES).sort().reverse();
  for (const year of years) {
    if (loadSeason(dir, year)) return year;
  }
  return null;
};

describe('NFL bye calendar', () => {
  it('is stored for the seasons we audit, with all 32 teams', () => {
    expect(Object.keys(BYES).length).toBeGreaterThan(0);
    for (const [year, teams] of Object.entries(BYES)) {
      expect(Object.keys(teams as object), `${year} team count`).toHaveLength(32);
    }
  });
});

for (const league of LEAGUES) {
  const year = auditYear(league.dir);

  describe(`${league.slug} schedule audit`, () => {
    if (!year) {
      it.skip('no scheduled season to audit yet', () => {});
      return;
    }
    const season = loadSeason(league.dir, year)!;
    const byes = BYES[year];
    const byeCounts = byeCountsByWeek(byes);
    const clean = byeFreeWeeks(byes, season.lastWeek);
    const dh = doubleheaderWeeks(season.games);

    it(`${year}: no doubleheader falls on an NFL bye week`, () => {
      const onByes = dh.map((w: number) => ({ week: w, nflTeamsOut: byeCounts[w] ?? 0 })).filter((r) => r.nflTeamsOut > 0);
      expect(
        onByes,
        `doubleheader weeks ${JSON.stringify(onByes)} carry NFL byes; bye-free weeks this season are ${clean.join(', ')}`,
      ).toEqual([]);
    });

    it(`${year}: has the expected number of doubleheaders`, () => {
      expect(dh).toHaveLength(league.doubleheaders);
    });

    it(`${year}: doubleheaders are split as evenly as possible between the start and end`, () => {
      const midpoint = season.lastWeek / 2;
      const early = dh.filter((w: number) => w <= midpoint).length;
      const late = dh.length - early;
      // With an odd count a 2/1 split is as even as it gets; the gap may also
      // be forced wider when the end window has only one bye-free week, which
      // goal 1 outranks. So this asserts the split is no worse than what the
      // bye-free weeks in each half actually allow.
      const cleanEarly = clean.filter((w: number) => w <= midpoint).length;
      const cleanLate = clean.filter((w: number) => w > midpoint).length;
      const bestLate = Math.min(Math.floor(dh.length / 2), cleanLate);
      const bestEarly = Math.min(dh.length - bestLate, cleanEarly);
      expect(
        { early, late },
        `best achievable given bye-free weeks (early ${cleanEarly}, late ${cleanLate}) is ${bestEarly}/${bestLate}`,
      ).toEqual({ early: bestEarly, late: bestLate });
    });

    it(`${year}: every franchise plays the same number of games`, () => {
      const played: Record<string, number> = {};
      for (const id of season.franchiseIds) played[id] = 0;
      for (const games of season.games.values()) {
        for (const g of games as any[]) {
          played[g.away] += 1;
          played[g.home] += 1;
        }
      }
      expect(new Set(Object.values(played)).size, JSON.stringify(played)).toBe(1);
    });

    it(`${year}: division opponents are played exactly twice, everyone else once`, () => {
      const opponents: Record<string, Record<string, number>> = {};
      for (const games of season.games.values()) {
        for (const g of games as any[]) {
          ((opponents[g.away] ??= {})[g.home] ??= 0), (opponents[g.away][g.home] += 1);
          ((opponents[g.home] ??= {})[g.away] ??= 0), (opponents[g.home][g.away] += 1);
        }
      }
      const violations: string[] = [];
      for (const id of season.franchiseIds) {
        const twice = Object.entries(opponents[id] ?? {})
          .filter(([, n]) => n >= 2)
          .map(([other]) => other)
          .sort();
        const mates = season.franchiseIds
          .filter((other) => other !== id && season.divisionOf[other] === season.divisionOf[id])
          .sort();
        if (twice.join(',') !== mates.join(',')) violations.push(season.name[id]);
      }
      expect(violations).toEqual([]);
    });

    it(`${year}: division games use every bye-free slot available to them`, () => {
      const cleanSet = new Set(clean);
      let byeFree = 0;
      for (const [week, games] of season.games) {
        if (!cleanSet.has(week)) continue;
        byeFree += (games as any[]).filter((g) => season.divisionOf[g.away] === season.divisionOf[g.home]).length;
      }
      const ceiling = divisionGameCeiling({
        teamCount: season.franchiseIds.length,
        divisionSize: league.divisionSize,
        byeFree: clean,
        doubleheaders: dh,
        reservedSlotsPerTeam: league.crossConference ? 1 : 0,
      });

      // `divisionGameCeiling` is the ABSTRACT bound — every bye-free slot, if
      // the division legs could reach it. They cannot always. Confining the two
      // legs to an early and a late block is what makes rivals meet once early
      // and once late, so a bye-free week stranded in the middle (2023 and 2024
      // both have a clean Week 8) is unreachable by construction. Deriving the
      // reachable bound from the week plan keeps this assertion honest instead
      // of failing a schedule for obeying a different rule.
      //
      // The League deliberately keeps a pure-division final week, which costs
      // one round; see docs/claude/rules/schedule-optimization.md.
      let allowance = league.crossConference ? 0 : season.franchiseIds.length / 2;
      if (league.crossConference) {
        try {
          const weekPlan = buildWeekPlan({
            lastWeek: season.lastWeek,
            doubleheaders: dh,
            byeCounts,
            divisionSize: league.divisionSize,
            crossWeek: 1,
          });
          const cleanWeeks = new Set(clean);
          const gamesPerRound = season.franchiseIds.length / 2;
          const reachable =
            weekPlan
              .filter((w: any) => cleanWeeks.has(w.week))
              .reduce((n: number, w: any) => n + w.slots.filter((s: any) => s.kind === 'division').length, 0) *
            gamesPerRound;
          allowance = Math.max(0, ceiling.ceiling - reachable);
        } catch {
          // A season whose weeks/doubleheaders do not fit the format at all is
          // already reported by the doubleheader assertions above.
        }
      }
      expect(
        byeFree,
        `${byeFree} of ${ceiling.total} division games are bye-free; ceiling is ${ceiling.ceiling} ` +
          `(${ceiling.forcedOntoByeWeeks} forced onto bye weeks by the format). ` +
          `Regenerate: see this file's header.`,
      ).toBeGreaterThanOrEqual(ceiling.ceiling - allowance);
    });

    it(`${year}: division rivals never meet twice inside three weeks`, () => {
      const met: Record<string, number[]> = {};
      for (const [week, games] of season.games) {
        for (const g of games as any[]) {
          if (season.divisionOf[g.away] !== season.divisionOf[g.home]) continue;
          (met[pairKey(g.away, g.home)] ??= []).push(week);
        }
      }
      const tooClose = Object.entries(met)
        .filter(([, weeks]) => weeks.length > 1 && Math.abs(weeks[1] - weeks[0]) <= 3)
        .map(([k, weeks]) => `${k} in weeks ${weeks.join(' and ')}`);
      expect(tooClose).toEqual([]);
    });

    if (league.crossConference) {
      it(`${year}: the cross-conference round is played in Week 1 and nowhere else`, () => {
        const weeksWithCross: number[] = [];
        for (const [week, games] of season.games) {
          const cross = (games as any[]).filter((g) => season.conferenceOf[g.away] !== season.conferenceOf[g.home]);
          if (cross.length) weeksWithCross.push(week);
        }
        expect(weeksWithCross).toEqual([1]);
      });

      it(`${year}: cross-conference pairings match last season's division finishes`, () => {
        const prev = String(Number(year) - 1);
        const prevMeta = readJson(path.join(ROOT, league.dir, 'mfl-feeds', prev, 'league.json'))?.league;
        const prevStandings = readJson(path.join(ROOT, league.dir, 'mfl-feeds', prev, 'standings.json'))
          ?.leagueStandings?.franchise;
        if (!prevMeta || !prevStandings) {
          expect(true).toBe(true); // prior season not archived; nothing to check against
          return;
        }
        const prevDivisionName: Record<string, string> = {};
        for (const d of asArray<any>(prevMeta.divisions?.division)) prevDivisionName[d.id] = d.name;
        const prevDivisionOf: Record<string, string> = {};
        for (const f of asArray<any>(prevMeta.franchises?.franchise)) {
          prevDivisionOf[f.id] = prevDivisionName[String(f.division)] ?? String(f.division);
        }
        const prevRank = divisionFinishRanks(prevStandings, prevDivisionOf);

        // Division pairing alternates, anchored on 2024 = North/East + South/West.
        const flip = (Number(year) - 2024) % 2 !== 0;
        const divisionPairing = flip
          ? [
              ['North', 'West'],
              ['South', 'East'],
            ]
          : [
              ['North', 'East'],
              ['South', 'West'],
            ];
        const byName: Record<string, string> = {};
        for (const id of season.franchiseIds) byName[season.name[id]] = id;
        const protectedPairs = [['Computer Jocks', 'Jewpacabra']]
          .filter(([a, b]) => byName[a] && byName[b])
          .map(([a, b]) => [byName[a], byName[b]]);

        const expected = buildCrossConferencePairs({
          prevRank,
          divisionPairing,
          protectedPairs,
          conferenceOf: season.conferenceOf,
          franchiseIds: season.franchiseIds,
        });
        const expectedKeys = new Set(expected.map((p: any) => pairKey(p.away, p.home)));
        const actual = (season.games.get(1) ?? []).filter(
          (g: any) => season.conferenceOf[g.away] !== season.conferenceOf[g.home],
        );
        const wrong = actual
          .filter((g: any) => !expectedKeys.has(pairKey(g.away, g.home)))
          .map((g: any) => `${season.name[g.away]} vs ${season.name[g.home]}`);
        expect(
          wrong,
          `${actual.length - wrong.length} of ${expected.length} pairings are correct. ` +
            `Regenerate with node scripts/generate-schedule.mjs --league=afl-fantasy`,
        ).toEqual([]);
      });

      it(`${year}: the protected rivalry is scheduled`, () => {
        const byName: Record<string, string> = {};
        for (const id of season.franchiseIds) byName[season.name[id]] = id;
        const a = byName['Computer Jocks'];
        const b = byName.Jewpacabra;
        if (!a || !b) {
          expect(true).toBe(true); // franchise renamed or gone; not this test's business
          return;
        }
        const played = [...season.games.values()].some((games) =>
          (games as any[]).some((g) => pairKey(g.away, g.home) === pairKey(a, b)),
        );
        expect(played, 'Computer Jocks vs Jewpacabra is a protected rivalry and must appear').toBe(true);
      });
    }
  });
}
