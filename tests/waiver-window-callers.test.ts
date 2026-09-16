/**
 * How the waiver calendar is READ, checked at every call site rather than in
 * the resolver.
 *
 * Two rules, both found by review on the hotfix that pointed the homepage heroes
 * at `resolveWaiverWindow` (#1122) and its DST follow-up (#1126). Neither is
 * visible from inside `src/utils/waiver-window.ts` — both are about what the
 * callers hand it — which is exactly why they need a scan.
 *
 *   1. THE CALENDAR FILE IS KEYED BY THE LEAGUE YEAR, NOT THE SEASON YEAR.
 *      `data/<league>/mfl-feeds/<year>/calendar.json` is MFL's league-year
 *      directory. CLAUDE.md's "Year rollover — two independent clocks" says
 *      these are not the same clock: the league year turns on Feb 14 (June 1
 *      for the AFL) and the season year at Labor Day. Between those dates the
 *      feed has rolled while `getCurrentSeasonYear` still names last season, so
 *      a season-year lookup reads a STALE calendar — or misses the file
 *      entirely and falls through to `unknown`, which is the copy that names no
 *      day at all. Both homepages shipped on the season clock; `/players` had
 *      it right on both sides, which is what made the mismatch findable.
 *
 *   2. A CALLER THAT CAN NAME ITS LEAGUE MUST PASS ITS ZONE.
 *      `resolveWaiverWindow`'s `zone` expands MFL's weekly recurrence on the
 *      league's WALL CLOCK (see `addWeeksOnWallClock`). It defaults to the
 *      registry's fallback Pacific clock, documented as being "for a caller
 *      that cannot name its league" — and every production caller can. This is
 *      behaviourally a no-op while every league in the registry is Pacific,
 *      which is precisely why prose alone would not hold it: the day it stops
 *      being a no-op, nothing would say so. Same shape as the league-literal
 *      rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every production caller, DISCOVERED rather than listed.
 *
 * A hard-coded list is the failure mode this suite exists to prevent: a new
 * route that calls `resolveWaiverWindow` on the fallback zone would leave a
 * static list green, and nothing would say so. So the files are found by
 * walking `src/`. `EXPECTED` is kept alongside purely as a tripwire — if
 * discovery ever finds nothing (a rename, a glob that stops matching) the
 * suite must fail loudly rather than vacuously pass over an empty set.
 */
const SRC_ROOT = 'src';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|astro|mts|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Files under `src/` that CALL the resolver (importing it is not enough). */
const CALLERS = walk(SRC_ROOT)
  .filter((f) => f !== join('src', 'utils', 'waiver-window.ts'))
  .filter((f) => /resolveWaiverWindow\s*\(/.test(readFileSync(f, 'utf8')))
  .sort();

/**
 * The callers as of this suite's last review. Discovery is authoritative — this
 * only proves discovery is still WORKING, so a new caller is covered
 * automatically and a vanished one is noticed.
 */
const EXPECTED_AT_LEAST = [
  join('src', 'pages', 'afl-fantasy', 'index.astro'),
  join('src', 'pages', 'afl-fantasy', 'players.astro'),
  join('src', 'pages', 'api', 'waiver-claim.ts'),
  join('src', 'pages', 'theleague', 'index.astro'),
  join('src', 'pages', 'theleague', 'players.astro'),
  join('src', 'utils', 'claim-context.ts'),
];

describe('the caller scan finds what it claims to', () => {
  it('discovers every known caller — a vacuous pass is a failed guard', () => {
    for (const f of EXPECTED_AT_LEAST) {
      expect(
        CALLERS,
        `${f} calls resolveWaiverWindow but the scan did not find it — discovery is broken, ` +
          `so every rule in this file is passing vacuously.`,
      ).toContain(f);
    }
  });
});

/**
 * The year clocks that are correct for an MFL feed directory. `getAflLeagueYear`
 * is the AFL's (June 1); `getCurrentLeagueYear` / `getLeagueYearForSlug` /
 * `getRolloverLeagueYear` are the general ones. `claimLeagueYear` is the
 * free-agent pages' own already-correct derivation.
 */
const LEAGUE_YEAR_FNS = [
  'getAflLeagueYear',
  'getCurrentLeagueYear',
  'getLeagueYearForSlug',
  'getRolloverLeagueYear',
  'claimLeagueYear',
];

/** Read the balanced-paren argument text of every `resolveWaiverWindow(` call. */
function waiverCalls(source: string): string[] {
  const out: string[] = [];
  const needle = 'resolveWaiverWindow(';
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + needle.length - 1;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(source.slice(start + needle.length, i));
    from = i + 1;
  }
  return out;
}

describe('every production caller names its leagueZone', () => {
  it.each(CALLERS)('%s passes leagueClock(...).zone', (file) => {
    const source = readFileSync(file, 'utf8');
    const calls = waiverCalls(source);
    // A caller that stopped calling it is fine; a caller that calls it on the
    // Pacific fallback is not.
    expect(calls.length, `${file} no longer calls resolveWaiverWindow`).toBeGreaterThan(0);
    for (const args of calls) {
      expect(
        args,
        `${file} calls resolveWaiverWindow without naming its league's zone — it rides the ` +
          `registry's Pacific fallback, which is documented as being for a caller that CANNOT ` +
          `name its league. Pass leagueClock(<entry>.slug).zone as the third argument.`,
      ).toMatch(/leagueClock\(/);
    }
  });
});

/**
 * The year variable each page uses to pick its `calendar.json` out of the glob.
 *
 * Scoped to the CALENDAR glob rather than to any `/${year}/` module lookup:
 * these pages also glob the league export by year, and `players.astro` has a
 * generic `findForYear(modules, yr)` helper whose parameter is not a clock at
 * all. Matching those would make the guard noise.
 */
function calendarYearVars(source: string): string[] {
  const vars: string[] = [];
  // const <name> = import.meta.glob('.../mfl-feeds/<glob>/calendar.json', …)
  for (const m of source.matchAll(
    /const\s+(\w+)\s*=\s*import\.meta\.glob\(\s*'[^']*mfl-feeds\/[^']*calendar\.json'/g,
  )) {
    const modulesVar = m[1];
    // …then the entry picked out of THAT map, by year.
    const pick = new RegExp(
      `Object\\.(?:entries|keys)\\(${modulesVar}\\)[\\s\\S]{0,120}?\\.includes\\(\`\\/\\$\\{(\\w+)\\}\\/\`\\)`,
    ).exec(source);
    if (pick) vars.push(pick[1]);
  }
  return vars;
}

describe('the waiver calendar is selected on the LEAGUE year, never the season year', () => {
  const PAGES = CALLERS.filter((f) => f.endsWith('.astro'));

  it.each(PAGES)('%s keys its calendar lookup off a league-year clock', (file) => {
    const source = readFileSync(file, 'utf8');
    const picks = calendarYearVars(source);
    expect(
      picks.length,
      `${file}: no mfl-feeds calendar.json lookup found — has the pattern changed?`,
    ).toBeGreaterThan(0);

    for (const varName of picks) {
      const decl = new RegExp(`const\\s+${varName}\\s*=\\s*([\\w.]+)\\s*\\(`).exec(source);
      expect(decl, `${file}: could not find the declaration of \`${varName}\``).not.toBeNull();
      const fn = decl![1];
      expect(
        LEAGUE_YEAR_FNS,
        `${file}: the calendar lookup is keyed off \`${varName} = ${fn}(...)\`. ` +
          `data/<league>/mfl-feeds/<year>/calendar.json is keyed by MFL's LEAGUE year, ` +
          `not the season-results year — between the league rollover and Labor Day those ` +
          `disagree, and this reads a stale calendar or none at all. Use one of: ` +
          `${LEAGUE_YEAR_FNS.join(', ')}.`,
      ).toContain(fn);
    }
  });

  it('rejects getCurrentSeasonYear as a calendar key — the exact regression', () => {
    expect(LEAGUE_YEAR_FNS).not.toContain('getCurrentSeasonYear');
    for (const file of PAGES) {
      const source = readFileSync(file, 'utf8');
      for (const varName of calendarYearVars(source)) {
        const decl = new RegExp(`const\\s+${varName}\\s*=\\s*([\\w.]+)\\s*\\(`).exec(source);
        expect(decl?.[1], `${file}: \`${varName}\` is on the season clock`).not.toBe(
          'getCurrentSeasonYear',
        );
      }
    }
  });
});
