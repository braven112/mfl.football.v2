import { describe, it, expect } from 'vitest';
// @ts-expect-error - .mjs without types
import { buildDraftPickWrites } from '../scripts/sync-draft-pick-contracts.mjs';
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

describe('buildDraftPickWrites', () => {
  it('emits a write per completed pick that does not already have RC on MFL', () => {
    const draftResults = makeDraftResults([
      { round: '01', pick: '01', player: '17472', franchise: '0007', timestamp: '1777756190' },
      { round: '01', pick: '02', player: '17543', franchise: '0004', timestamp: '1777756190' },
      { round: '01', pick: '03', player: '', franchise: '0001', timestamp: '' },
    ]);
    const mflSalaries = new Map();

    const writes = buildDraftPickWrites({ draftResults, playerIndex, mflSalaries });

    expect(writes).toHaveLength(2);

    const [first, second] = writes;
    expect(first.playerId).toBe('17472');
    expect(first.franchiseId).toBe('0007');
    expect(first.position).toBe('QB');
    // Pick 1 overall, QB → $3,000,000
    expect(first.salary).toBe(3_000_000);
    expect(first.contractYear).toBe('4');
    expect(first.contractInfo).toBe('RC');
    expect(first.acquisitionTimestamp).toBe(1777756190);

    expect(second.playerId).toBe('17543');
    // Pick 2 overall, WR → $3,200,000
    expect(second.salary).toBe(3_200_000);
  });

  it('skips picks that have no player or no timestamp', () => {
    const draftResults = makeDraftResults([
      { round: '01', pick: '01', player: '', franchise: '0001', timestamp: '' },
      { round: '01', pick: '02', player: '17472', franchise: '0007', timestamp: '' },
      { round: '01', pick: '03', player: '', franchise: '0004', timestamp: '1777756190' },
    ]);
    const mflSalaries = new Map();

    const writes = buildDraftPickWrites({ draftResults, playerIndex, mflSalaries });

    expect(writes).toHaveLength(0);
  });

  it('is idempotent — skips picks where MFL already has contractInfo=RC', () => {
    const draftResults = makeDraftResults([
      { round: '01', pick: '01', player: '17472', franchise: '0007', timestamp: '1777756190' },
      { round: '01', pick: '02', player: '17543', franchise: '0004', timestamp: '1777756190' },
    ]);

    const mflSalaries = new Map();
    mflSalaries.set('17472', {
      salary: '3000000.00',
      contractYear: '4',
      contractInfo: 'RC',
    });

    const writes = buildDraftPickWrites({ draftResults, playerIndex, mflSalaries });

    expect(writes).toHaveLength(1);
    expect(writes[0].playerId).toBe('17543');
  });

  it('still writes when MFL has the player on roster but without RC', () => {
    // Drafted players initially appear with empty contractInfo; we should
    // write RC + slot salary in that case.
    const draftResults = makeDraftResults([
      { round: '01', pick: '01', player: '17472', franchise: '0007', timestamp: '1777756190' },
    ]);

    const mflSalaries = new Map();
    mflSalaries.set('17472', {
      salary: '0.00',
      contractYear: '1',
      contractInfo: '',
    });

    const writes = buildDraftPickWrites({ draftResults, playerIndex, mflSalaries });

    expect(writes).toHaveLength(1);
    expect(writes[0].contractInfo).toBe('RC');
    expect(writes[0].contractYear).toBe('4');
    expect(writes[0].salary).toBe(3_000_000);
  });

  it('falls back to a generic name and WR slot when player is unknown', () => {
    const draftResults = makeDraftResults([
      { round: '02', pick: '01', player: '99999', franchise: '0001', timestamp: '1777756190' },
    ]);
    const mflSalaries = new Map();

    const writes = buildDraftPickWrites({ draftResults, playerIndex, mflSalaries });

    expect(writes).toHaveLength(1);
    expect(writes[0].playerName).toBe('Player 99999');
    // Round 2 pick 1 (overall 18) WR slot → $700K
    expect(writes[0].salary).toBe(700_000);
  });

  it('uses round-3 flat rate for picks beyond round 2', () => {
    const draftResults = makeDraftResults([
      { round: '03', pick: '05', player: '19999', franchise: '0001', timestamp: '1777756190' },
    ]);
    const mflSalaries = new Map();

    const writes = buildDraftPickWrites({ draftResults, playerIndex, mflSalaries });

    expect(writes).toHaveLength(1);
    // TE round 3 flat rate
    expect(writes[0].salary).toBe(450_000);
  });

  it('round 2 pick 1 maps to overall pick 18 in the salary table', () => {
    expect(getRookieSlotSalary(2, 18, 'WR')).toBe(700_000);
  });
});
