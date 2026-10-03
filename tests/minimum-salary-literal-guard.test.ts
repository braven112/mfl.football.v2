import { describe, expect, it } from 'vitest';
import { expectClean, scanForbidden } from './helpers/scan-guard';
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
 * Scope: code only. Comments are exempt structurally, because they quote MFL's
 * own transaction strings ("8838|425000|0000") and error text ("below bid
 * minimum ($425000)") verbatim, and a guard that forced rewording those would be
 * policing prose. League-rule PROSE (the constitution, /rules) writes "$425,000"
 * and is not matched.
 */
const isComment = (line: string, match: string): boolean => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return true;
  const slashes = line.indexOf('//');
  return slashes !== -1 && slashes < line.indexOf(match);
};

describe('league minimum salary has one home', () => {
  it('no bare 425000 / 425_000 outside the registry', () => {
    const result = scanForbidden({
      roots: ['src', 'scripts'],
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.astro'],
      forbidden: [{ name: 'minimum-salary literal', pattern: /\b425_?000\b/ }],
      exempt: ({ line, match }) => isComment(line, match),
      allowlist: [
        { file: 'src/config/leagues-data.mjs', reason: 'The registry — the one home of minimumSalary.' },
        {
          file: 'scripts/lib/rookie-salary-slots.mjs',
          reason: 'Rookie slot table DATA (constitution schedule) whose cheapest slots equal the minimum; the lookup fallbacks read ROOKIE_SALARY_FLOOR.',
        },
        {
          file: 'scripts/fix-season-salaries.mjs',
          reason: 'One-off historical correction table of specific players\' recorded salaries, not the rule.',
        },
        {
          file: 'scripts/demo/lib/simulate.mjs',
          reason: 'The demo league\'s own rule table (LEAGUE_RULES.minSalary) — a fictional league\'s rules, read everywhere else in the file through that table.',
        },
      ],
    });
    expectClean(result, 'Read the league minimum from the registry (leagueMinimumSalary / LEAGUES.<slug>.minimumSalary), never a bare 425000');
  });

  it('the accessor answers TheLeague and refuses a league without salaries', () => {
    expect(leagueMinimumSalary(LEAGUES.theleague.slug)).toBe(LEAGUES.theleague.minimumSalary);
    expect(() => leagueMinimumSalary(LEAGUES['afl-fantasy'].slug)).toThrow(/no minimumSalary/);
  });
});
