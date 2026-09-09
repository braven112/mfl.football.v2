import { describe, it, expect } from 'vitest';
import {
  parseTransactionString,
  parseTransactions,
  findAcquisitionTransaction,
  calculateDeadline,
  isRookieContractStatus,
  isMFLRookie,
  getPlayerEligibility,
  getTeamEligibility,
} from '../src/utils/contract-eligibility';
import type {
  MFLRawTransaction,
  RosterPlayer,
  MFLPlayerInfo,
} from '../src/types/contract-eligibility';
import { ACQUISITION_TYPES } from '../src/utils/contract-eligibility';
import { parseRosterMove } from '../scripts/lib/roster-move-parse.mjs';
import corpus from './fixtures/mfl-transaction-strings.json';

// Helper: create a date in a specific contract window
function offseasonDate(year = 2026): Date {
  // March 15 is safely in offseason (Feb 15 - 3rd Sunday Aug)
  return new Date(year, 2, 15, 12, 0, 0);
}

function inSeasonDate(year = 2025): Date {
  // October 15 is safely in-season (Sept 1 - Feb 14)
  return new Date(year, 9, 15, 12, 0, 0);
}

function betweenWindowsDate(year = 2026): Date {
  // August 25 falls after the 3rd Sunday in August and before Sept. 1
  return new Date(year, 7, 25, 12, 0, 0);
}

function makeRosterPlayer(overrides: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    id: '14867',
    salary: '1000000.00',
    contractYear: '1',
    contractInfo: '',
    status: 'ROSTER',
    ...overrides,
  };
}

function makePlayerInfo(overrides: Partial<MFLPlayerInfo> = {}): MFLPlayerInfo {
  return {
    id: '14867',
    name: 'Test Player',
    position: 'WR',
    team: 'DAL',
    ...overrides,
  };
}

// --- parseTransactionString ---

describe('parseTransactionString', () => {
  it('parses BBID add/drop format', () => {
    const result = parseTransactionString('14867,|425000|13593,');
    expect(result.addedPlayerIds).toEqual(['14867']);
    expect(result.droppedPlayerIds).toEqual(['13593']);
    expect(result.bbidAmount).toBe(425000);
  });

  // THE REGRESSION. A winning waiver claim that needed no corresponding cut
  // ends at the pipe. MFL has never emitted the "14867,|500000|," this test
  // used to assert -- that trailing comma was written by hand, so the suite
  // passed while every drop-free claim in production parsed to zero adds,
  // was discarded by parseTransactions(), and never opened its owner's
  // declaration window. Ryan Flournoy (16778) was claimed as
  // "16778,|500000|" and showed no contract-length control at all.
  it('parses a BBID claim with NO drop (real MFL shape, trailing pipe)', () => {
    const result = parseTransactionString('16778,|500000|');
    expect(result.addedPlayerIds).toEqual(['16778']);
    expect(result.droppedPlayerIds).toEqual([]);
    expect(result.bbidAmount).toBe(500000);
  });

  it('still parses a BBID claim with no drop when a trailing comma is present', () => {
    const result = parseTransactionString('14867,|500000|,');
    expect(result.addedPlayerIds).toEqual(['14867']);
    expect(result.droppedPlayerIds).toEqual([]);
    expect(result.bbidAmount).toBe(500000);
  });

  it('parses a multi-player drop (both ids, not one concatenated id)', () => {
    const result = parseTransactionString('|17064,16191,');
    expect(result.addedPlayerIds).toEqual([]);
    expect(result.droppedPlayerIds).toEqual(['17064', '16191']);
  });

  // Every segment MFL writes is comma-delimited, so "one id" and "no id" were
  // never the only two cases. Enumerating shapes instead of reading segments
  // is what left the no-drop claim out; these are the same class one step out.
  it('parses a BBID claim that cut more than one player', () => {
    const result = parseTransactionString('14063,|425000|15777,16191,');
    expect(result.addedPlayerIds).toEqual(['14063']);
    expect(result.droppedPlayerIds).toEqual(['15777', '16191']);
    expect(result.bbidAmount).toBe(425000);
  });

  it('parses an auction win that cut a player to make room', () => {
    const result = parseTransactionString('12140|425000|13000,');
    expect(result.addedPlayerIds).toEqual(['12140']);
    expect(result.droppedPlayerIds).toEqual(['13000']);
    expect(result.bbidAmount).toBe(425000);
  });

  it('parses drop-only format (pipe prefix)', () => {
    const result = parseTransactionString('|16608,');
    expect(result.addedPlayerIds).toEqual([]);
    expect(result.droppedPlayerIds).toEqual(['16608']);
    expect(result.bbidAmount).toBeUndefined();
  });

  it('parses add/drop swap format', () => {
    const result = parseTransactionString('14867|13593,');
    expect(result.addedPlayerIds).toEqual(['14867']);
    expect(result.droppedPlayerIds).toEqual(['13593']);
  });

  it('parses add-only format', () => {
    const result = parseTransactionString('14867|,');
    expect(result.addedPlayerIds).toEqual(['14867']);
    expect(result.droppedPlayerIds).toEqual([]);
  });

  it('handles empty string', () => {
    const result = parseTransactionString('');
    expect(result.addedPlayerIds).toEqual([]);
    expect(result.droppedPlayerIds).toEqual([]);
  });

  it('handles multiple drops', () => {
    const result = parseTransactionString('|13604,|14836,');
    expect(result.addedPlayerIds).toEqual([]);
    expect(result.droppedPlayerIds).toContain('13604');
  });

  it('parses auction format (playerId|amount|)', () => {
    const result = parseTransactionString('13592|3250000|');
    expect(result.addedPlayerIds).toEqual(['13592']);
    expect(result.droppedPlayerIds).toEqual([]);
    expect(result.bbidAmount).toBe(3250000);
  });
});

// --- parseTransactions ---

describe('parseTransactions', () => {
  it('includes BBID_WAIVER transactions with adds', () => {
    const raw: MFLRawTransaction[] = [
      {
        type: 'BBID_WAIVER',
        franchise: '0009',
        timestamp: '1766548800',
        transaction: '14867,|425000|13593,',
      },
    ];
    const result = parseTransactions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].addedPlayerIds).toEqual(['14867']);
    expect(result[0].bbidAmount).toBe(425000);
  });

  it('excludes TRADE transactions', () => {
    const raw: MFLRawTransaction[] = [
      {
        type: 'TRADE',
        franchise: '0005',
        franchise2: '0011',
        timestamp: '1763180188',
        transaction: '',
        franchise1_gave_up: 'FP_0005_2026_3,',
        franchise2_gave_up: '13630,',
      },
    ];
    const result = parseTransactions(raw);
    expect(result).toHaveLength(0);
  });

  it('excludes drop-only FREE_AGENT transactions', () => {
    const raw: MFLRawTransaction[] = [
      {
        type: 'FREE_AGENT',
        franchise: '0012',
        timestamp: '1771138565',
        transaction: '|16608,',
        by_commish: '1',
      },
    ];
    const result = parseTransactions(raw);
    expect(result).toHaveLength(0);
  });

  it('excludes empty BBID_AUTO_PROCESS_WAIVERS batch markers', () => {
    const raw: MFLRawTransaction[] = [
      {
        type: 'BBID_AUTO_PROCESS_WAIVERS',
        franchise: '',
        timestamp: '1766548800',
        transaction: '',
      },
    ];
    const result = parseTransactions(raw);
    expect(result).toHaveLength(0);
  });

  it('includes AUCTION_WON transactions', () => {
    const raw: MFLRawTransaction[] = [
      {
        type: 'AUCTION_WON',
        franchise: '0001',
        timestamp: '1774060150',
        transaction: '13592|3250000|',
      },
    ];
    const result = parseTransactions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].addedPlayerIds).toEqual(['13592']);
    expect(result[0].bbidAmount).toBe(3250000);
  });

  it('includes FREE_AGENT transactions that have adds', () => {
    const raw: MFLRawTransaction[] = [
      {
        type: 'FREE_AGENT',
        franchise: '0003',
        timestamp: '1766000000',
        transaction: '14867|13593,',
      },
    ];
    const result = parseTransactions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].addedPlayerIds).toEqual(['14867']);
  });
});

// --- findAcquisitionTransaction ---

describe('findAcquisitionTransaction', () => {
  it('finds the acquisition for a player on the correct franchise', () => {
    const transactions = parseTransactions([
      {
        type: 'BBID_WAIVER',
        franchise: '0009',
        timestamp: '1766548800',
        transaction: '14867,|425000|13593,',
      },
    ]);
    const result = findAcquisitionTransaction('14867', '0009', transactions);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(1766548800);
  });

  it('returns null for a different franchise', () => {
    const transactions = parseTransactions([
      {
        type: 'BBID_WAIVER',
        franchise: '0009',
        timestamp: '1766548800',
        transaction: '14867,|425000|13593,',
      },
    ]);
    const result = findAcquisitionTransaction('14867', '0001', transactions);
    expect(result).toBeNull();
  });

  it('returns null for players not acquired via BBID/FA', () => {
    const transactions = parseTransactions([]);
    const result = findAcquisitionTransaction('14867', '0009', transactions);
    expect(result).toBeNull();
  });
});

// --- calculateDeadline ---

describe('calculateDeadline', () => {
  it('returns 48-hour deadline during offseason', () => {
    const acquisitionTime = Math.floor(offseasonDate().getTime() / 1000);
    const deadline = calculateDeadline(acquisitionTime, offseasonDate());
    const expectedDeadline = (acquisitionTime * 1000) + (48 * 60 * 60 * 1000);
    expect(deadline).toBe(expectedDeadline);
  });

  it('returns 24-hour deadline during in-season', () => {
    const acquisitionTime = Math.floor(inSeasonDate().getTime() / 1000);
    const deadline = calculateDeadline(acquisitionTime, inSeasonDate());
    const expectedDeadline = (acquisitionTime * 1000) + (24 * 60 * 60 * 1000);
    expect(deadline).toBe(expectedDeadline);
  });
});

// --- isRookieContractStatus ---

describe('isRookieContractStatus', () => {
  it('returns true for RC', () => {
    expect(isRookieContractStatus('RC')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isRookieContractStatus('')).toBe(false);
  });

  it('returns false for F (franchise tag)', () => {
    expect(isRookieContractStatus('F')).toBe(false);
  });

  it('returns false for R (old designation)', () => {
    expect(isRookieContractStatus('R')).toBe(false);
  });

  it('returns false for R1 (retired designation)', () => {
    expect(isRookieContractStatus('R1')).toBe(false);
  });
});

// --- isMFLRookie ---

describe('isMFLRookie', () => {
  it('returns true when player has status R', () => {
    expect(isMFLRookie({ id: '1', name: 'Test', position: 'WR', team: 'DAL', status: 'R' }, 2026)).toBe(true);
  });

  it('returns true when draft_year matches current year', () => {
    expect(isMFLRookie({ id: '1', name: 'Test', position: 'WR', team: 'DAL', draft_year: '2026' }, 2026)).toBe(true);
  });

  it('returns false when neither condition met', () => {
    expect(isMFLRookie({ id: '1', name: 'Test', position: 'WR', team: 'DAL', status: 'A', draft_year: '2024' }, 2026)).toBe(false);
  });

  it('returns false for undefined player', () => {
    expect(isMFLRookie(undefined, 2026)).toBe(false);
  });
});

// --- getPlayerEligibility ---

describe('getPlayerEligibility', () => {
  const now = offseasonDate();
  const currentYear = now.getFullYear();

  describe('new-acquisition eligibility', () => {
    it('marks a recent BBID acquisition as eligible with 2-5 year options', () => {
      // Acquired 1 hour ago
      const acquisitionTime = Math.floor(now.getTime() / 1000) - 3600;
      const rawTxns: MFLRawTransaction[] = [
        {
          type: 'BBID_WAIVER',
          franchise: '0009',
          timestamp: String(acquisitionTime),
          transaction: '14867,|425000|13593,',
        },
      ];
      const transactions = parseTransactions(rawTxns);
      const roster = makeRosterPlayer({ contractYear: '1', contractInfo: '' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, transactions, playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('new-acquisition');
      expect(result.yearOptions).toEqual([1, 2, 3, 4, 5]);
      expect(result.isExpired).toBe(false);
    });

    it('marks a recent auction acquisition as eligible with 1-5 year options', () => {
      const acquisitionTime = Math.floor(now.getTime() / 1000) - 3600;
      const rawTxns: MFLRawTransaction[] = [
        {
          type: 'AUCTION_WON',
          franchise: '0001',
          timestamp: String(acquisitionTime),
          transaction: '13592|3250000|',
        },
      ];
      const transactions = parseTransactions(rawTxns);
      const roster = makeRosterPlayer({ id: '13592', contractYear: '1', contractInfo: '' });
      const playerInfo = makePlayerInfo({ id: '13592' });

      const result = getPlayerEligibility('13592', '0001', roster, transactions, playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('new-acquisition');
      expect(result.yearOptions).toEqual([1, 2, 3, 4, 5]);
      expect(result.isExpired).toBe(false);
    });

    it('marks an expired acquisition as not eligible for new-acquisition (may be eligible for other types)', () => {
      // Acquired 72 hours ago (beyond 48h offseason deadline)
      const acquisitionTime = Math.floor(now.getTime() / 1000) - (72 * 3600);
      const rawTxns: MFLRawTransaction[] = [
        {
          type: 'BBID_WAIVER',
          franchise: '0009',
          timestamp: String(acquisitionTime),
          transaction: '14867,|425000|13593,',
        },
      ];
      const transactions = parseTransactions(rawTxns);
      const roster = makeRosterPlayer({ contractYear: '1', contractInfo: '' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, transactions, playerInfo, currentYear, now);
      // Expired BBID acquisition should not qualify as new-acquisition
      // (but the player may still be eligible for franchise-tag since they have 1yr remaining)
      expect(result.declarationType).not.toBe('new-acquisition');
    });

    it('allows acquired players with multi-year contracts to change within deadline', () => {
      const acquisitionTime = Math.floor(now.getTime() / 1000) - 3600;
      const rawTxns: MFLRawTransaction[] = [
        {
          type: 'BBID_WAIVER',
          franchise: '0009',
          timestamp: String(acquisitionTime),
          transaction: '14867,|425000|13593,',
        },
      ];
      const transactions = parseTransactions(rawTxns);
      const roster = makeRosterPlayer({ contractYear: '3', contractInfo: '' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, transactions, playerInfo, currentYear, now);
      // Within deadline, owner can always change contract regardless of current years
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('new-acquisition');
      expect(result.yearOptions).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('rookie-override eligibility', () => {
    it('marks RC player with MFL rookie status as eligible for override', () => {
      const roster = makeRosterPlayer({ contractYear: '4', contractInfo: 'RC' });
      const playerInfo = makePlayerInfo({ status: 'R', draft_year: String(currentYear) });

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('rookie-override');
      // 1–4 always available so owners can revert to the default 4-year deal.
      expect(result.yearOptions).toEqual([1, 2, 3, 4]);
    });

    it('does not mark RC player without MFL rookie status', () => {
      const roster = makeRosterPlayer({ contractYear: '4', contractInfo: 'RC' });
      const playerInfo = makePlayerInfo({ status: 'A', draft_year: '2024' });

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      // Without MFL rookie status, RC player gets rookie-extension instead of override
      expect(result.declarationType).not.toBe('rookie-override');
    });

    it('marks 1st-round TO rookie as eligible for override with 1-4 year options', () => {
      // 1st-round 2026 pick: contractInfo is "TO", default 4-year rookie deal.
      // Even at currentYears=1 (which would normally fail the team-option check)
      // the just-drafted rookie must remain adjustable until August.
      const roster = makeRosterPlayer({ contractYear: '1', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo({ status: 'R', draft_year: String(currentYear) });

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('rookie-override');
      expect(result.yearOptions).toEqual([1, 2, 3, 4]);
    });

    it('marks TO rookie as override when default 4-year contract is set', () => {
      const roster = makeRosterPlayer({ contractYear: '4', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo({ status: 'R', draft_year: String(currentYear) });

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('rookie-override');
      expect(result.declarationType).not.toBe('team-option');
      expect(result.yearOptions).toEqual([1, 2, 3, 4]);
    });

    it('does not mark TO veteran (non-rookie) for override', () => {
      // Existing TO player whose rookie window has closed — should still flow
      // into team-option for the Year 4 decision, not rookie-override.
      const roster = makeRosterPlayer({ contractYear: '2', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo({ status: 'A', draft_year: '2024' });

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.declarationType).not.toBe('rookie-override');
      expect(result.declarationType).toBe('team-option');
    });
  });

  describe('franchise-tag eligibility', () => {
    it('marks 1-year player as eligible for franchise tag in offseason', () => {
      const roster = makeRosterPlayer({ contractYear: '1', contractInfo: '' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('franchise-tag');
    });

    it('does not mark already-tagged player', () => {
      const roster = makeRosterPlayer({ contractYear: '1', contractInfo: 'F' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.declarationType).not.toBe('franchise-tag');
    });
  });

  describe('veteran-extension eligibility', () => {
    it('marks 2+ year non-RC player as eligible in offseason', () => {
      const roster = makeRosterPlayer({ contractYear: '3', contractInfo: '' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('veteran-extension');
    });

    it('does not mark RC player for veteran extension', () => {
      const roster = makeRosterPlayer({ contractYear: '3', contractInfo: 'RC' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.declarationType).not.toBe('veteran-extension');
    });

    it('does not mark 1-year player for veteran extension', () => {
      const roster = makeRosterPlayer({ contractYear: '1', contractInfo: '' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.declarationType).not.toBe('veteran-extension');
    });
  });

  describe('rookie-extension eligibility', () => {
    it('marks RC player with 2+ years as eligible for rookie extension in offseason', () => {
      // RC player who is NOT a current-year MFL rookie (they're a 2nd/3rd year RC)
      const roster = makeRosterPlayer({ contractYear: '3', contractInfo: 'RC' });
      const playerInfo = makePlayerInfo({ status: 'A', draft_year: '2024' });

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('rookie-extension');
    });

    it('does NOT surface TO player with 2+ years as rookie-extension', () => {
      const roster = makeRosterPlayer({ contractYear: '3', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('team-option');
      expect(result.declarationType).not.toBe('rookie-extension');
    });

    it('does NOT mark RC player with only 1 year as eligible for rookie extension', () => {
      const roster = makeRosterPlayer({ contractYear: '1', contractInfo: 'RC' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      // RC with 1 year — no eligible action in offseason (no franchise tag, no extension)
      expect(result.eligible).toBe(false);
      expect(result.declarationType).toBeNull();
      expect(result.declarationType).not.toBe('rookie-extension');
    });
  });

  describe('team-option eligibility', () => {
    it('marks TO player before Year 4 as eligible for team option', () => {
      const roster = makeRosterPlayer({ contractYear: '3', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo();
      const salaryAverages = {
        teamOptionSalaries: { WR: 6000000 },
      };

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now, salaryAverages);
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('team-option');
      expect(result.teamOptionSalary).toBe(6000000);
    });

    it('keeps team option available outside the generic contract window', () => {
      const roster = makeRosterPlayer({ contractYear: '2', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, betweenWindowsDate());
      expect(result.eligible).toBe(true);
      expect(result.declarationType).toBe('team-option');
    });

    it('uses teamOptionSalaries for the top 10 average salary', () => {
      const roster = makeRosterPlayer({ contractYear: '2', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo({ position: 'QB' });
      const salaryAverages = {
        teamOptionSalaries: { QB: 8500000, WR: 6000000 },
      };

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now, salaryAverages);
      expect(result.declarationType).toBe('team-option');
      expect(result.teamOptionSalary).toBe(8500000);
    });

    it('does NOT mark TO player before Year 4 as franchise-tag eligible', () => {
      const roster = makeRosterPlayer({ contractYear: '2', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.declarationType).not.toBe('franchise-tag');
    });

    it('does NOT mark TO player with 2+ years as veteran-extension eligible', () => {
      const roster = makeRosterPlayer({ contractYear: '3', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.declarationType).not.toBe('veteran-extension');
    });

    it('uses team-option as the primary TO decision marker before Year 4', () => {
      const roster = makeRosterPlayer({ contractYear: '2', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.declarationType).toBe('team-option');
      expect(result.declarationType).not.toBe('rookie-extension');
    });

    it('does NOT mark TO player in Year 4 as team-option eligible', () => {
      const roster = makeRosterPlayer({ contractYear: '1', contractInfo: 'TO' });
      const playerInfo = makePlayerInfo();

      const result = getPlayerEligibility('14867', '0009', roster, [], playerInfo, currentYear, now);
      expect(result.eligible).toBe(false);
      expect(result.declarationType).not.toBe('team-option');
    });
  });
});

// --- getTeamEligibility ---

describe('getTeamEligibility', () => {
  it('returns batch results for a team roster', () => {
    const now = offseasonDate();
    const currentYear = now.getFullYear();
    const acquisitionTime = Math.floor(now.getTime() / 1000) - 3600;

    const rosterPlayers: RosterPlayer[] = [
      makeRosterPlayer({ id: '14867', contractYear: '1', contractInfo: '' }),
      makeRosterPlayer({ id: '14868', contractYear: '3', contractInfo: '' }),
      makeRosterPlayer({ id: '14869', contractYear: '4', contractInfo: 'RC' }),
    ];

    const rawTxns: MFLRawTransaction[] = [
      {
        type: 'BBID_WAIVER',
        franchise: '0009',
        timestamp: String(acquisitionTime),
        transaction: '14867,|425000|13593,',
      },
    ];

    const playersMap = new Map<string, MFLPlayerInfo>([
      ['14867', makePlayerInfo({ id: '14867' })],
      ['14868', makePlayerInfo({ id: '14868' })],
      ['14869', makePlayerInfo({ id: '14869', status: 'R', draft_year: String(currentYear) })],
    ]);

    const result = getTeamEligibility('0009', rosterPlayers, rawTxns, playersMap, currentYear, now);

    expect(result.franchiseId).toBe('0009');
    expect(result.players).toHaveLength(3);
    expect(result.eligibleCount).toBeGreaterThanOrEqual(2); // At least BBID player + RC rookie
  });
});

// --- Recorded MFL corpus ---
//
// tests/fixtures/mfl-transaction-strings.json holds one entry per DISTINCT
// (type, string shape) in TheLeague's full 2026 transactions export. It exists
// because the shape this parser got wrong was one nobody had ever looked at:
// the add-only BBID case was asserted against a hand-written string with a
// trailing comma MFL does not send. Real strings, or the test proves nothing.

describe('recorded MFL transaction strings', () => {
  const acquisitionShapes = corpus.shapes.filter(s => ACQUISITION_TYPES.includes(s.type));

  it('covers both BBID claim shapes — with a drop and without one', () => {
    const bbid = corpus.shapes.filter(s => s.type === 'BBID_WAIVER').map(s => s.shape);
    expect(bbid).toContain('N,|N|');    // claim, nothing cut
    expect(bbid).toContain('N,|N|N,');  // claim + cut
  });

  it('extracts an added player from every acquisition string that has one', () => {
    for (const entry of acquisitionShapes) {
      const parsed = parseTransactionString(entry.example);
      // A leading pipe is a pure drop and legitimately adds nobody.
      const expectsAdd = !entry.example.startsWith('|') && entry.example !== '';
      expect(
        parsed.addedPlayerIds.length > 0,
        `${entry.type} ${JSON.stringify(entry.example)} (${entry.occurrences} in the export) parsed to ${JSON.stringify(parsed.addedPlayerIds)}`,
      ).toBe(expectsAdd);
    }
  });

  it('never silently drops an acquisition that adds a player', () => {
    // The end state of the bug: parseTransactions() discards any acquisition
    // whose string yielded no adds, so a parse miss is invisible downstream.
    const raw: MFLRawTransaction[] = acquisitionShapes
      .filter(entry => !entry.example.startsWith('|') && entry.example !== '')
      .map((entry, i) => ({
        type: entry.type,
        franchise: '0008',
        timestamp: String(1788919200 + i),
        transaction: entry.example,
      }));
    expect(parseTransactions(raw)).toHaveLength(raw.length);
  });

  it('agrees with the Schefter scanner on every roster-move string', () => {
    // scripts/lib/roster-move-parse.mjs parses the same MFL field and already
    // carried the tolerant BBID pattern; this parser did not, and the drift
    // was the bug. Scoped to the roster-move types the scanner is fed —
    // AUCTION_* strings are a different grammar (the leading segment of an
    // AUCTION_BID is a FRANCHISE id) and that parser never sees them.
    const rosterMoveTypes = ['FREE_AGENT', 'WAIVER', 'BBID_WAIVER'];
    for (const entry of corpus.shapes.filter(s => rosterMoveTypes.includes(s.type))) {
      const mine = parseTransactionString(entry.example);
      const theirs = parseRosterMove(entry.example);
      expect(mine.addedPlayerIds, `adds for ${JSON.stringify(entry.example)}`).toEqual(theirs.addedIds);
      expect(mine.droppedPlayerIds, `drops for ${JSON.stringify(entry.example)}`).toEqual(theirs.droppedIds);
      expect(mine.bbidAmount, `bid for ${JSON.stringify(entry.example)}`).toEqual(theirs.bbidAmount);
    }
  });

  it('ignores AUCTION_BID, whose leading segment is a franchise id', () => {
    // "0511|2525000|" is franchise 0511 bidding, not player 0511 being added.
    // ACQUISITION_TYPES is what keeps it out; this pins that it stays out.
    const raw: MFLRawTransaction[] = [
      { type: 'AUCTION_BID', franchise: '0005', timestamp: '1788919200', transaction: '0511|2525000|' },
    ];
    expect(parseTransactions(raw)).toHaveLength(0);
  });
});

// --- Regression: the drop-free waiver claim, end to end ---

describe('drop-free BBID claim opens the declaration window', () => {
  it('makes a claim with no corresponding cut new-acquisition eligible', () => {
    // Ryan Flournoy (16778), claimed by franchise 0008 for $500K at
    // 2026-09-09T02:00:00Z with nothing cut alongside him. Before the parse
    // fix this returned eligible:false, so rosters.astro rendered the years
    // as plain text and the action sheet offered no "Declare Contract".
    const now = new Date('2026-09-09T03:00:00Z');
    const rawTxns: MFLRawTransaction[] = [
      {
        type: 'BBID_WAIVER',
        franchise: '0008',
        timestamp: '1788919200', // 2026-09-09T02:00:00Z
        transaction: '16778,|500000|',
      },
    ];
    const transactions = parseTransactions(rawTxns);
    const roster = makeRosterPlayer({ id: '16778', salary: '500000.00', contractYear: '1', contractInfo: '' });
    const playerInfo = makePlayerInfo({ id: '16778', name: 'Flournoy, Ryan', draft_year: '2024' });

    const result = getPlayerEligibility('16778', '0008', roster, transactions, playerInfo, 2026, now);
    expect(result.eligible).toBe(true);
    expect(result.declarationType).toBe('new-acquisition');
    expect(result.yearOptions).toEqual([1, 2, 3, 4, 5]);
    expect(result.isExpired).toBe(false);
    // In-season: 24 hours from the claim, not 48.
    expect(result.deadlineTimestamp).toBe(1788919200 + 24 * 60 * 60);
  });

  it('expires that window 24 hours after the claim', () => {
    const rawTxns: MFLRawTransaction[] = [
      {
        type: 'BBID_WAIVER',
        franchise: '0008',
        timestamp: '1788919200',
        transaction: '16778,|500000|',
      },
    ];
    const transactions = parseTransactions(rawTxns);
    const roster = makeRosterPlayer({ id: '16778', contractYear: '1', contractInfo: '' });
    const playerInfo = makePlayerInfo({ id: '16778', draft_year: '2024' });

    const result = getPlayerEligibility(
      '16778', '0008', roster, transactions, playerInfo, 2026,
      new Date('2026-09-10T03:00:00Z'),
    );
    expect(result.eligible).toBe(false);
  });
});
