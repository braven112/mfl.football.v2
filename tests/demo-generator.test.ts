/**
 * The custom-site demo's fictional league generator (scripts/demo/,
 * docs/plans/custom-site-demo.md).
 *
 * Pins: the league is deterministic for a seed; its names never collide with a
 * real league's; it reads only NFL facts; its build can never reach the
 * network; and the shapes it writes are the ones the site's parsers read.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { loadSeasonFacts } from '../scripts/demo/lib/nfl-facts.mjs';
import { simulateLeague, LEAGUE_RULES } from '../scripts/demo/lib/simulate.mjs';
import { DEMO_FRANCHISES } from '../scripts/demo/lib/franchises.mjs';
import { createRng } from '../scripts/demo/lib/rng.mjs';
import * as feeds from '../scripts/demo/lib/mfl-feeds.mjs';
import { applyRenames, renamePairs } from '../scripts/demo/lib/identity-files.mjs';
import { nflWeekStartInstant } from '../src/utils/nfl-week-starts.mjs';
import { bestBallDraft, BESTBALL_FRANCHISES, BESTBALL_ROUNDS } from '../scripts/demo/lib/bestball.mjs';
import { KEEPER_FRANCHISES } from '../scripts/demo/lib/keeper.mjs';
import { KEEPERS } from '../scripts/demo/lib/simulate.mjs';
import { seasonTotals, lastCompletedWeek } from '../scripts/demo/lib/nfl-facts.mjs';

const FEEDS = 'data/theleague/mfl-feeds';
const YEARS = [2023, 2024, 2025];
const weekStart = (y: number, w: number) => Math.floor(new Date(nflWeekStartInstant(y, w)).getTime() / 1000);

function simulate(seed: string) {
  const facts = new Map([2022, ...YEARS].map((y) => [y, loadSeasonFacts(FEEDS, y)]));
  return simulateLeague({
    years: YEARS,
    facts,
    currentYear: 2025,
    currentWeek: LEAGUE_RULES.endWeek,
    franchises: DEMO_FRANCHISES,
    rng: createRng(seed),
    weekStart,
  });
}

const serialize = (seasons: ReturnType<typeof simulate>) =>
  JSON.stringify(
    seasons.map((s) => ({
      rosters: feeds.rostersFeed(s),
      standings: feeds.standingsFeed(s),
      tx: feeds.transactionsFeed(s),
      brackets: feeds.playoffBracketsFeed(s, 'Demo'),
    })),
  );

describe('demo league generator', () => {
  const seasons = simulate('test-seed');

  it('is deterministic: the same seed produces the same league', () => {
    expect(serialize(simulate('test-seed'))).toBe(serialize(seasons));
    expect(serialize(simulate('other-seed'))).not.toBe(serialize(seasons));
  });

  it('plays full seasons with legal rosters under the cap', () => {
    for (const s of seasons) {
      expect(s.standings).toHaveLength(16);
      expect((s.playoffs?.championship as { champion?: string } | undefined)?.champion).toBeTruthy();
      for (const roster of s.rosters.values()) {
        const active = [...roster.values()].filter((c) => c.status !== 'TAXI_SQUAD');
        expect(active.length).toBeLessThanOrEqual(LEAGUE_RULES.rosterSize);
        expect(active.length).toBeGreaterThanOrEqual(LEAGUE_RULES.rosterSize - 1);
      }
    }
  });

  it('seeds the playoff field by the constitution: four division winners, then three wild cards', () => {
    for (const s of seasons) {
      const division = new Map(DEMO_FRANCHISES.map((f) => [f.id, f.divisionIndex]));
      const top4 = s.playoffs!.seeds.slice(0, 4).map((x) => division.get(x.id));
      expect(new Set(top4).size).toBe(4);
    }
  });

  it('never rosters a player twice in one season', () => {
    for (const s of seasons) {
      const all = [...s.rosters.values()].flatMap((r) => [...r.keys()]);
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

describe('demo identities', () => {
  const real = JSON.parse(readFileSync('src/data/theleague.config.json', 'utf8'));
  const registry = JSON.parse(readFileSync('src/data/owners-registry.json', 'utf8'));

  it('shares no franchise or owner name with any real league', () => {
    const realNames = new Set<string>();
    const afl = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf8'));
    for (const t of [...real.teams, ...afl.teams]) {
      for (const era of [t, ...(t.history ?? [])]) {
        for (const n of [era.name, era.nameMedium, era.nameShort, era.abbrev]) if (n) realNames.add(n.toLowerCase());
      }
    }
    for (const p of registry.people) realNames.add(String(p.displayName).toLowerCase());
    // Every demo league's clubs — the dynasty, redraft and keeper demos.
    for (const f of [...DEMO_FRANCHISES, ...BESTBALL_FRANCHISES, ...KEEPER_FRANCHISES]) {
      for (const n of [f.name, f.nameShort, f.abbrev, (f as { owner?: string }).owner]) {
        if (!n) continue;
        expect(realNames.has(String(n).toLowerCase()), `${n} is a real name`).toBe(false);
      }
    }
  });

  it('renames every real franchise name in prose, longest first', () => {
    const pairs = renamePairs(real, DEMO_FRANCHISES);
    const sample = real.teams.map((t: { name: string }) => t.name).join(' | ');
    const out = applyRenames(sample, pairs);
    for (const t of real.teams) expect(out).not.toContain(t.name);
  });
});

describe('demo build isolation', () => {
  it('prebuild hands a demo build to the demo pipeline before any real step', () => {
    const src = readFileSync('scripts/prebuild.mjs', 'utf8');
    const main = src.slice(src.indexOf('async function main()'));
    const demo = main.indexOf('isDemoEnv(process.env)');
    const firstStep = main.indexOf('for (const { name, cmd } of sequential)');
    expect(demo).toBeGreaterThan(-1);
    expect(demo).toBeLessThan(firstStep);
  });

  it('the build preload refuses every network call and scrubs credentials', () => {
    const preload = path.resolve('scripts/demo/lib/guard-preload.mjs');
    const out = execFileSync(
      process.execPath,
      [
        '--import',
        preload,
        '-e',
        `const r=[];
         fetch('https://site.api.espn.com/x').catch(e=>r.push(e.name)).then(()=>{
           try{require('https').get('https://example.com')}catch(e){r.push(e.name)}
           console.log(JSON.stringify({r, mfl: process.env.MFL_USER_ID ?? null, skip: process.env.SKIP_SALARY_FETCH}));
         });`,
      ],
      { env: { ...process.env, MFL_USER_ID: 'secret' }, encoding: 'utf8' },
    );
    expect(JSON.parse(out.trim())).toEqual({ r: ['DemoBuildNetworkError', 'DemoBuildNetworkError'], mfl: null, skip: '1' });
  });

  it('build-demo-data refuses to run outside Vercel on a checkout not declared disposable', () => {
    let failed = '';
    try {
      execFileSync(process.execPath, ['--import', path.resolve('scripts/demo/lib/guard-preload.mjs'), 'scripts/demo/build-demo-data.mjs'], {
        env: { ...process.env, VERCEL: '', DEMO_BUILD_DISPOSABLE_CHECKOUT: '' },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      failed = String((err as { stderr?: string }).stderr);
    }
    expect(failed).toContain('DELETES the real league data');
  });
});

describe('the /redraft demo draft', () => {
  const draft = () =>
    bestBallDraft({
      players: loadSeasonFacts(FEEDS, 2025).players,
      adp: JSON.parse(readFileSync(`${FEEDS}/2025/adp-redraft.json`, 'utf8')).adp.player,
      depth: new Map([...seasonTotals(loadSeasonFacts(FEEDS, 2024))].map(([id, t]) => [id, t.points])),
      leagueId: 'x',
      leagueYear: 2025,
      seed: 'test/bestball',
      draftStart: 0,
    });

  it('is a full snake draft: every team fills every round, no player twice', () => {
    const d = draft();
    expect(d.picks).toHaveLength(BESTBALL_FRANCHISES.length * BESTBALL_ROUNDS);
    expect(new Set(d.picks.map((p: { playerId: string }) => p.playerId)).size).toBe(d.picks.length);
    const n = BESTBALL_FRANCHISES.length;
    expect(d.draftOrder.slice(n, 2 * n)).toEqual([...d.draftOrder.slice(0, n)].reverse());
  });

  it('is deterministic for a seed', () => {
    expect(JSON.stringify(draft())).toBe(JSON.stringify(draft()));
  });
});

describe('the /keeper demo league', () => {
  const seasons = simulateLeague({
    years: YEARS,
    facts: new Map([2022, ...YEARS].map((y) => [y, loadSeasonFacts(FEEDS, y)])),
    currentYear: 2025,
    currentWeek: LEAGUE_RULES.endWeek,
    franchises: KEEPER_FRANCHISES,
    rng: createRng('test/keeper'),
    weekStart,
    mode: 'keeper',
  });

  it('carries no salaries and full rosters every season', () => {
    for (const season of seasons) {
      for (const roster of season.rosters.values()) {
        expect(roster.size).toBe(LEAGUE_RULES.rosterSize);
        for (const c of roster.values()) expect(c.salary).toBe(0);
      }
    }
  });

  it('keeps KEEPERS a team and re-drafts the rest: a full startup draft, then the remainder', () => {
    const [startup, ...later] = seasons;
    expect(startup.draftPicks).toHaveLength(KEEPER_FRANCHISES.length * LEAGUE_RULES.rosterSize);
    for (const s of later) {
      expect(s.draftPicks).toHaveLength(KEEPER_FRANCHISES.length * (LEAGUE_RULES.rosterSize - KEEPERS));
    }
  });

  it('seeds a seven-team field from two divisions', () => {
    const final = seasons[seasons.length - 1];
    expect(final.playoffs).not.toBeNull();
  });
});

describe('the current week is the last one fully played', () => {
  const week = (active: number, zeros = 0) =>
    new Map([
      ...Array.from({ length: active }, (_, i) => [`a${i}`, 10] as [string, number]),
      ...Array.from({ length: zeros }, (_, i) => [`z${i}`, 0] as [string, number]),
    ]);

  it('drops a week with only Thursday played', () => {
    // A 0-0 pairing in a simulated week reads as a tie in standings but as
    // unplayed in the derived chain, which fails the demo build.
    expect(lastCompletedWeek(new Map([[1, week(300)], [2, week(260)], [3, week(20, 280)]]))).toBe(2);
  });

  it('keeps bye weeks and counts only an unbroken run from week 1', () => {
    expect(lastCompletedWeek(new Map([[1, week(300)], [2, week(240)], [3, week(290)]]))).toBe(3);
    expect(lastCompletedWeek(new Map([[1, week(300)], [3, week(300)]]))).toBe(1);
    expect(lastCompletedWeek(new Map())).toBe(0);
  });
});
