import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error - .mjs helper shared with the node scripts (see its header)
import { bracketKindFromName } from '../src/utils/afl-bracket-kind.mjs';

/**
 * Every AFL season's stored regular season must reproduce MFL's own standings.
 *
 * This is broader than tests/afl-schedule-recovery.test.ts, which guards only
 * the seasons recovered from the authenticated schedule view. The reason it
 * exists is that MFL has served the AFL matchups whose SCORES were correct and
 * whose OPPONENTS were invented: 2012-2015 each carried 46 such rows, agreeing
 * with weekly-results.json exactly while contradicting the official records
 * (see docs/claude/insights/domains/mfl-api.md, 2026-08-16). Fabricated
 * pairings pass every cheap check — right scores, one game per franchise per
 * week, real weeks — so the only test that catches them is the one MFL cannot
 * fake: `leagueStandings` is computed from the true schedule, and twenty-four
 * simultaneous W-L-T constraints cannot come out right by accident.
 *
 * The live risk is a refetch. scripts/backfill-historical-feeds.mjs runs from a
 * workflow and would happily pull MFL's version again; its "never trade a
 * fuller cached copy for a thinner fresh one" guard compares COUNTS, which a
 * same-size fabrication would pass. This test is the backstop.
 */
const ROOT = path.resolve(__dirname, '..');
const FEEDS = path.join(ROOT, 'data/afl-fantasy/mfl-feeds');

const toArray = <T>(v: T | T[] | undefined | null): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];
const readJson = (p: string): any => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const officialRecord = (f: any) => {
  const [w, l, t] = String(f?.h2hwlt ?? '').split('-').map(Number);
  if (Number.isFinite(w) && (w || l || t)) return { w: w || 0, l: l || 0, t: t || 0 };
  return { w: Number(f?.h2hw) || 0, l: Number(f?.h2hl) || 0, t: Number(f?.h2ht) || 0 };
};

const years = fs.existsSync(FEEDS)
  ? fs.readdirSync(FEEDS).filter((y) => /^\d{4}$/.test(y)).sort()
  : [];

type Season = {
  year: string;
  games: { week: number; a: string; b: string; sa: number; sb: number }[];
  franchises: any[];
};

const seasons: Season[] = [];
for (const year of years) {
  const schedule = readJson(path.join(FEEDS, year, 'schedule.json'));
  const standings = readJson(path.join(FEEDS, year, 'standings.json'));
  if (!schedule || !standings) continue;

  // Regular season only. "First playoff week" is NOT min(startWeek): the AFL
  // Cup is an in-season knockout starting as early as week 4, so classify with
  // the shared resolver and ignore 'cup' the way the compute script does.
  const brackets = readJson(path.join(FEEDS, year, 'playoff-brackets.json'));
  const starts = toArray<any>(brackets?.playoffBrackets?.playoffBracket)
    .filter((b) => bracketKindFromName(b.name, String(b.id)) !== 'cup')
    .map((b) => Number(b.startWeek))
    .filter((n) => Number.isFinite(n) && n > 0);
  const cutoff = starts.length ? Math.min(...starts) : Infinity;

  const games: Season['games'] = [];
  for (const wk of toArray<any>(schedule.schedule?.weeklySchedule)) {
    if (!(Number(wk.week) < cutoff)) continue;
    for (const m of toArray<any>(wk.matchup)) {
      const fr = toArray<any>(m.franchise);
      if (fr.length !== 2) continue;
      const sa = Number(fr[0].score);
      const sb = Number(fr[1].score);
      // 2003 was played on Yahoo: its rows exist but carry no scores, so there
      // is nothing to reconcile and nothing to protect.
      if (!(sa > 0) && !(sb > 0)) continue;
      games.push({ week: Number(wk.week), a: fr[0].id, b: fr[1].id, sa, sb });
    }
  }

  const franchises = toArray<any>(standings.leagueStandings?.franchise).filter((f) => {
    const r = officialRecord(f);
    return r.w + r.l + r.t > 0;
  });

  if (games.length === 0 || franchises.length === 0) continue;
  seasons.push({ year, games, franchises });
}

describe('AFL stored schedules reconcile with MFL standings', () => {
  it('checks the whole modern archive, not a handful of seasons', () => {
    // Guards against the suite quietly going vacuous if a path or shape moves.
    expect(seasons.length).toBeGreaterThanOrEqual(20);
  });

  describe.each(seasons.map((s) => [s.year, s] as const))('%s', (_year, season) => {
    it("reproduces every franchise's official W-L-T", () => {
      const rec = new Map<string, { w: number; l: number; t: number }>();
      const bump = (id: string, k: 'w' | 'l' | 't') => {
        if (!rec.has(id)) rec.set(id, { w: 0, l: 0, t: 0 });
        rec.get(id)![k]++;
      };
      for (const g of season.games) {
        if (g.sa > g.sb) { bump(g.a, 'w'); bump(g.b, 'l'); }
        else if (g.sa < g.sb) { bump(g.a, 'l'); bump(g.b, 'w'); }
        else { bump(g.a, 't'); bump(g.b, 't'); }
      }

      const mismatches: string[] = [];
      for (const f of season.franchises) {
        const want = officialRecord(f);
        const got = rec.get(f.id) ?? { w: 0, l: 0, t: 0 };
        if (got.w !== want.w || got.l !== want.l || got.t !== want.t) {
          mismatches.push(
            `${f.id}: schedule says ${got.w}-${got.l}-${got.t}, MFL says ${want.w}-${want.l}-${want.t}`
          );
        }
      }
      expect(
        mismatches,
        `Stored ${season.year} schedule disagrees with MFL standings — either a refetch ` +
          `overwrote recovered data, or MFL served fabricated pairings again`
      ).toEqual([]);
    });

    it('never pairs a franchise with itself, or repeats a pairing within one week', () => {
      // Both shapes have actually occurred in these feeds: 2012's archived week
      // 14 carried an outright `0023 vs 0023` bye row, and 2014/2015 NIT weeks
      // each carried a stray matchup duplicating teams already scheduled.
      const seen = new Set<string>();
      const selfPlay: string[] = [];
      const duplicates: string[] = [];
      for (const g of season.games) {
        if (g.a === g.b) selfPlay.push(`wk${g.week} ${g.a}`);
        const key = `${g.week}:${[g.a, g.b].sort().join(':')}`;
        if (seen.has(key)) duplicates.push(key);
        seen.add(key);
      }
      expect(selfPlay, 'franchise scheduled against itself').toEqual([]);
      expect(duplicates, 'same pairing recorded twice in one week').toEqual([]);
    });
  });
});
