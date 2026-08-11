import { describe, it, expect } from 'vitest';
import {
  extractSeasonStructure,
  applySeasonStructure,
  type SeasonStructure,
} from '../src/utils/afl-structure';
import {
  getDivisionStandings,
  getConferenceStandings,
  getLeagueStandings,
} from '../src/utils/standings';
import type { StandingsFranchise } from '../src/types/standings';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import league2003 from '../data/afl-fantasy/mfl-feeds/2003/league.json';
import league2025 from '../data/afl-fantasy/mfl-feeds/2025/league.json';

// ---------------------------------------------------------------------------
// extractSeasonStructure
// ---------------------------------------------------------------------------

describe('extractSeasonStructure', () => {
  it('reads the six-division 2003 structure from the real feed', () => {
    const structure = extractSeasonStructure(league2003);
    expect(structure).not.toBeNull();
    expect(structure!.divisions.map((d) => d.name)).toEqual([
      'North',
      'Central',
      'South',
      'East',
      'West',
      'Pacific',
    ]);
    expect(structure!.conferences).toEqual([
      { id: '00', name: 'American League' },
      { id: '01', name: 'National League' },
    ]);
    // AL holds North/Central/South, NL holds East/West/Pacific
    expect(structure!.divisions.filter((d) => d.conferenceId === '00').map((d) => d.name)).toEqual(
      ['North', 'Central', 'South']
    );
    expect(structure!.divisions.filter((d) => d.conferenceId === '01').map((d) => d.name)).toEqual(
      ['East', 'West', 'Pacific']
    );
    // Every one of the 24 franchises is placed in a division
    expect(Object.keys(structure!.franchiseDivisions)).toHaveLength(24);
  });

  it('reads the four-division modern structure from the real 2025 feed', () => {
    const structure = extractSeasonStructure(league2025);
    expect(structure!.divisions.map((d) => d.name)).toEqual(['North', 'South', 'East', 'West']);
    expect(Object.keys(structure!.franchiseDivisions)).toHaveLength(24);
  });

  it('normalizes MFL single-object collections to arrays', () => {
    const structure = extractSeasonStructure({
      league: {
        divisions: { division: { id: '00', name: 'Solo', conference: '00' } },
        conferences: { conference: { id: '00', name: 'Only Conf' } },
        franchises: { franchise: { id: '0001', division: '00' } },
      },
    });
    expect(structure).toEqual({
      conferences: [{ id: '00', name: 'Only Conf' }],
      divisions: [{ id: '00', name: 'Solo', conferenceId: '00' }],
      franchiseDivisions: { '0001': '00' },
    });
  });

  it('returns null for missing/empty/malformed feeds', () => {
    expect(extractSeasonStructure(undefined)).toBeNull();
    expect(extractSeasonStructure({})).toBeNull();
    expect(extractSeasonStructure({ league: {} })).toBeNull();
    // Division missing a name — refuse to half-apply a structure
    expect(
      extractSeasonStructure({
        league: {
          divisions: { division: [{ id: '00' }] },
          franchises: { franchise: [{ id: '0001', division: '00' }] },
        },
      })
    ).toBeNull();
    // Franchises without division assignments
    expect(
      extractSeasonStructure({
        league: {
          divisions: { division: [{ id: '00', name: 'North', conference: '00' }] },
          franchises: { franchise: [{ id: '0001' }] },
        },
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applySeasonStructure
// ---------------------------------------------------------------------------

// Mirrors afl.config.json's current 4-division layout, shrunk to 12 teams.
const currentConfig = {
  divisions: ['North', 'South', 'East', 'West'],
  conferences: [
    { code: '00', name: 'American League', divisions: ['North', 'South'] },
    { code: '01', name: 'National League', divisions: ['East', 'West'] },
  ],
  divisionToConference: { North: '00', South: '00', East: '01', West: '01' },
  teams: [
    { franchiseId: '0001', name: 'T1', division: 'North', conference: '00' },
    { franchiseId: '0002', name: 'T2', division: 'North', conference: '00' },
    { franchiseId: '0003', name: 'T3', division: 'South', conference: '00' },
    { franchiseId: '0004', name: 'T4', division: 'South', conference: '00' },
    { franchiseId: '0005', name: 'T5', division: 'East', conference: '01' },
    { franchiseId: '0006', name: 'T6', division: 'East', conference: '01' },
    { franchiseId: '0007', name: 'T7', division: 'West', conference: '01' },
    { franchiseId: '0008', name: 'T8', division: 'West', conference: '01' },
    { franchiseId: '0009', name: 'T9', division: 'North', conference: '00' },
    { franchiseId: '0010', name: 'T10', division: 'South', conference: '00' },
    { franchiseId: '0011', name: 'T11', division: 'East', conference: '01' },
    { franchiseId: '0012', name: 'T12', division: 'West', conference: '01' },
  ],
};

// A 6-division historical season (2 teams per division) that scrambles the
// memberships relative to the current config.
const sixDivStructure: SeasonStructure = {
  conferences: [
    { id: '00', name: 'American League' },
    { id: '01', name: 'National League' },
  ],
  divisions: [
    { id: '00', name: 'North', conferenceId: '00' },
    { id: '01', name: 'Central', conferenceId: '00' },
    { id: '02', name: 'South', conferenceId: '00' },
    { id: '03', name: 'East', conferenceId: '01' },
    { id: '04', name: 'West', conferenceId: '01' },
    { id: '05', name: 'Pacific', conferenceId: '01' },
  ],
  franchiseDivisions: {
    '0001': '00',
    '0002': '00',
    '0003': '01',
    '0004': '01',
    '0005': '02',
    '0006': '02',
    '0007': '03',
    '0008': '03',
    '0009': '04',
    '0010': '04',
    '0011': '05',
    '0012': '05',
  },
};

describe('applySeasonStructure', () => {
  it('returns the config unchanged for a null structure', () => {
    expect(applySeasonStructure(currentConfig, null)).toBe(currentConfig);
  });

  it('rewrites divisions, conferences, divisionToConference, and team assignments', () => {
    const result = applySeasonStructure(currentConfig, sixDivStructure);

    expect(result.divisions).toEqual(['North', 'Central', 'South', 'East', 'West', 'Pacific']);
    expect(result.conferences).toEqual([
      { name: 'American League', code: '00', divisions: ['North', 'Central', 'South'] },
      { name: 'National League', code: '01', divisions: ['East', 'West', 'Pacific'] },
    ]);
    expect(result.divisionToConference).toEqual({
      North: '00',
      Central: '00',
      South: '00',
      East: '01',
      West: '01',
      Pacific: '01',
    });

    // 0005 played East in the current config but South in this season
    const t5 = result.teams.find((t) => t.franchiseId === '0005')!;
    expect(t5.division).toBe('South');
    expect(t5.conference).toBe('00');
    // 0011 moved from East to Pacific (NL both eras)
    const t11 = result.teams.find((t) => t.franchiseId === '0011')!;
    expect(t11.division).toBe('Pacific');
    expect(t11.conference).toBe('01');
    // Non-structure team fields survive untouched
    expect(t5.name).toBe('T5');
  });

  it('keeps the config division for a franchise the season feed does not place', () => {
    const partial: SeasonStructure = {
      ...sixDivStructure,
      franchiseDivisions: { '0001': '00' },
    };
    const result = applySeasonStructure(currentConfig, partial);
    expect(result.teams.find((t) => t.franchiseId === '0002')!.division).toBe('North');
    // Placed team still moves
    expect(result.teams.find((t) => t.franchiseId === '0001')!.division).toBe('North');
  });

  it('does not mutate the input config', () => {
    const before = JSON.stringify(currentConfig);
    applySeasonStructure(currentConfig, sixDivStructure);
    expect(JSON.stringify(currentConfig)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Integration: standings grouping with a season-resolved six-division config
// ---------------------------------------------------------------------------

function makeFranchise(id: string, wins: number, pf: string): StandingsFranchise {
  const losses = 13 - wins;
  return {
    id,
    fname: `Team ${id}`,
    divwlt: '0-0-0',
    divpct: '0',
    divw: '0',
    divl: '0',
    divt: '0',
    h2hwlt: `${wins}-${losses}-0`,
    h2hpct: String(wins / 13),
    h2hw: String(wins),
    h2hl: String(losses),
    h2ht: '0',
    nondivwlt: '0-0-0',
    nondivpct: '0',
    nondivw: '0',
    nondivl: '0',
    nondivt: '0',
    all_play_wlt: '50-50-0',
    all_play_pct: String(wins / 13),
    pf,
    pa: '1500',
    pwr: String(wins),
    pp: '0',
    vp: '0',
    op: '0',
    strk: 'W1',
    eliminated: '0',
  } as StandingsFranchise;
}

describe('standings grouping with a six-division season structure', () => {
  const seasonConfig = applySeasonStructure(currentConfig, sixDivStructure);
  // Wins descend with franchise number, so division winners are the odd slots
  // (each division holds consecutive ids: 0001/0002 North, 0003/0004 Central…).
  const franchises = Array.from({ length: 12 }, (_, i) =>
    makeFranchise(String(i + 1).padStart(4, '0'), 12 - i, String(2000 - i * 10))
  );

  it('groups division standings by the season structure in season order', () => {
    const divisions = getDivisionStandings(franchises, seasonConfig);
    expect(divisions.map((d) => d.name)).toEqual([
      'North',
      'Central',
      'South',
      'East',
      'West',
      'Pacific',
    ]);
    expect(divisions.find((d) => d.name === 'South')!.teams.map((t) => t.id)).toEqual([
      '0005',
      '0006',
    ]);
    expect(divisions.find((d) => d.name === 'Pacific')!.teams.map((t) => t.id)).toEqual([
      '0011',
      '0012',
    ]);
  });

  it('seeds all six division winners 1-6, remaining teams 7+', () => {
    const league = getLeagueStandings(franchises, seasonConfig);
    const winners = league.filter((t) => t.seed! <= 6).map((t) => t.id);
    // One winner per division: the better team of each consecutive pair
    expect(winners).toEqual(['0001', '0003', '0005', '0007', '0009', '0011']);
    // Best non-winner is 0002 (11 wins) and must be seeded 7, not 5
    expect(league.find((t) => t.id === '0002')!.seed).toBe(7);
    expect(league.map((t) => t.seed)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('builds conference standings with three division winners seeded 1-3', () => {
    const al = getConferenceStandings(franchises, seasonConfig, '00');
    expect(al.conference.divisions).toEqual(['North', 'Central', 'South']);
    expect(al.divisionWinners.map((t) => t.id)).toEqual(['0001', '0003', '0005']);
    expect(al.divisionWinners.map((t) => t.conferenceSeed)).toEqual([1, 2, 3]);
    // Wild cards seed after the three winners
    expect(al.wildCards[0].id).toBe('0002');
    expect(al.wildCards[0].conferenceSeed).toBe(4);

    const nl = getConferenceStandings(franchises, seasonConfig, '01');
    expect(nl.divisionWinners.map((t) => t.id)).toEqual(['0007', '0009', '0011']);
    expect(nl.allTeams).toHaveLength(6);
  });

  it('keeps the modern four-division behavior unchanged without a structure overlay', () => {
    const league = getLeagueStandings(franchises, currentConfig);
    const winners = league.filter((t) => t.seed! <= 4);
    expect(winners).toHaveLength(4);
    // First non-winner takes seed 5 exactly as before
    expect(league.find((t) => t.seed === 5)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getAllPlayStandings with a calculated all-play override (combined table for
// the 2016-2019 seasons, whose feeds carry no all_play fields)
// ---------------------------------------------------------------------------

describe('getAllPlayStandings with calculatedAllPlay override', () => {
  it('applies calculated records and sorts by them', async () => {
    const { getAllPlayStandings } = await import('../src/utils/standings');
    const franchises = [
      makeFranchise('0001', 8, '0'),
      makeFranchise('0002', 10, '0'),
    ];
    // Feed has no usable all-play; calculated map flips the win-based order
    const calculated = new Map([
      ['0001', { wins: 200, losses: 40, ties: 0, pf: 1800, pct: 0.833 }],
      ['0002', { wins: 100, losses: 140, ties: 0, pf: 1500, pct: 0.417 }],
    ]);
    const result = getAllPlayStandings(franchises, currentConfig, calculated);
    expect(result.map((t) => t.id)).toEqual(['0001', '0002']);
    expect(result[0].all_play_wlt).toBe('200-40-0');
    expect(result[0].all_play_pct).toBe('0.833');
  });
});

// ---------------------------------------------------------------------------
// preserveFeedOrder — MFL's official row order wins over the local tiebreaker
// ---------------------------------------------------------------------------

describe('preserveFeedOrder (MFL order is the source of truth)', () => {
  // Feed order deliberately CONTRADICTS every local tiebreaker metric: within
  // each division the first row has fewer wins, less PF, and worse divpct than
  // the second — the default path would flip them; preserveFeedOrder must not.
  const feed = [
    makeFranchise('0002', 8, '1500'), // North — feed says winner despite 8 wins
    makeFranchise('0001', 12, '2000'), // North — better on every local metric
    makeFranchise('0003', 11, '1900'), // South winner
    makeFranchise('0004', 6, '1300'),
    makeFranchise('0006', 7, '1400'), // East — feed says winner
    makeFranchise('0005', 10, '1800'), // East — better on every local metric
    makeFranchise('0007', 9, '1700'), // West winner
    makeFranchise('0008', 5, '1200'),
  ];
  const config = {
    ...currentConfig,
    teams: currentConfig.teams.filter((t) => Number(t.franchiseId) <= 8),
  };

  it('renders division rows in feed order, first row is the winner', () => {
    const divisions = getDivisionStandings(feed, config, { preserveFeedOrder: true });
    expect(divisions.find((d) => d.name === 'North')!.teams.map((t) => t.id)).toEqual([
      '0002',
      '0001',
    ]);
    expect(divisions.find((d) => d.name === 'East')!.teams.map((t) => t.id)).toEqual([
      '0006',
      '0005',
    ]);
  });

  it('seeds division winners from feed order, remaining teams by feed position', () => {
    const league = getLeagueStandings(feed, config, { preserveFeedOrder: true });
    const winners = league.filter((t) => t.seed! <= 4).map((t) => t.id);
    // One winner per division = first feed row of each division, ordered by
    // feed position: 0002 (North), 0003 (South), 0006 (East), 0007 (West).
    expect(winners).toEqual(['0002', '0003', '0006', '0007']);
    // Non-winners follow in feed order.
    expect(league.filter((t) => t.seed! > 4).map((t) => t.id)).toEqual([
      '0001',
      '0004',
      '0005',
      '0008',
    ]);
  });

  it('builds conference seeds from feed order', () => {
    const al = getConferenceStandings(feed, config, '00', { preserveFeedOrder: true });
    expect(al.divisionWinners.map((t) => t.id)).toEqual(['0002', '0003']);
    // Wild cards are the remaining conference teams in feed position order.
    expect(al.wildCards.map((t) => t.id)).toEqual(['0001', '0004']);
  });

  it('default path (no option) still applies the local tiebreaker — TheLeague unchanged', () => {
    const divisions = getDivisionStandings(feed, config);
    expect(divisions.find((d) => d.name === 'North')!.teams.map((t) => t.id)).toEqual([
      '0001',
      '0002',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Page wiring — every AFL surface that groups by division/conference must
// overlay the season's own structure, not just resolve identities.
// ---------------------------------------------------------------------------

describe('AFL pages overlay the season structure', () => {
  const ROOT = path.resolve(__dirname, '..');
  const AFL = getLeagueBySlug('afl-fantasy');
  const FEEDS = path.join(ROOT, AFL.dataPath, 'mfl-feeds');
  const aflConfig = JSON.parse(
    readFileSync(path.join(ROOT, AFL.dataPath, 'afl.config.json'), 'utf8')
  );
  const toArr = <T,>(v: T | T[] | null | undefined): T[] =>
    Array.isArray(v) ? v : v == null ? [] : [v];

  const YEARS = readdirSync(FEEDS)
    .filter(d => /^\d{4}$/.test(d))
    .filter(y => existsSync(path.join(FEEDS, y, 'league.json')))
    .filter(y => existsSync(path.join(FEEDS, y, 'standings.json')))
    .sort();

  const load = (year: string) => {
    const league = JSON.parse(readFileSync(path.join(FEEDS, year, 'league.json'), 'utf8'));
    const rows = toArr<any>(
      JSON.parse(readFileSync(path.join(FEEDS, year, 'standings.json'), 'utf8'))
        ?.leagueStandings?.franchise
    );
    return { league, rows };
  };

  // Truth: the first feed row within each division as THAT season defined it.
  const truthFor = (league: any, rows: any[]) => {
    const nameById = new Map(
      toArr<any>(league.league.divisions.division).map((d: any) => [String(d.id), d.name])
    );
    const divisionOf = new Map(
      toArr<any>(league.league.franchises.franchise).map((f: any) => [
        f.id,
        nameById.get(String(f.division)),
      ])
    );
    const names = [...new Set(nameById.values())] as string[];
    return new Map(names.map(n => [n, rows.find(r => divisionOf.get(r.id) === n)?.id]));
  };

  it('covers every committed AFL season', () => {
    expect(YEARS.length).toBeGreaterThanOrEqual(20);
  });

  it('reproduces every season’s real division winners once overlaid', () => {
    let checked = 0;
    for (const year of YEARS) {
      const { league, rows } = load(year);
      if (!rows.length) continue;
      const config = applySeasonStructure(aflConfig, extractSeasonStructure(league));
      const rendered = new Map(
        getDivisionStandings(rows, config as any, { preserveFeedOrder: true }).map(d => [
          d.name,
          d.teams[0]?.id,
        ])
      );
      for (const [division, winner] of truthFor(league, rows)) {
        expect(rendered.get(division), `${year} ${division}`).toBe(winner);
        checked++;
      }
    }
    // 116 division-seasons across 2003-2026 — six divisions through 2012.
    expect(checked).toBeGreaterThanOrEqual(116);
  });

  it('WOULD fail without the overlay — proving the assertion has teeth', () => {
    // Today's four-division map can't even name Central or Pacific, so the
    // 2003-2012 era loses two races a year outright on top of mis-grouping.
    let wrong = 0;
    for (const year of YEARS) {
      const { league, rows } = load(year);
      if (!rows.length) continue;
      const rendered = new Map(
        getDivisionStandings(rows, aflConfig as any, { preserveFeedOrder: true }).map(d => [
          d.name,
          d.teams[0]?.id,
        ])
      );
      for (const [division, winner] of truthFor(league, rows)) {
        if (rendered.get(division) !== winner) wrong++;
      }
    }
    expect(wrong).toBeGreaterThan(0);
  });

  it('wires the overlay into BOTH the standings and playoffs pages', () => {
    // The helper existing is not the same as a page using it: /afl-fantasy/
    // playoffs resolved identities but never overlaid the structure, so it
    // seeded 12 conference-seasons differently than /afl-fantasy/standings did
    // for the same year. A source check is the only thing that catches a page
    // silently dropping the call.
    for (const page of ['standings', 'playoffs']) {
      const src = readFileSync(path.join(ROOT, 'src/pages/afl-fantasy', `${page}.astro`), 'utf8');
      expect(src, `${page}.astro must import the overlay`).toContain('extractSeasonStructure');
      expect(src, `${page}.astro must apply the overlay`).toContain('applySeasonStructure');
      // ...and must not hand the un-overlaid config to a grouping function.
      expect(
        /get(Conference|Division)Standings\(\s*franchises,\s*yearResolvedConfig/.test(src),
        `${page}.astro groups with the un-overlaid config`
      ).toBe(false);
    }
  });
});
