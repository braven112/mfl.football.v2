import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  buildLineupWarnings,
  buildPlayerIndex,
  composePost,
  fallbackIntro,
  formatPlayerName,
  formatWarningLine,
  normalizeInjuryStatus,
  parseByeTeams,
  parseFranchiseNames,
  parseInjuries,
  parseRequiredStarters,
  parseStartingLineups,
  MAX_POST_CHARS,
} from '../scripts/lib/lineup-warnings.mjs';

/**
 * Unit coverage for the pure flagging pipeline behind the Sunday pre-kickoff
 * Schefter lineup check (scripts/schefter-lineup-check.mjs). All fixtures
 * mirror real MFL export shapes, including the single-object-vs-array
 * coalescing MFL is famous for.
 */

// ── Fixture builders ────────────────────────────────────────────────────────

const playersJson = {
  players: {
    player: [
      { id: '100', name: 'Brady, Tom', position: 'QB', team: 'NE' },
      { id: '200', name: 'Chubb, Nick', position: 'RB', team: 'CLE' },
      { id: '300', name: 'Hill, Tyreek', position: 'WR', team: 'MIA' },
      { id: '400', name: 'Kelce, Travis', position: 'TE', team: 'KC' },
      { id: '500', name: 'Tucker, Justin', position: 'PK', team: 'BAL' },
      { id: '600', name: 'Watt, TJ', position: 'LB', team: 'PIT' },
    ],
  },
};

const players = buildPlayerIndex(playersJson);

function lineupsOf(...entries: Array<[string, string[]]>) {
  return entries.map(([franchiseId, starters]) => ({ franchiseId, starters }));
}

// ── normalizeInjuryStatus ───────────────────────────────────────────────────

describe('normalizeInjuryStatus', () => {
  it('normalizes the canonical statuses', () => {
    expect(normalizeInjuryStatus('Out')).toBe('Out');
    expect(normalizeInjuryStatus('out')).toBe('Out');
    expect(normalizeInjuryStatus('O')).toBe('Out');
    expect(normalizeInjuryStatus('IR')).toBe('IR');
    expect(normalizeInjuryStatus('Injured Reserve')).toBe('IR');
    expect(normalizeInjuryStatus('Questionable')).toBe('Questionable');
    expect(normalizeInjuryStatus('Suspended')).toBe('Suspended');
  });

  it('maps IR variants (IR-PUP, IR-R, IR-NFI) to IR', () => {
    expect(normalizeInjuryStatus('IR-PUP')).toBe('IR');
    expect(normalizeInjuryStatus('IR-R')).toBe('IR');
    expect(normalizeInjuryStatus('ir-nfi')).toBe('IR');
  });

  it('treats unknown/empty statuses as Healthy', () => {
    expect(normalizeInjuryStatus('')).toBe('Healthy');
    expect(normalizeInjuryStatus(undefined)).toBe('Healthy');
    expect(normalizeInjuryStatus('Probable')).toBe('Healthy');
  });
});

// ── formatPlayerName / buildPlayerIndex ─────────────────────────────────────

describe('formatPlayerName', () => {
  it('flips "Last, First" to "First Last"', () => {
    expect(formatPlayerName('Brady, Tom')).toBe('Tom Brady');
  });

  it('passes through comma-less names', () => {
    expect(formatPlayerName('Bills, Buffalo')).toBe('Buffalo Bills');
    expect(formatPlayerName('Taysom Hill')).toBe('Taysom Hill');
  });
});

describe('buildPlayerIndex', () => {
  it('indexes by id with flipped names', () => {
    expect(players.get('100')).toEqual({ name: 'Tom Brady', position: 'QB', team: 'NE' });
  });

  it('handles a single-object player entry', () => {
    const idx = buildPlayerIndex({ players: { player: { id: '9', name: 'Solo, Han', position: 'QB', team: 'SF' } } });
    expect(idx.get('9')?.name).toBe('Han Solo');
  });

  it('returns an empty index for missing payloads', () => {
    expect(buildPlayerIndex(undefined).size).toBe(0);
    expect(buildPlayerIndex({}).size).toBe(0);
  });
});

// ── parseStartingLineups ────────────────────────────────────────────────────

describe('parseStartingLineups', () => {
  it('extracts starters per franchise across matchups', () => {
    const wr = {
      weeklyResults: {
        week: '7',
        matchup: [
          {
            franchise: [
              { id: '0001', player: [
                { id: '100', status: 'starter' },
                { id: '200', status: 'nonstarter' },
              ] },
              { id: '0002', player: [{ id: '300', status: 'starter' }] },
            ],
          },
          {
            franchise: [
              { id: '0003', player: { id: '400', status: 'starter' } },
              { id: '0004' },
            ],
          },
        ],
      },
    };
    const lineups = parseStartingLineups(wr);
    expect(lineups).toEqual([
      { franchiseId: '0001', starters: ['100'] },
      { franchiseId: '0002', starters: ['300'] },
      { franchiseId: '0003', starters: ['400'] },
      { franchiseId: '0004', starters: [] },
    ]);
  });

  it('handles a single-object matchup and franchises outside matchups (playoff byes)', () => {
    const wr = {
      weeklyResults: {
        matchup: { franchise: { id: '0001', player: { id: '100', status: 'starter' } } },
        franchise: { id: '0005', player: [{ id: '500', status: 'starter' }] },
      },
    };
    const lineups = parseStartingLineups(wr);
    expect(lineups.map((l) => l.franchiseId).sort()).toEqual(['0001', '0005']);
  });

  it('returns [] for empty/missing payloads', () => {
    expect(parseStartingLineups(undefined)).toEqual([]);
    expect(parseStartingLineups({})).toEqual([]);
    expect(parseStartingLineups({ weeklyResults: {} })).toEqual([]);
  });
});

// ── parseInjuries ───────────────────────────────────────────────────────────

describe('parseInjuries', () => {
  it('parses the raw MFL export shape and normalizes statuses', () => {
    const map = parseInjuries({
      injuries: { injury: [
        { id: '100', status: 'Out' },
        { id: '200', status: 'IR-R' },
        { id: '300', status: 'Questionable' },
      ] },
    });
    expect(map.get('100')).toBe('Out');
    expect(map.get('200')).toBe('IR');
    expect(map.get('300')).toBe('Questionable');
  });

  it('parses the committed-feed shape (already normalized)', () => {
    const map = parseInjuries({
      injuries: {
        '100': { injuryStatus: 'Out', injuryBodyPart: 'Knee' },
        '200': { injuryStatus: 'IR' },
      },
    });
    expect(map.get('100')).toBe('Out');
    expect(map.get('200')).toBe('IR');
  });

  it('returns an empty map for missing payloads', () => {
    expect(parseInjuries(undefined).size).toBe(0);
    expect(parseInjuries({}).size).toBe(0);
  });
});

// ── parseByeTeams ───────────────────────────────────────────────────────────

describe('parseByeTeams', () => {
  const byeJson = {
    nflByeWeeks: { team: [
      { id: 'MIA', bye_week: '7' },
      { id: 'KC', bye_week: '10' },
      { id: 'CLE', bye_week: '7' },
    ] },
  };

  it('returns only teams on bye in the given week', () => {
    const set = parseByeTeams(byeJson, 7);
    expect(set).toEqual(new Set(['MIA', 'CLE']));
  });

  it('accepts week as a string (MFL loves strings)', () => {
    expect(parseByeTeams(byeJson, '10' as unknown as number)).toEqual(new Set(['KC']));
  });

  it('returns an empty set for invalid weeks or payloads', () => {
    expect(parseByeTeams(byeJson, NaN).size).toBe(0);
    expect(parseByeTeams(undefined, 7).size).toBe(0);
  });
});

// ── parseFranchiseNames / parseRequiredStarters ─────────────────────────────

describe('league.json parsers', () => {
  const leagueJson = {
    league: {
      starters: { count: '9', position: [{ name: 'QB', limit: '1' }] },
      franchises: { franchise: [
        { id: '0001', name: 'Pacific Pigskins' },
        { id: '0002', name: 'Bayou Boys' },
      ] },
    },
  };

  it('maps franchise ids to names', () => {
    const names = parseFranchiseNames(leagueJson);
    expect(names.get('0001')).toBe('Pacific Pigskins');
    expect(names.get('0002')).toBe('Bayou Boys');
  });

  it('parses the required starter count', () => {
    expect(parseRequiredStarters(leagueJson)).toBe(9);
  });

  it('returns null when the count is missing or malformed', () => {
    expect(parseRequiredStarters({})).toBeNull();
    expect(parseRequiredStarters({ league: { starters: { count: 'x' } } })).toBeNull();
  });
});

// ── buildLineupWarnings ─────────────────────────────────────────────────────

describe('buildLineupWarnings', () => {
  const franchiseNames = new Map([
    ['0001', 'Pacific Pigskins'],
    ['0002', 'Bayou Boys'],
    ['0003', 'Third Team'],
  ]);

  it('flags OUT and IR starters', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0001', ['100', '200']], ['0002', ['300', '400']]),
      players,
      injuries: new Map([['100', 'Out'], ['200', 'IR']]),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: 2,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].franchiseId).toBe('0001');
    expect(warnings[0].franchiseName).toBe('Pacific Pigskins');
    expect(warnings[0].problems.map((p: any) => [p.playerName, p.type])).toEqual([
      ['Tom Brady', 'OUT'],
      ['Nick Chubb', 'IR'],
    ]);
  });

  it('flags starters whose NFL team is on bye', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0001', ['300']]),
      players,
      injuries: new Map(),
      byeTeams: new Set(['MIA']),
      franchiseNames,
      requiredStarters: 1,
    });
    expect(warnings[0].problems[0]).toMatchObject({ playerName: 'Tyreek Hill', type: 'BYE' });
  });

  it('injury status outranks bye in the label', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0001', ['300']]),
      players,
      injuries: new Map([['300', 'IR']]),
      byeTeams: new Set(['MIA']),
      franchiseNames,
      requiredStarters: 1,
    });
    expect(warnings[0].problems[0].type).toBe('IR');
  });

  it('does NOT flag Questionable/Doubtful starters (normal Sunday calls)', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0001', ['100', '200']]),
      players,
      injuries: new Map([['100', 'Questionable'], ['200', 'Doubtful']]),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: 2,
    });
    expect(warnings).toHaveLength(0);
  });

  it('flags Suspended starters', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0001', ['400']]),
      players,
      injuries: new Map([['400', 'Suspended']]),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: 1,
    });
    expect(warnings[0].problems[0].type).toBe('SUSPENDED');
  });

  it('counts empty starting slots', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0002', ['300']]),
      players,
      injuries: new Map(),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: 3,
    });
    expect(warnings[0].emptySlots).toBe(2);
    expect(warnings[0].noLineup).toBe(false);
    expect(warnings[0].problems).toHaveLength(0);
  });

  it('flags a fully-empty lineup as noLineup, not as N empty slots', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0003', []]),
      players,
      injuries: new Map(),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: 9,
    });
    expect(warnings[0].noLineup).toBe(true);
    expect(warnings[0].emptySlots).toBe(0);
  });

  it('skips the empty-slot check when requiredStarters is unknown', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0001', []]),
      players,
      injuries: new Map(),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: null,
    });
    expect(warnings).toHaveLength(0);
  });

  it('returns [] when every lineup is clean, and sorts warnings by franchise id', () => {
    const clean = buildLineupWarnings({
      lineups: lineupsOf(['0001', ['100']], ['0002', ['300']]),
      players,
      injuries: new Map(),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: 1,
    });
    expect(clean).toEqual([]);

    const sorted = buildLineupWarnings({
      lineups: lineupsOf(['0002', ['100']], ['0001', ['200']]),
      players,
      injuries: new Map([['100', 'Out'], ['200', 'Out']]),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: 1,
    });
    expect(sorted.map((w: any) => w.franchiseId)).toEqual(['0001', '0002']);
  });

  it('labels unknown player ids without crashing', () => {
    const warnings = buildLineupWarnings({
      lineups: lineupsOf(['0001', ['999']]),
      players,
      injuries: new Map([['999', 'Out']]),
      byeTeams: new Set(),
      franchiseNames,
      requiredStarters: 1,
    });
    expect(warnings[0].problems[0].playerName).toBe('Player #999');
  });
});

// ── formatWarningLine / composePost / fallbackIntro ─────────────────────────

describe('formatWarningLine', () => {
  it('formats players and empty slots into one bullet', () => {
    const line = formatWarningLine({
      franchiseId: '0001',
      franchiseName: 'Pacific Pigskins',
      problems: [
        { playerId: '100', playerName: 'Tom Brady', position: 'QB', team: 'NE', type: 'OUT' },
        { playerId: '300', playerName: 'Tyreek Hill', position: 'WR', team: 'MIA', type: 'BYE' },
      ],
      emptySlots: 1,
      noLineup: false,
    });
    expect(line).toBe('• Pacific Pigskins: Tom Brady (QB) OUT, Tyreek Hill (WR) on BYE, 1 empty starting slot');
  });

  it('formats a no-lineup franchise', () => {
    const line = formatWarningLine({
      franchiseId: '0003',
      franchiseName: 'Third Team',
      problems: [],
      emptySlots: 0,
      noLineup: true,
    });
    expect(line).toBe('• Third Team: no lineup submitted');
  });
});

describe('composePost', () => {
  it('joins intro and lines', () => {
    const post = composePost('Intro here.', ['• A: X OUT', '• B: Y on BYE']);
    expect(post).toBe('Intro here.\n\n• A: X OUT\n• B: Y on BYE');
  });

  it('stays under the GroupMe cap by dropping whole lines with an honest tail', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `• Team ${i}: Some Player (RB) OUT, Another Guy (WR) on BYE`);
    const post = composePost('Intro.', lines);
    expect(post.length).toBeLessThanOrEqual(MAX_POST_CHARS);
    expect(post).toMatch(/…plus \d+ more teams with lineup issues\.$/);
    // No mid-line truncation: every kept bullet is intact.
    for (const line of post.split('\n').filter((l) => l.startsWith('•'))) {
      expect(line).toMatch(/(OUT|BYE)$/);
    }
  });
});

describe('fallbackIntro', () => {
  it('is deterministic per week and mentions week + team count', () => {
    const a = fallbackIntro({ week: 7, teamCount: 3 });
    expect(a).toBe(fallbackIntro({ week: 7, teamCount: 3 }));
    expect(a).toContain('Week 7');
    expect(a).toContain('3 teams');
  });

  it('rotates phrasing across weeks and singularizes one team', () => {
    const weeks = new Set([1, 2, 3, 4].map((w) => fallbackIntro({ week: w, teamCount: 1 })));
    expect(weeks.size).toBe(4);
    expect(fallbackIntro({ week: 1, teamCount: 1 })).toContain('1 team ');
  });
});
