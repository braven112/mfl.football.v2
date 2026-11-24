/**
 * The AFL's competition (Premier League / D-League) has ONE master:
 * data/afl-fantasy/competition-history.json, read through
 * src/utils/afl-competition.ts (getTeamCompetition / getCompetitionMembership).
 *
 * Nov 2026: the homepage standings card read a `competition` field off
 * afl.config.json, which nobody rolled over each season, so ten teams showed in
 * last year's league while the standings page (reading the history) had them
 * right. Brandon's rule: one settings file is the master, never a second copy.
 * This test fails if a `competition` field comes back on any AFL team in the
 * settings files, or if code reads one off an AFL team object again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { getTeamCompetition, getCurrentCompetitionMembership } from '../src/utils/afl-competition';

const SETTINGS = [
  'data/afl-fantasy/config.json',
  'data/afl-fantasy/afl.config.json',
  'data/afl-fantasy/afl.assets.json',
];

describe('AFL competition has one master', () => {
  it.each(SETTINGS)('%s carries no competition field on any team', (file) => {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const withField = (data.teams ?? [])
      .filter((t: Record<string, unknown>) => 'competition' in t)
      .map((t: Record<string, unknown>) => t.franchiseId ?? t.id ?? t.name);
    expect(withField).toEqual([]);
  });

  it('every current AFL team has a competition in the history', () => {
    const teams = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf8')).teams;
    const membership = getCurrentCompetitionMembership() ?? {};
    const missing = teams.map((t: { franchiseId: string }) => t.franchiseId).filter((id: string) => !membership[id]);
    expect(missing).toEqual([]);
    expect(getTeamCompetition('12')).toBe(getTeamCompetition('0012'));
  });

  it('no AFL source reads a competition off a team object', () => {
    // AFL surfaces only; the keeper demo and the big-league demo carry their own
    // generated configs and are allowed their field.
    const hits = execSync(
      "git grep -nE '(team|Team|userTeam|asset|brand)\\??\\.competition\\b' -- " +
        "'src/components/afl' 'src/components/afl-fantasy' 'src/pages/afl-fantasy' 'src/utils/afl-*' " +
        "'src/utils/live/league-live-standings.ts' 'src/utils/team-preferences.ts' " +
        "'scripts/compute-afl-competition-movement.mjs' 'scripts/sync-afl-assets.mjs' || true",
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      ;
    expect(hits).toEqual([]);
  });

  it('the Schefter rumor scan takes each team\'s competition from the history', () => {
    const src = readFileSync('scripts/schefter-rumor-scan.mjs', 'utf8');
    expect(src).toContain("'competition-history.json'");
    expect(src).toMatch(/competition:\s*membership\[t\.franchiseId\]/);
    expect(src).not.toMatch(/competition:\s*t\.competition/);
  });
});

describe("standings turn over on each league's own start-of-season date", () => {
  it('standings season follows the AFL league year, not Labor Day', async () => {
    const { getStandingsSeasonYear } = await import('../src/utils/league-year');
    // After the season ends, before June 1: still the finished season.
    expect(getStandingsSeasonYear('afl-fantasy', new Date('2027-03-15T12:00:00-08:00'))).toBe(2026);
    // From June 1: the new season (0-0 until Week 1), months before Labor Day.
    expect(getStandingsSeasonYear('afl-fantasy', new Date('2027-06-02T12:00:00-07:00'))).toBe(2027);
    // TheLeague turns over on ITS start-of-season date, after Feb 14 8:45 PM PT.
    expect(getStandingsSeasonYear('theleague', new Date('2027-02-14T12:00:00-08:00'))).toBe(2026);
    expect(getStandingsSeasonYear('theleague', new Date('2027-02-15T12:00:00-08:00'))).toBe(2027);
  });
});
