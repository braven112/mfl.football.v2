import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildDraftBoard,
  buildOverallNumbering,
  describeShape,
  detectConcatenatedDrafts,
  listDraftUnits,
  resolveDefaultYear,
  resolveDraftResultsView,
  resolveRequestedYear,
  type DraftResultsTeam,
  type RawDraftResultPick,
} from '../src/utils/draft-results-view';

const readUnit = (league: string, year: number) =>
  JSON.parse(
    readFileSync(`data/${league}/mfl-feeds/${year}/draftResults.json`, 'utf-8')
  )?.draftResults?.draftUnit;

const TEAMS: DraftResultsTeam[] = [
  { id: '0001', name: 'Pacific Pigskins' },
  { id: '0014', name: 'Some Other Team' },
];
const noPlayers = () => undefined;
const label = (code: string) => code;

describe('overall pick numbering', () => {
  it('sums each round’s ACTUAL size instead of assuming a fixed one', () => {
    // TheLeague: rounds of 16, 17 and 18 (the toilet-bowl comp picks).
    const picks = [
      ...Array.from({ length: 16 }, (_, i) => ({ round: 1, pick: i + 1 })),
      ...Array.from({ length: 17 }, (_, i) => ({ round: 2, pick: i + 1 })),
      ...Array.from({ length: 18 }, (_, i) => ({ round: 3, pick: i + 1 })),
    ];
    const overall = buildOverallNumbering(picks);
    expect(overall(1, 1)).toBe(1);
    expect(overall(1, 16)).toBe(16);
    expect(overall(2, 1)).toBe(17);
    expect(overall(2, 17)).toBe(33);
    // The bug this replaces: (round-1)*16+pick made this 33 as well, so round
    // 3 pick 1 collided with round 2 pick 17.
    expect(overall(3, 1)).toBe(34);
    expect(overall(3, 18)).toBe(51);
  });

  it('numbers every pick of a real 51-pick board uniquely, 1..51', () => {
    const board = buildDraftBoard(
      { draftPick: readUnit('theleague', 2025).draftPick },
      new Map(),
      noPlayers
    );
    expect(board).toHaveLength(51);
    expect(board.map((p) => p.overall)).toEqual(
      Array.from({ length: 51 }, (_, i) => i + 1)
    );
  });

  it('survives a round with an extra pick (AFL 2020 has a 13th)', () => {
    const units = readUnit('afl-fantasy', 2020);
    const board = buildDraftBoard(units[0], new Map(), noPlayers);
    expect(board).toHaveLength(109);
    const overalls = board.map((p) => p.overall);
    expect(new Set(overalls).size).toBe(overalls.length); // no collisions
    expect(Math.max(...overalls)).toBe(109);
  });

  it('leaves no gap in the sequence for any archived TheLeague draft', () => {
    for (const year of [2009, 2015, 2020, 2025, 2026]) {
      const board = buildDraftBoard(
        { draftPick: readUnit('theleague', year).draftPick },
        new Map(),
        noPlayers
      );
      const overalls = board.map((p) => p.overall).sort((a, b) => a - b);
      expect(overalls, `${year} is not 1..n`).toEqual(
        Array.from({ length: overalls.length }, (_, i) => i + 1)
      );
    }
  });
});

describe('draft units', () => {
  it('reads TheLeague’s single OBJECT unit', () => {
    const units = listDraftUnits(readUnit('theleague', 2025), label);
    expect(units).toHaveLength(1);
    expect(units[0].code).toBe('LEAGUE');
    expect(units[0].pickCount).toBe(51);
  });

  it('reads the AFL’s two-element ARRAY of conference units', () => {
    const units = listDraftUnits(readUnit('afl-fantasy', 2025), label);
    expect(units.map((u) => u.code)).toEqual(['CONFERENCE00', 'CONFERENCE01']);
    expect(units.every((u) => u.pickCount === 108)).toBe(true);
  });

  it('drops an EMPTY conference rather than offering a dead tab', () => {
    // AFL 2003 and 2004 carry a CONFERENCE01 with zero picks — the league
    // drafted as one body before it split.
    for (const year of [2003, 2004]) {
      const raw = readUnit('afl-fantasy', year);
      expect(raw, `${year} should still have two raw units`).toHaveLength(2);
      const units = listDraftUnits(raw, label);
      expect(units.map((u) => u.code), `${year}`).toEqual(['CONFERENCE00']);
    }
  });
});

describe('resolveDraftResultsView', () => {
  const base = {
    availableYears: [2003, 2004, 2005, 2025],
    teams: TEAMS,
    labelForUnit: (c: string) => (c === 'CONFERENCE00' ? 'American League' : 'National League'),
    resolvePlayer: noPlayers,
    currentRounds: 9,
    currentUnits: 2,
  };

  it('defaults to the first unit and shows the whole board', () => {
    const view = resolveDraftResultsView({
      ...base,
      year: 2025,
      rawUnit: readUnit('afl-fantasy', 2025),
      params: new URLSearchParams(),
    });
    expect(view.unit).toBe('CONFERENCE00');
    expect(view.team).toBe('all');
    expect(view.picks).toHaveLength(108);
  });

  it('honors ?conference= by MFL unit id AND by bare code', () => {
    for (const q of ['CONFERENCE01', '01']) {
      const view = resolveDraftResultsView({
        ...base,
        year: 2025,
        rawUnit: readUnit('afl-fantasy', 2025),
        params: new URLSearchParams(`conference=${q}`),
      });
      expect(view.unit, q).toBe('CONFERENCE01');
    }
  });

  it('falls back to a real unit when ?conference= names one that has no picks', () => {
    const view = resolveDraftResultsView({
      ...base,
      year: 2003,
      rawUnit: readUnit('afl-fantasy', 2003),
      params: new URLSearchParams('conference=01'),
    });
    expect(view.unit).toBeNull(); // only one unit survives, so nothing to switch
    expect(view.picks.length).toBeGreaterThan(0);
  });

  it('hides the switcher for a league that drafts as one body', () => {
    const view = resolveDraftResultsView({
      ...base,
      currentUnits: 1,
      year: 2025,
      rawUnit: readUnit('theleague', 2025),
      params: new URLSearchParams(),
    });
    expect(view.unit).toBeNull();
    expect(view.units).toHaveLength(1);
  });

  it('filters to one team only when asked, never by default', () => {
    const all = resolveDraftResultsView({
      ...base,
      currentUnits: 1,
      year: 2025,
      rawUnit: readUnit('theleague', 2025),
      params: new URLSearchParams(),
      preferredTeamId: '0001',
    });
    expect(all.picks).toHaveLength(51);

    const one = resolveDraftResultsView({
      ...base,
      currentUnits: 1,
      year: 2025,
      rawUnit: readUnit('theleague', 2025),
      params: new URLSearchParams('team=0001'),
    });
    expect(one.picks.length).toBeGreaterThan(0);
    expect(one.picks.length).toBeLessThan(51);
    expect(one.picks.every((p) => p.franchiseId === '0001')).toBe(true);
    expect(one.totalPicks).toBe(51); // the board is still 51 picks
  });

  it('ignores a ?team= that is not a franchise', () => {
    const view = resolveDraftResultsView({
      ...base,
      currentUnits: 1,
      year: 2025,
      rawUnit: readUnit('theleague', 2025),
      params: new URLSearchParams('team=not-a-team'),
    });
    expect(view.team).toBe('all');
    expect(view.picks).toHaveLength(51);
  });

  it('lists years newest first', () => {
    const view = resolveDraftResultsView({
      ...base,
      year: 2025,
      rawUnit: readUnit('afl-fantasy', 2025),
      params: new URLSearchParams(),
    });
    expect(view.years).toEqual([2025, 2005, 2004, 2003]);
  });
});

describe('draft shape labelling', () => {
  const shapeFor = (league: string, year: number, earliest: number, cr: number, cu: number) => {
    const raw = readUnit(league, year);
    const units = listDraftUnits(raw, label);
    const board = buildDraftBoard(
      units.length ? { draftPick: (Array.isArray(raw) ? raw : [raw]).find((u: any) => (u?.unit || '') === units[0].code)?.draftPick } : null,
      new Map(),
      noPlayers
    );
    return describeShape(board, units, {
      isEarliestYear: year === earliest,
      currentRounds: cr,
      currentUnits: cu,
    });
  };

  it('labels TheLeague’s 2007 founding draft as a startup', () => {
    const shape = shapeFor('theleague', 2007, 2007, 3, 1);
    expect(shape.rounds).toBe(20);
    expect(shape.picks).toBe(320);
    expect(shape.startup).toBe(true);
    expect(shape.badge).toBe('Startup Draft');
  });

  it('labels the AFL’s 2003 founding draft as a startup', () => {
    const shape = shapeFor('afl-fantasy', 2003, 2003, 9, 2);
    expect(shape.rounds).toBe(15);
    expect(shape.picks).toBe(360);
    expect(shape.units).toBe(1);
    expect(shape.badge).toBe('Startup Draft');
  });

  it('labels AFL 2004 as two drafts on one board, not an expanded one', () => {
    // 16 rounds, but it is two 8-round conference drafts stacked — see the
    // dedicated describe block below.
    const shape = shapeFor('afl-fantasy', 2004, 2003, 9, 2);
    expect(shape.rounds).toBe(16);
    expect(shape.startup).toBe(false);
    expect(shape.oversized).toBe(false);
    expect(shape.badge).toBe('Two Drafts, One Board');
  });

  it('leaves an ordinary draft unbadged', () => {
    expect(shapeFor('afl-fantasy', 2025, 2003, 9, 2).badge).toBeNull();
    expect(shapeFor('theleague', 2025, 2007, 3, 1).badge).toBeNull();
  });
});

describe('two drafts stored as one board (AFL 2004)', () => {
  it('detects the round where the second draft starts', () => {
    const raw = readUnit('afl-fantasy', 2004);
    const board = buildDraftBoard(raw[0], new Map(), noPlayers);
    expect(detectConcatenatedDrafts(board)).toBe(9);
    // Either side of the boundary is a different set of franchises.
    const before = new Set(board.filter((p) => p.round < 9).map((p) => p.franchiseId));
    const after = new Set(board.filter((p) => p.round >= 9).map((p) => p.franchiseId));
    expect(before.size).toBe(12);
    expect(after.size).toBe(12);
    expect([...after].some((f) => before.has(f))).toBe(false);
  });

  it('calls it two drafts, NOT an expanded one', () => {
    const raw = readUnit('afl-fantasy', 2004);
    const units = listDraftUnits(raw, label);
    const shape = describeShape(buildDraftBoard(raw[0], new Map(), noPlayers), units, {
      isEarliestYear: false,
      currentRounds: 9,
      currentUnits: 2,
    });
    expect(shape.concatenatedFrom).toBe(9);
    expect(shape.badge).toBe('Two Drafts, One Board');
    // 16 rounds is two 8-round drafts stacked, so neither of these applies.
    expect(shape.oversized).toBe(false);
    expect(shape.singleUnit).toBe(false);
  });

  it('leaves an ordinary season undetected', () => {
    for (const [lg, y] of [['afl-fantasy', 2025], ['afl-fantasy', 2003], ['theleague', 2025]] as const) {
      const raw = readUnit(lg, y);
      const first = Array.isArray(raw) ? raw[0] : raw;
      const board = buildDraftBoard(first, new Map(), noPlayers);
      expect(detectConcatenatedDrafts(board), `${lg} ${y}`).toBeNull();
    }
  });
});

describe('skipped picks', () => {
  it('treats MFL’s ---- sentinel as no selection, not a player id', () => {
    const board = buildDraftBoard(
      {
        draftPick: [
          { round: '1', pick: '1', franchise: '0001', player: '----', comments: 'Pick Skipped By Commissioner' },
          { round: '1', pick: '2', franchise: '0002', player: '7433' },
        ],
      },
      new Map(),
      (id) => (id === '7433' ? { name: 'Somebody' } : undefined)
    );
    expect(board[0].playerId).toBe('');
    expect(board[0].playerName).toBe('');
    expect(board[1].playerId).toBe('7433');
  });

  it('counts a skipped pick as selectionless, never as unnameable', () => {
    // AFL 2004 has two commissioner-skipped picks.
    const view = resolveDraftResultsView({
      availableYears: [2004],
      year: 2004,
      rawUnit: readUnit('afl-fantasy', 2004),
      teams: TEAMS,
      params: new URLSearchParams(),
      labelForUnit: label,
      resolvePlayer: () => ({ name: 'Somebody' }),
      currentRounds: 9,
      currentUnits: 2,
    });
    expect(view.selectionless).toBe(2);
    expect(view.unnamed).toBe(0);
  });
});

describe('blank-cell accounting', () => {
  const base = {
    teams: TEAMS,
    labelForUnit: label,
    resolvePlayer: noPlayers,
    currentRounds: 9,
    currentUnits: 2,
    params: new URLSearchParams(),
  };

  it('counts the AFL 2003 board as ENTIRELY selectionless', () => {
    // MFL recorded 360 slots that year and not one player id. The page needs
    // to say that, or the board reads as broken rather than as the archive.
    const view = resolveDraftResultsView({
      ...base,
      availableYears: [2003, 2025],
      year: 2003,
      rawUnit: readUnit('afl-fantasy', 2003),
    });
    expect(view.totalPicks).toBe(360);
    expect(view.selectionless).toBe(360);
    expect(view.unnamed).toBe(0);
  });

  it('separates "no selection recorded" from "player we cannot name"', () => {
    // 2004 DOES carry player ids; they just resolve for only about half. Two
    // picks are commissioner skips ('----'), which are selectionless rather
    // than unnameable — the distinction the page's two notices turn on.
    const knows = new Set(['7433']);
    const view = resolveDraftResultsView({
      ...base,
      availableYears: [2003, 2004],
      year: 2004,
      rawUnit: readUnit('afl-fantasy', 2004),
      resolvePlayer: (id) => (knows.has(id) ? { name: 'Somebody' } : undefined),
    });
    expect(view.totalPicks).toBe(192);
    expect(view.selectionless).toBe(2); // the two skipped picks
    // '7433' is drafted in BOTH halves of the stacked board, so two resolve.
    expect(view.unnamed).toBe(188);
    expect(view.selectionless + view.unnamed + 2).toBe(view.totalPicks);
  });

  it('reports a fully-resolved modern board as clean', () => {
    const view = resolveDraftResultsView({
      ...base,
      availableYears: [2025],
      year: 2025,
      rawUnit: readUnit('afl-fantasy', 2025),
      resolvePlayer: () => ({ name: 'Somebody' }),
    });
    expect(view.selectionless).toBe(0);
    expect(view.unnamed).toBe(0);
  });
});

describe('year selection', () => {
  it('opens on the most recent draft that actually happened', () => {
    // 2027's feed exists but is stubbed — the page must not open on it.
    const conducted = new Set([2025, 2026]);
    expect(resolveDefaultYear([2025, 2026, 2027], (y) => conducted.has(y))).toBe(2026);
  });

  it('falls back to the newest year when nothing has been drafted', () => {
    expect(resolveDefaultYear([2025, 2026], () => false)).toBe(2026);
  });

  it('accepts ?year= only for a season we have', () => {
    expect(resolveRequestedYear(new URLSearchParams('year=2015'), [2015, 2016])).toBe(2015);
    expect(resolveRequestedYear(new URLSearchParams('year=1999'), [2015, 2016])).toBeNull();
    expect(resolveRequestedYear(new URLSearchParams('year=nope'), [2015, 2016])).toBeNull();
    expect(resolveRequestedYear(new URLSearchParams(), [2015, 2016])).toBeNull();
  });
});

describe('pick rows', () => {
  const teams = new Map<string, DraftResultsTeam>([
    ['0014', { id: '0014', name: 'Bring the Pain' }],
  ]);

  it('names the franchise, labels the pick, and carries the player through', () => {
    const board = buildDraftBoard(
      { draftPick: readUnit('theleague', 2025).draftPick as RawDraftResultPick[] },
      teams,
      (id) => (id === '17042' ? { name: 'Ashton Jeanty', position: 'RB', nflTeam: 'LV' } : undefined)
    );
    expect(board[0].label).toBe('1.01');
    expect(board[0].teamName).toBe('Bring the Pain');
    expect(board[0].playerName).toBe('Ashton Jeanty');
    expect(board[0].position).toBe('RB');
  });

  it('reads the ORIGINAL franchise off a traded pick’s comment', () => {
    const board = buildDraftBoard(
      { draftPick: readUnit('theleague', 2025).draftPick as RawDraftResultPick[] },
      new Map(),
      noPlayers
    );
    const traded = board.filter((p) => p.tradedFrom);
    expect(traded.length).toBeGreaterThan(0);
    expect(traded.map((p) => p.tradedFrom)).toContain('The Music City Mafia');
    // A pre-draft-list note is NOT a trade.
    const preDraft = board.find((p) => p.note.includes('Pre-Draft List'));
    expect(preDraft?.tradedFrom).toBeNull();
  });

  it('strips MFL’s brackets off the note', () => {
    const board = buildDraftBoard(
      { draftPick: [{ round: '1', pick: '1', franchise: '0014', comments: '[Pick added by commissioner.] ' }] },
      new Map(),
      noPlayers
    );
    expect(board[0].note).toBe('Pick added by commissioner.');
  });

  it('names an unknown franchise rather than rendering a blank cell', () => {
    const board = buildDraftBoard(
      { draftPick: [{ round: '1', pick: '1', franchise: '9999' }] },
      new Map(),
      noPlayers
    );
    expect(board[0].teamName).toBe('Unknown Team');
  });
});
