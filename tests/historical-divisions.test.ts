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
  aliasDivisionName,
  isUsableDivisionName,
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

// Every season the feeds describe, in-progress included.
const FEED_YEARS = readdirSync(FEEDS_DIR)
  .filter(d => /^\d{4}$/.test(d))
  .filter(y => existsSync(path.join(FEEDS_DIR, y, 'league.json')))
  .sort();

// Only seasons the ledger has crowned — the ledger comparison can't cover the
// in-progress year, which by design has no division winners yet.
const YEARS = FEED_YEARS.filter(y => [...LEDGER.keys()].some(k => k.startsWith(`${y}|`)));

describe('aliasDivisionName — one implementation, two callers', () => {
  // The standings pages and scripts/compute-franchise-history.mjs both resolve
  // division names. They used to be separate copies, free to drift on exactly
  // these edge cases; they now share src/utils/division-aliases.mjs. These pin
  // the behavior that has to stay identical.
  const ALIASES = { _comment: 'docs', Eastern: 'East' };

  it('maps an aliased name and passes anything else through', () => {
    expect(aliasDivisionName('Eastern', ALIASES)).toBe('East');
    expect(aliasDivisionName('Central', ALIASES)).toBe('Central');
  });

  it('is a no-op on the display name itself — no double-mapping', () => {
    expect(aliasDivisionName('East', ALIASES)).toBe('East');
  });

  it('trims, so padding cannot make the two callers disagree', () => {
    expect(aliasDivisionName('  Eastern  ', ALIASES)).toBe('East');
    expect(aliasDivisionName('  Central  ', ALIASES)).toBe('Central');
  });

  it('refuses metadata keys explicitly rather than by luck', () => {
    // A real division never starts with "_", so an underscore-leading input is
    // the JSON's _comment leaking in — it must not resolve to the comment text.
    expect(aliasDivisionName('_comment', ALIASES)).toBe('_comment');
  });

  it('survives null/undefined/non-string input without throwing', () => {
    expect(aliasDivisionName(undefined as never, ALIASES)).toBe('');
    expect(aliasDivisionName(null as never, ALIASES)).toBe('');
    expect(aliasDivisionName('Eastern', null)).toBe('Eastern');
    expect(aliasDivisionName('Eastern', undefined)).toBe('Eastern');
  });

  it('ignores an alias whose value is empty or blank', () => {
    expect(aliasDivisionName('Eastern', { Eastern: '   ' })).toBe('Eastern');
    expect(aliasDivisionName('Eastern', { Eastern: '' })).toBe('Eastern');
  });

  it('agrees with isUsableDivisionName on what to drop', () => {
    expect(isUsableDivisionName('East')).toBe(true);
    expect(isUsableDivisionName('   ')).toBe(false);
    expect(isUsableDivisionName('')).toBe(false);
    expect(isUsableDivisionName(undefined)).toBe(false);
    expect(isUsableDivisionName(42)).toBe(false);
  });
});

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

  it('dedupes divisions that share a name', () => {
    // getDivisionStandings maps over config.divisions, so a repeated name
    // renders the division twice with each block holding the union of both
    // divisions' teams. One MFL typo away, and league.json is refetched.
    const parsed = parseHistoricalDivisions({
      league: {
        divisions: { division: [{ id: '00', name: 'East' }, { id: '01', name: 'East' }] },
        franchises: {
          franchise: [{ id: '0001', division: '00' }, { id: '0002', division: '01' }],
        },
      },
    });
    expect(parsed?.divisions).toEqual(['East']);
  });

  it('orders numerically so unpadded ids do not sort 1, 10, 2', () => {
    const parsed = parseHistoricalDivisions({
      league: {
        divisions: {
          division: [
            { id: '10', name: 'Tenth' },
            { id: '2', name: 'Second' },
            { id: '1', name: 'First' },
          ],
        },
        franchises: {
          franchise: [
            { id: '0001', division: '1' },
            { id: '0002', division: '2' },
            { id: '0003', division: '10' },
          ],
        },
      },
    });
    expect(parsed?.divisions).toEqual(['First', 'Second', 'Tenth']);
  });

  it('unwraps a Vite glob namespace as well as a plain object', () => {
    const inner = {
      league: {
        divisions: { division: [{ id: '00', name: 'Solo' }] },
        franchises: { franchise: [{ id: '0001', division: '00' }] },
      },
    };
    expect(parseHistoricalDivisions({ default: inner })).toEqual(
      parseHistoricalDivisions(inner)
    );
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

  it('degrades instead of throwing on a config with no teams', () => {
    // The module header promises it never breaks a page; an .astro passing an
    // any-shaped config is the one route that could violate that.
    const feed = {
      league: {
        divisions: { division: [{ id: '00', name: 'Pacific' }] },
        franchises: { franchise: [{ id: '0001', division: '00' }] },
      },
    };
    expect(() => applyHistoricalDivisions({} as never, feed)).not.toThrow();
    expect(() => applyHistoricalDivisions(undefined as never, feed)).not.toThrow();
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

  it('keeps an omitted franchise VISIBLE, not just on the right division', () => {
    // The nastier half of the partial-feed case, and the one the test below
    // originally missed by landing on the empty-list fallback. Here the feed
    // names a real division (so `divisions` is non-empty) but omits one
    // franchise, which keeps its configured division. getDivisionStandings
    // filters on config.divisions, so if that leftover division isn't carried
    // through, the team silently disappears from the standings table.
    const config = {
      teams: [
        { franchiseId: '0001', division: 'Northwest' },
        { franchiseId: '0002', division: 'Central' },
      ],
      divisions: ['Northwest', 'Central'],
    };
    const applied = applyHistoricalDivisions(config, {
      league: {
        divisions: { division: [{ id: '00', name: 'Pacific' }] },
        franchises: { franchise: [{ id: '0002', division: '00' }] },
      },
    });
    expect(applied.teams.find(t => t.franchiseId === '0002')!.division).toBe('Pacific');
    expect(applied.teams.find(t => t.franchiseId === '0001')!.division).toBe('Northwest');
    // Both must be renderable — feed-named first, then the carried-over one.
    expect(applied.divisions).toEqual(['Pacific', 'Northwest']);
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
    // Regrouping by MFL's names means the table asks for badges by those names,
    // and the archives say "Eastern" where the display name is "East" — so a
    // broken alias silently un-badges seasons.
    //
    // Iterates FEED_YEARS, not YEARS: the in-progress season has no ledger
    // entry, so a YEARS loop skipped 2026 entirely — the one season whose
    // committed league.json still says "Eastern" and therefore the one that
    // most depends on the alias. It was excluded from exactly the guard
    // written to protect it.
    for (const year of FEED_YEARS) {
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
    // FEED_YEARS so the in-progress season is covered — see the badge test.
    const aliased = new Set<string>();
    for (const year of FEED_YEARS) {
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
