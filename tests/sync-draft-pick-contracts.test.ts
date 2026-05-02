import { describe, it, expect } from 'vitest';
// @ts-expect-error - .mjs without types
import { buildDraftPickDeclarations } from '../scripts/sync-draft-pick-contracts.mjs';
// @ts-expect-error - .mjs without types
import { getRookieSlotSalary } from '../scripts/lib/rookie-salary-slots.mjs';

function makeDraftResults(picks: Array<Record<string, string>>) {
  return {
    encoding: 'utf-8',
    draftResults: {
      draftUnit: {
        draftPick: picks,
      },
    },
  };
}

const playerIndex = new Map<string, { position: string; name: string }>([
  ['17472', { position: 'QB', name: 'Cam Ward' }],
  ['17543', { position: 'WR', name: 'Travis Hunter' }],
  ['18001', { position: 'RB', name: 'Round 2 RB' }],
  ['19999', { position: 'TE', name: 'Round 3 TE' }],
]);

const franchiseNameMap = new Map<string, string>([
  ['0001', 'Pigskins'],
  ['0007', 'Magicians'],
  ['0004', 'Mafia'],
]);

let nextId = 1;
const idGenerator = () => `DECL_TEST_${nextId++}`;

describe('buildDraftPickDeclarations', () => {
  it('creates a rookie-override declaration for each completed pick', () => {
    nextId = 1;
    const draftResults = makeDraftResults([
      { round: '01', pick: '01', player: '17472', franchise: '0007', timestamp: '1777756190', comments: '' },
      { round: '01', pick: '02', player: '17543', franchise: '0004', timestamp: '1777756190', comments: '' },
      { round: '01', pick: '03', player: '', franchise: '0001', timestamp: '', comments: '' },
    ]);

    const result = buildDraftPickDeclarations({
      draftResults,
      playerIndex,
      franchiseNameMap,
      leagueId: '13522',
      existingDeclarations: [],
      idGenerator,
    });

    expect(result).toHaveLength(2);

    const [first, second] = result;
    expect(first.type).toBe('rookie-override');
    expect(first.status).toBe('pending');
    expect(first.playerId).toBe('17472');
    expect(first.franchiseId).toBe('0007');
    expect(first.franchiseName).toBe('Magicians');
    expect(first.playerName).toBe('Cam Ward');
    expect(first.currentYears).toBe(4);
    expect(first.requestedYears).toBe(4);
    expect(first.currentContractInfo).toBe('RC');
    expect(first.submittedBy).toBe('Draft Auto-Sync');
    expect(first.acquisitionTimestamp).toBe(1777756190);
    expect(first.id).toBe('DECL_TEST_1');
    // Pick 1 overall, QB → $3,000,000
    expect(first.currentSalary).toBe(3_000_000);
    expect(first.requestedSalary).toBe(3_000_000);

    expect(second.playerId).toBe('17543');
    expect(second.franchiseName).toBe('Mafia');
    // Pick 2 overall, WR → $3,200,000
    expect(second.currentSalary).toBe(3_200_000);
  });

  it('skips picks that have no player or no timestamp', () => {
    const draftResults = makeDraftResults([
      { round: '01', pick: '01', player: '', franchise: '0001', timestamp: '' },
      { round: '01', pick: '02', player: '17472', franchise: '0007', timestamp: '' },
      { round: '01', pick: '03', player: '', franchise: '0004', timestamp: '1777756190' },
    ]);

    const result = buildDraftPickDeclarations({
      draftResults,
      playerIndex,
      franchiseNameMap,
      leagueId: '13522',
      existingDeclarations: [],
      idGenerator,
    });

    expect(result).toHaveLength(0);
  });

  it('is idempotent — skips picks already in existingDeclarations', () => {
    const draftResults = makeDraftResults([
      { round: '01', pick: '01', player: '17472', franchise: '0007', timestamp: '1777756190' },
      { round: '01', pick: '02', player: '17543', franchise: '0004', timestamp: '1777756190' },
    ]);

    const existingDeclarations = [
      { playerId: '17472', franchiseId: '0007' },
    ];

    const result = buildDraftPickDeclarations({
      draftResults,
      playerIndex,
      franchiseNameMap,
      leagueId: '13522',
      existingDeclarations,
      idGenerator,
    });

    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('17543');
  });

  it('falls back to a generic name when player is unknown', () => {
    const draftResults = makeDraftResults([
      { round: '02', pick: '01', player: '99999', franchise: '0001', timestamp: '1777756190' },
    ]);

    const result = buildDraftPickDeclarations({
      draftResults,
      playerIndex,
      franchiseNameMap,
      leagueId: '13522',
      existingDeclarations: [],
      idGenerator,
    });

    expect(result).toHaveLength(1);
    expect(result[0].playerName).toBe('Player 99999');
    // Unknown position → defaults to WR slot for round 2 pick 1 (overall 18) → $700K
    expect(result[0].currentSalary).toBe(700_000);
  });

  it('uses round-3 flat rate for picks beyond round 2', () => {
    const draftResults = makeDraftResults([
      { round: '03', pick: '05', player: '19999', franchise: '0001', timestamp: '1777756190' },
    ]);

    const result = buildDraftPickDeclarations({
      draftResults,
      playerIndex,
      franchiseNameMap,
      leagueId: '13522',
      existingDeclarations: [],
      idGenerator,
    });

    expect(result).toHaveLength(1);
    // TE round 3 flat rate
    expect(result[0].currentSalary).toBe(450_000);
  });

  it('round 2 pick 1 maps to overall pick 18 in the salary table', () => {
    // Sanity check: ensures the (round, pickInRound) → overall conversion
    // matches what the table expects.
    expect(getRookieSlotSalary(2, 18, 'WR')).toBe(700_000);
  });
});
