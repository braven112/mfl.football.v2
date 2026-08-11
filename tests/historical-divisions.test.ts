/**
 * Historical division alignment — a season is grouped by ITS OWN league.json,
 * not by today's division map.
 *
 * `resolveConfigForYear` resolves a franchise's historical name/icon/banner/
 * conference but NOT its division, and every standings surface groups on
 * `getTeamConfig(...).division`. So an archived season rendered with the
 * current alignment: 21 of 76 TheLeague division-seasons (every year from 2007
 * through 2015) showed a different winner on /theleague/standings than the same
 * season's entry in franchise-history.json, and 2007-2010 invented divisions
 * the league didn't have that year (it ran Pacific/Midwest/Central/Atlantic).
 *
 * The sharpest case is 2015 Central, the very season used to prove MFL's row
 * order is authoritative: the page credited The Executioners because it had put
 * the wrong teams in the Central to begin with, while the franchise pages
 * correctly credited Amish Rakefighters.
 *
 * These tests lock the two surfaces together — the page's division winner must
 * equal the ledger's for every division-season on record.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  parseHistoricalDivisions,
  applyHistoricalDivisions,
} from '../src/utils/historical-divisions';
import { resolveConfigForYear } from '../src/utils/team-names';
import { getDivisionStandings } from '../src/utils/standings';
import { DIVISION_BADGES } from '../src/components/theleague/standings/standings-table-config';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import leagueConfig from '../src/data/theleague.config.json';
import franchiseHistory from '../data/theleague/derived/franchise-history.json';

const THELEAGUE = getLeagueBySlug('theleague');
const ROOT = path.resolve(__dirname, '..');
const FEEDS_DIR = path.join(ROOT, THELEAGUE.dataPath, 'mfl-feeds');

const readFeed = (year: string, file: string) => {
  const p = path.join(FEEDS_DIR, year, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

// year|divisionName -> winning franchise id, straight from the committed ledger.
const LEDGER = new Map<string, string>();
for (const summary of (franchiseHistory as any).yearSummaries ?? []) {
  for (const winner of summary.divisionWinners ?? []) {
    LEDGER.set(`${summary.year}|${winner.divisionName}`, winner.sourceFranchiseId);
  }
}

const YEARS = readdirSync(FEEDS_DIR)
  .filter(d => /^\d{4}$/.test(d))
  .sort()
  .filter(y => [...LEDGER.keys()].some(k => k.startsWith(`${y}|`)));

describe('parseHistoricalDivisions', () => {
  it('reads the per-season map out of a real league.json', () => {
    const parsed = parseHistoricalDivisions(readFeed('2007', 'league.json'));
    // 2007 ran divisions that do not exist in today's config at all.
    expect(parsed?.divisions).toEqual(['Pacific', 'Midwest', 'Central', 'Atlantic']);
    expect(Object.keys(parsed!.byFranchiseId)).toHaveLength(16);
  });

  it('orders divisions by MFL division id, not alphabetically', () => {
    const parsed = parseHistoricalDivisions(readFeed('2025', 'league.json'));
    // Assert ORDER, not the fourth name: MFL was renamed "Eastern" -> "East" in
    // Aug 2026, and roster-sync refetches league.json, so pinning the spelling
    // here would break the day an archive year gets refreshed.
    expect(parsed?.divisions.slice(0, 3)).toEqual(['Northwest', 'Southwest', 'Central']);
    expect(parsed?.divisions).toHaveLength(4);
  });

  // Alias behavior is pinned against synthetic feeds so it stays true no matter
  // which spelling the committed archives currently carry.
  const feedNamed = (fourth: string) => ({
    league: {
      divisions: { division: [{ id: '00', name: 'Northwest' }, { id: '03', name: fourth }] },
      franchises: { franchise: [{ id: '0001', division: '00' }, { id: '0009', division: '03' }] },
    },
  });

  it('applies the display alias when one is supplied', () => {
    const parsed = parseHistoricalDivisions(feedNamed('Eastern'), { Eastern: 'East' });
    expect(parsed?.divisions).toEqual(['Northwest', 'East']);
    expect(parsed?.byFranchiseId['0009']).toBe('East');
  });

  it('is a no-op once MFL itself says "East" — the live path since Aug 2026', () => {
    const parsed = parseHistoricalDivisions(feedNamed('East'), { Eastern: 'East' });
    expect(parsed?.divisions).toEqual(['Northwest', 'East']);
    expect(parsed?.byFranchiseId['0009']).toBe('East');
  });

  it('ignores the JSON _comment key rather than treating it as an alias', () => {
    const parsed = parseHistoricalDivisions(feedNamed('Eastern'), {
      _comment: 'docs',
      Eastern: 'East',
    } as Record<string, string>);
    expect(parsed?.divisions).toEqual(['Northwest', 'East']);
  });

  it('returns null for anything unusable rather than throwing', () => {
    expect(parseHistoricalDivisions(undefined)).toBeNull();
    expect(parseHistoricalDivisions(null)).toBeNull();
    expect(parseHistoricalDivisions({})).toBeNull();
    expect(parseHistoricalDivisions({ error: 'nope' })).toBeNull();
    expect(parseHistoricalDivisions({ league: {} })).toBeNull();
    // Divisions but no franchises, and franchises but no divisions.
    expect(
      parseHistoricalDivisions({ league: { divisions: { division: [{ id: '00', name: 'A' }] } } })
    ).toBeNull();
    expect(
      parseHistoricalDivisions({ league: { franchises: { franchise: [{ id: '0001', division: '00' }] } } })
    ).toBeNull();
  });

  it('tolerates MFL single-element collapse (object instead of array)', () => {
    const parsed = parseHistoricalDivisions({
      league: {
        divisions: { division: { id: '00', name: 'Solo' } },
        franchises: { franchise: { id: '0001', division: '00' } },
      },
    });
    expect(parsed).toEqual({ divisions: ['Solo'], byFranchiseId: { '0001': 'Solo' } });
  });
});

describe('applyHistoricalDivisions', () => {
  it('leaves the config untouched when the feed is unusable', () => {
    const config = resolveConfigForYear(leagueConfig as any, 2015);
    expect(applyHistoricalDivisions(config, null)).toBe(config);
    expect(applyHistoricalDivisions(config, { error: 'x' })).toBe(config);
  });

  it('keeps a franchise the feed omits on its configured division', () => {
    const config = { teams: [{ franchiseId: '0001', division: 'Northwest' }], divisions: ['Northwest'] };
    const applied = applyHistoricalDivisions(config, {
      league: {
        divisions: { division: [{ id: '00', name: 'Pacific' }] },
        franchises: { franchise: [{ id: '0002', division: '00' }] },
      },
    });
    // 0001 isn't in the feed — it must not be dropped or blanked.
    expect(applied.teams[0].division).toBe('Northwest');
  });

  it('drops divisions with no teams in them this season', () => {
    const config = { teams: [{ franchiseId: '0001', division: 'X' }], divisions: ['X'] };
    const applied = applyHistoricalDivisions(config, {
      league: {
        divisions: { division: [{ id: '00', name: 'Used' }, { id: '01', name: 'Empty' }] },
        franchises: { franchise: [{ id: '0001', division: '00' }] },
      },
    });
    expect(applied.divisions).toEqual(['Used']);
  });
});

describe('the standings page agrees with franchise history, every season', () => {
  it('covers every division-season in the ledger', () => {
    expect(YEARS.length).toBeGreaterThanOrEqual(19);
  });

  it.each(YEARS)('%s division winners match the ledger', year => {
    const standings = readFeed(year, 'standings.json');
    const league = readFeed(year, 'league.json');
    const rows = standings?.leagueStandings?.franchise;
    expect(rows, `${year} has no standings rows`).toBeTruthy();

    const config = applyHistoricalDivisions(
      resolveConfigForYear(leagueConfig as any, Number(year)),
      league
    );
    const divisions = getDivisionStandings(rows, config as any, { preserveFeedOrder: true });

    // Four divisions, named as that season named them.
    expect(divisions).toHaveLength(4);
    for (const division of divisions) {
      const expected = LEDGER.get(`${year}|${division.name}`);
      expect(
        expected,
        `${year} ${division.name} is not a division the ledger knows about`
      ).toBeTruthy();
      expect(
        division.teams[0]?.id,
        `${year} ${division.name}: standings page disagrees with franchise history`
      ).toBe(expected);
    }
  });

  it('would FAIL without the fix — proving these assertions have teeth', () => {
    // Same comparison using only resolveConfigForYear (the pre-fix path).
    // 21 of 76 division-seasons disagreed; if this ever drops to zero the
    // config has drifted to match every historical alignment and the helper
    // is no longer load-bearing (or the test stopped testing anything).
    let disagreements = 0;
    for (const year of YEARS) {
      const rows = readFeed(year, 'standings.json')?.leagueStandings?.franchise;
      if (!rows) continue;
      const stale = getDivisionStandings(
        rows,
        resolveConfigForYear(leagueConfig as any, Number(year)) as any,
        { preserveFeedOrder: true }
      );
      for (const division of stale) {
        if (LEDGER.get(`${year}|${division.name}`) !== division.teams[0]?.id) disagreements++;
      }
    }
    expect(disagreements).toBeGreaterThan(0);
  });

  it('has badge artwork for every division rendered from 2011 on', () => {
    // Regrouping by MFL's names means the table asks for badges by those names.
    // MFL says "Eastern" where the config says "East", so a map missing either
    // spelling silently un-badges seasons — including the current one.
    for (const year of YEARS) {
      if (Number(year) < 2011) continue; // Pacific/Midwest/Atlantic are retired
      const rows = readFeed(year, 'standings.json')?.leagueStandings?.franchise;
      if (!rows) continue;
      const config = applyHistoricalDivisions(
        resolveConfigForYear(leagueConfig as any, Number(year)),
        readFeed(year, 'league.json')
      );
      for (const division of getDivisionStandings(rows, config as any, {
        preserveFeedOrder: true,
      })) {
        expect(
          DIVISION_BADGES[division.name],
          `${year} ${division.name} has no badge artwork`
        ).toBeTruthy();
      }
    }
  });

  it('never renders MFL’s "Eastern" — the league displays "East"', () => {
    // Commissioner, 2026-08-11: "East" is the display name. The archived feeds
    // say "Eastern" from 2012 on and will keep saying it even after MFL is
    // renamed, so divisionAliases is permanently load-bearing. If this fails,
    // the badge lookup breaks too (DIVISION_BADGES only keys "East").
    const aliased = new Set<string>();
    for (const year of YEARS) {
      const rows = readFeed(year, 'standings.json')?.leagueStandings?.franchise;
      if (!rows) continue;
      const config = applyHistoricalDivisions(
        resolveConfigForYear(leagueConfig as any, Number(year)),
        readFeed(year, 'league.json')
      );
      for (const division of getDivisionStandings(rows, config as any, {
        preserveFeedOrder: true,
      })) {
        expect(division.name, `${year} still renders MFL's raw name`).not.toBe('Eastern');
        aliased.add(division.name);
      }
    }
    // Sanity: the alias actually fired rather than the loop finding nothing.
    expect(aliased).toContain('East');
  });

  it('keeps the ledger and the pages on the same division vocabulary', () => {
    // The franchise-history script applies the same divisionAliases map, so a
    // name the pages render must exist in the ledger and vice versa.
    const ledgerNames = new Set([...LEDGER.keys()].map(k => k.split('|')[1]));
    expect(ledgerNames).not.toContain('Eastern');
    expect(ledgerNames).toContain('East');
  });

  it('leaves retired divisions unbadged so they fall back to a plain header', () => {
    // Deliberate: there is no Pacific/Midwest/Atlantic artwork, and inventing a
    // mapping to a modern compass badge would mislabel them.
    for (const retired of ['Pacific', 'Midwest', 'Atlantic']) {
      expect(DIVISION_BADGES[retired]).toBeUndefined();
    }
  });

  it('fixes 2015 Central specifically — the case that proved MFL is authoritative', () => {
    const rows = readFeed('2015', 'standings.json').leagueStandings.franchise;
    const config = applyHistoricalDivisions(
      resolveConfigForYear(leagueConfig as any, 2015),
      readFeed('2015', 'league.json')
    );
    const central = getDivisionStandings(rows, config as any, { preserveFeedOrder: true }).find(
      d => d.name === 'Central'
    );
    expect(central?.teams[0]?.teamName).toBe('Amish Rakefighters');
  });
});
