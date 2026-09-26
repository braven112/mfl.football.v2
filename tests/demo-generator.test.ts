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
    for (const t of real.teams) {
      for (const era of [t, ...(t.history ?? [])]) {
        for (const n of [era.name, era.nameMedium, era.nameShort, era.abbrev]) if (n) realNames.add(n.toLowerCase());
      }
    }
    for (const p of registry.people) realNames.add(String(p.displayName).toLowerCase());
    for (const f of DEMO_FRANCHISES) {
      for (const n of [f.name, f.nameShort, f.abbrev, f.owner]) {
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
