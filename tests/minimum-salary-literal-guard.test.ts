import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, walkFiles } from './helpers/scan-guard';
import { stripComments } from './helpers/js-source';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { leagueMinimumSalary } from '../src/config/leagues';

/**
 * TheLeague's minimum salary lives in ONE place: `minimumSalary` on its
 * registry entry (src/config/leagues-data.mjs), read through
 * `leagueMinimumSalary(slug)` in app code.
 *
 * Why it is pinned: the hotfix that put it there (#1311) found ~17 files each
 * carrying their own `425000`. The waiver-pickups column priced a
 * first-come-first-served add at $0 because the one place that needed the
 * minimum had no copy of it — and a figure kept in seventeen places is a
 * figure that changes in sixteen (#1312 F1).
 *
 * Scope: code only. Comments are blanked first (`stripComments`, which tracks
 * string literals, so a `//` inside a URL string is not mistaken for one),
 * because comments quote MFL's own transaction strings ("8838|425000|0000")
 * and error text ("below bid minimum ($425000)") verbatim, and a guard that
 * forced rewording those would be policing prose. League-rule PROSE (the
 * constitution, /rules) writes "$425,000" and is not matched.
 */
const MINIMUM_LITERAL = /\b425_?000\b/;

const ALLOWLIST: Record<string, string> = {
  'src/config/leagues-data.mjs': 'The registry — the one home of minimumSalary.',
  'scripts/lib/rookie-salary-slots.mjs':
    'Rookie slot table DATA (the constitution schedule) whose cheapest slots equal the minimum; its lookup fallbacks read ROOKIE_SALARY_FLOOR.',
  'scripts/fix-season-salaries.mjs':
    "One-off historical correction table of specific players' recorded salaries, not the rule.",
  'scripts/demo/lib/simulate.mjs':
    "The demo league's own rule table (LEAGUE_RULES.minSalary) — a fictional league's rules, read everywhere else in that file through the table.",
};

/** `path:line  text` for every literal left once comments are blanked. */
function literalsIn(file: string): string[] {
  const raw = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const rawLines = raw.split('\n');
  // stripComments preserves length and newlines, so line numbers still match.
  return stripComments(raw)
    .split('\n')
    .flatMap((line, i) => (MINIMUM_LITERAL.test(line) ? [`${file}:${i + 1}  ${rawLines[i].trim()}`] : []));
}

const hasLiteral = (src: string) => MINIMUM_LITERAL.test(stripComments(src));

describe('league minimum salary has one home', () => {
  it('no bare 425000 / 425_000 outside the registry', () => {
    const hits = walkFiles({ roots: ['src', 'scripts'], extensions: ['.ts', '.tsx', '.mjs', '.js', '.astro'] })
      .filter((f) => !(f in ALLOWLIST))
      .flatMap(literalsIn);
    expect(
      hits,
      `Read the league minimum from the registry (leagueMinimumSalary / LEAGUES.<slug>.minimumSalary), never a bare 425000:\n${hits.join('\n')}`,
    ).toEqual([]);
  });

  it('every allowlist entry is still used (a stale exemption silently widens the guard)', () => {
    expect(Object.keys(ALLOWLIST).filter((f) => literalsIn(f).length === 0)).toEqual([]);
  });

  it('catches a literal after a URL in a string, and ignores one quoted in a comment', () => {
    expect(hasLiteral("const u = 'https://x.test/import?SALARY=425000';")).toBe(true);
    expect(hasLiteral('const u = `https://x.test/${a}`; const min = 425_000;')).toBe(true);
    expect(hasLiteral('// MFL wrote "8838|425000|0000"\nconst x = 1;')).toBe(false);
    expect(hasLiteral('const x = 1; /* below bid minimum ($425000) */')).toBe(false);
  });

  it('the accessor answers TheLeague and refuses a league without salaries', () => {
    expect(leagueMinimumSalary(LEAGUES.theleague.slug)).toBe(LEAGUES.theleague.minimumSalary);
    expect(() => leagueMinimumSalary(LEAGUES['afl-fantasy'].slug)).toThrow(/no minimumSalary/);
  });
});
