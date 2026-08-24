import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bracketKindFromName } from '../src/utils/afl-bracket-kind.mjs';

/**
 * Guards the regular-season schedules recovered from MFL's authenticated
 * "By Franchise" schedule view (scripts/recover-afl-schedule-from-html.mjs).
 *
 * MFL's export API returns these seasons with the matchups stripped, so the
 * recovered games are the ONLY copy — a silent corruption here would be
 * invisible everywhere else and would quietly wrong every rivalry record.
 *
 * The invariant is the same one the recovery script refuses to write without:
 * replaying the recovered weeks must reproduce each franchise's official W-L-T
 * exactly. Twenty-four independent record matches cannot come out right by
 * accident, which is what makes this stronger than spot-checking a few games.
 */
const ROOT = path.resolve(__dirname, '..');
const FEEDS = path.join(ROOT, 'data/afl-fantasy/mfl-feeds');
const RECOVERY_DIR = path.join(ROOT, 'data/afl-fantasy/schedule-recovery');

const toArray = <T>(v: T | T[] | undefined | null): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));

const recoveredYears = fs.existsSync(RECOVERY_DIR)
  ? fs
      .readdirSync(RECOVERY_DIR)
      .filter((f) => /^\d{4}\.txt$/.test(f))
      .map((f) => f.slice(0, 4))
      .sort()
  : [];

describe('AFL schedules recovered from the authenticated schedule view', () => {
  it('has at least one recovered season', () => {
    expect(recoveredYears.length).toBeGreaterThan(0);
  });

  describe.each(recoveredYears)('%s', (year) => {
    const schedule = readJson(path.join(FEEDS, year, 'schedule.json'));
    const standings = readJson(path.join(FEEDS, year, 'standings.json'));

    // Regular season only — standings W-L excludes the postseason, so counting
    // playoff games would guarantee a false mismatch.
    //
    // "First playoff week" is NOT min(startWeek): the AFL Cup is an in-season
    // knockout whose brackets start in week 4 (2017 runs six of them from weeks
    // 4-12). Taking the minimum treated weeks 4+ as postseason and left only
    // weeks 1-3 to reconcile, failing all 24 franchises on a season whose data
    // is perfectly good. Classify with the shared resolver the compute script
    // uses, and ignore 'cup' for the same reason it does.
    const brackets = readJson(path.join(FEEDS, year, 'playoff-brackets.json'));
    const startWeeks = toArray<any>(brackets?.playoffBrackets?.playoffBracket)
      .filter((b) => bracketKindFromName(b.name, String(b.id)) !== 'cup')
      .map((b) => Number(b.startWeek))
      .filter((n) => Number.isFinite(n) && n > 0);
    const firstPlayoffWeek = startWeeks.length ? Math.min(...startWeeks) : Infinity;

    const regularSeason = toArray<any>(schedule?.schedule?.weeklySchedule).filter(
      (wk) => Number(wk.week) < firstPlayoffWeek
    );

    it('covers every regular-season week', () => {
      const withGames = regularSeason.filter(
        (wk) => toArray<any>(wk.matchup).some((m) => toArray<any>(m.franchise).length === 2)
      );
      expect(withGames.length).toBe(regularSeason.length);
      expect(withGames.length).toBeGreaterThan(0);
    });

    it("reproduces every franchise's official W-L-T", () => {
      const rec = new Map<string, { w: number; l: number; t: number }>();
      const bump = (id: string, k: 'w' | 'l' | 't') => {
        if (!rec.has(id)) rec.set(id, { w: 0, l: 0, t: 0 });
        rec.get(id)![k]++;
      };

      for (const wk of regularSeason) {
        for (const m of toArray<any>(wk.matchup)) {
          const fr = toArray<any>(m.franchise);
          if (fr.length !== 2) continue;
          const [a, b] = fr;
          const sa = Number(a.score);
          const sb = Number(b.score);
          if (sa > sb) { bump(a.id, 'w'); bump(b.id, 'l'); }
          else if (sa < sb) { bump(a.id, 'l'); bump(b.id, 'w'); }
          else { bump(a.id, 't'); bump(b.id, 't'); }
        }
      }

      const official = (f: any) => {
        const [w, l, t] = String(f?.h2hwlt ?? '').split('-').map(Number);
        if (Number.isFinite(w) && (w || l || t)) return `${w || 0}-${l || 0}-${t || 0}`;
        return `${Number(f?.h2hw) || 0}-${Number(f?.h2hl) || 0}-${Number(f?.h2ht) || 0}`;
      };

      const mismatches: string[] = [];
      for (const f of toArray<any>(standings?.leagueStandings?.franchise)) {
        const got = rec.get(f.id) ?? { w: 0, l: 0, t: 0 };
        const derivedStr = `${got.w}-${got.l}-${got.t}`;
        if (derivedStr !== official(f)) {
          mismatches.push(`${f.id}: schedule says ${derivedStr}, MFL says ${official(f)}`);
        }
      }
      expect(mismatches, `Recovered ${year} schedule disagrees with MFL standings`).toEqual([]);
    });

    it('records each game exactly once, with two distinct franchises', () => {
      const seen = new Set<string>();
      for (const wk of regularSeason) {
        for (const m of toArray<any>(wk.matchup)) {
          const fr = toArray<any>(m.franchise);
          if (fr.length !== 2) continue;
          expect(fr[0].id).not.toBe(fr[1].id);
          const key = `${wk.week}:${[fr[0].id, fr[1].id].sort().join(':')}`;
          expect(seen.has(key), `duplicate matchup ${key}`).toBe(false);
          seen.add(key);
        }
      }
    });
  });
});
