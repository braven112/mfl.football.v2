/**
 * One system for game odds and weather, for every league.
 *
 * Sept 2026: the site had FOUR copies of "fetch the week's ESPN scoreboard,
 * read the spread and over/under, backfill stadium weather from Open-Meteo" —
 * coach-data.ts (both lineup pages), rosters/live-odds.ts (TheLeague rosters),
 * live-odds.ts + weather.ts (unused), and nfl-matchups.ts' fetchNflMatchups
 * (AFL rosters). The AFL's copy never backfilled weather, so AFL owners saw no
 * weather at all while TheLeague's owners, looking at the same NFL game, did.
 *
 * The rule (user, 2026-09-26): both leagues, and every league added later,
 * read odds and weather through `loadLiveOdds` in src/utils/coach-data.ts.
 * This scan fails on a second implementation anywhere under src/ — which is
 * everything a page renders. (Two Node scripts under scripts/ also read ESPN's
 * odds: fetch-live-odds.mjs writes the off-season snapshot and schefter-scan
 * writes articles. They cannot import TypeScript and render no page.)
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CANONICAL = 'src/utils/coach-data.ts';
/** The roster pages' door into CANONICAL: re-exports plus the off-season snapshot. */
const DOOR = 'src/utils/rosters/live-odds.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs|js|astro)$/.test(name)) out.push(path);
  }
  return out;
}

const files = walk('src').map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const offenders = (pattern: RegExp | string) =>
  files
    .filter((f) => f.path !== CANONICAL && (typeof pattern === 'string' ? f.text.includes(pattern) : pattern.test(f.text)))
    .map((f) => f.path);

describe('game odds and weather come from ONE system', () => {
  it('only the canonical module fetches stadium weather', () => {
    // A plain substring scan of source text, not a URL check.
    expect(offenders('open-meteo.com')).toEqual([]);
  });

  it('only the canonical module parses ESPN odds', () => {
    expect(offenders(/competition\.odds|\.odds\?\.\[0\]/)).toEqual([]);
  });

  it('only the canonical module owns the stadium table', () => {
    expect(offenders(/NFL_STADIUMS\s*(?::[^=]+)?=\s*\{/)).toEqual([]);
  });

  it('the roster door fetches nothing itself', () => {
    const door = readFileSync(DOOR, 'utf8');
    expect(door).not.toMatch(/\bfetch\(/);
    expect(door).toMatch(/from '\.\.\/coach-data'/);
  });

  it('both leagues’ roster and lineup pages load odds through it', () => {
    const pages = {
      'src/pages/theleague/rosters.astro': /loadLiveOddsData\(/,
      'src/pages/afl-fantasy/rosters.astro': /loadLiveOddsData\(/,
      'src/pages/theleague/lineup.astro': /loadLiveOdds\(/,
      'src/pages/afl-fantasy/lineup.astro': /loadLiveOdds\(/,
    };
    for (const [page, call] of Object.entries(pages)) {
      expect(readFileSync(page, 'utf8'), page).toMatch(call);
    }
  });

  it('the retired copies stay retired', () => {
    const paths = new Set(files.map((f) => f.path));
    expect(paths.has('src/utils/live-odds.ts')).toBe(false);
    expect(paths.has('src/utils/weather.ts')).toBe(false);
    expect(offenders(/export (async )?function fetchNflMatchups/)).toEqual([]);
  });
});
