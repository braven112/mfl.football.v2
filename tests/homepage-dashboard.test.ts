import { describe, expect, it } from 'vitest';
import {
  getContextualRows,
  resolveUnsignedFaAlerts,
} from '../src/utils/homepage-dashboard';
import type {
  MFLPlayerInfo,
  MFLRawTransaction,
  RosterPlayer,
} from '../src/types/contract-eligibility';

function offseasonDate(year = 2026): Date {
  return new Date(year, 2, 15, 12, 0, 0);
}

describe('getContextualRows', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `team-${i + 1}`,
    rank: i + 1,
  }));

  it('returns a centered window around the user when possible', () => {
    const result = getContextualRows(rows, 'team-5');

    expect(result.rows.map((row) => row.id)).toEqual([
      'team-3',
      'team-4',
      'team-5',
      'team-6',
      'team-7',
    ]);
    expect(result.userIndex).toBe(4);
    expect(result.isContextual).toBe(true);
  });

  it('clamps the window at the top of the table', () => {
    const result = getContextualRows(rows, 'team-1');

    expect(result.rows.map((row) => row.id)).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
      'team-5',
    ]);
    expect(result.start).toBe(0);
  });

  it('falls back to the leading rows when no user is provided', () => {
    const result = getContextualRows(rows, undefined, 2, 4);

    expect(result.rows.map((row) => row.id)).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
    ]);
    expect(result.userIndex).toBe(-1);
    expect(result.isContextual).toBe(false);
  });
});

describe('resolveUnsignedFaAlerts', () => {
  it('returns only default one-year acquisitions that are still within the declaration window', () => {
    const now = offseasonDate();
    const currentYear = now.getFullYear();
    const rosterPlayers: RosterPlayer[] = [
      {
        id: '14867',
        salary: '1000000.00',
        contractYear: '1',
        contractInfo: '',
        status: 'ROSTER',
      },
      {
        id: '14868',
        salary: '2500000.00',
        contractYear: '3',
        contractInfo: '',
        status: 'ROSTER',
      },
      {
        id: '14869',
        salary: '900000.00',
        contractYear: '1',
        contractInfo: '',
        status: 'ROSTER',
      },
    ];

    const oneHourAgo = Math.floor(now.getTime() / 1000) - 3600;
    const threeDaysAgo = Math.floor(now.getTime() / 1000) - (72 * 3600);
    const rawTransactions: MFLRawTransaction[] = [
      {
        type: 'FREE_AGENT',
        franchise: '0009',
        timestamp: String(oneHourAgo),
        transaction: '14867|,',
      },
      {
        type: 'BBID_WAIVER',
        franchise: '0009',
        timestamp: String(oneHourAgo),
        transaction: '14868,|425000|13593,',
      },
      {
        type: 'AUCTION_WON',
        franchise: '0009',
        timestamp: String(threeDaysAgo),
        transaction: '14869|900000|',
      },
    ];

    const playersMap = new Map<string, MFLPlayerInfo>([
      ['14867', { id: '14867', name: 'Test Pickup', position: 'WR', team: 'DAL' }],
      ['14868', { id: '14868', name: 'Already Signed', position: 'RB', team: 'SF' }],
      ['14869', { id: '14869', name: 'Expired Window', position: 'TE', team: 'KC' }],
    ]);

    const alerts = resolveUnsignedFaAlerts({
      franchiseId: '0009',
      rosterPlayers,
      rawTransactions,
      playersMap,
      currentYear,
      referenceDate: now,
      playerContextById: new Map([
        ['14867', { id: '14867', name: 'Test Pickup', position: 'WR', nflTeam: 'DAL', headshot: '/test.png' }],
      ]),
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      playerId: '14867',
      name: 'Test Pickup',
      acquisitionType: 'FREE_AGENT',
      position: 'WR',
      nflTeam: 'DAL',
      headshot: '/test.png',
      urgent: false,
    });
  });
});
