import { describe, it, expect } from 'vitest';
import {
  shouldSkipTransaction,
  isNewTransaction,
  parseTransactionString,
  parseTradeAssets,
  parseDraftPickId,
  parseTransaction,
  classifyTier,
  generateHeadline,
  generateBody,
  generateMinorLine,
  transactionToPost,
  formatSalaryCompact,
  type PlayerInfo,
  type TeamInfo,
} from '../src/utils/schefter-transaction-parser';
import type { MFLRawTransaction } from '../src/types/schefter';

// ── Test Fixtures ──

const players: Map<string, PlayerInfo> = new Map([
  ['15331', { name: "Ja'Marr Chase", position: 'WR', nflTeam: 'CIN' }],
  ['10700', { name: 'Josh Allen', position: 'QB', nflTeam: 'BUF' }],
  ['15759', { name: 'Tank Bigsby', position: 'RB', nflTeam: 'JAC' }],
  ['14778', { name: 'Garrett Wilson', position: 'WR', nflTeam: 'NYJ' }],
  ['7836', { name: 'Julio Jones', position: 'WR', nflTeam: 'ATL' }],
  ['10695', { name: 'Ezekiel Elliott', position: 'RB', nflTeam: 'DAL' }],
]);

const teams: Map<string, TeamInfo> = new Map([
  ['0001', { name: 'Pacific Pigskins', abbrev: 'SKINS' }],
  ['0003', { name: 'Computer Jocks', abbrev: 'CJ' }],
  ['0004', { name: 'Dark Magicians', abbrev: 'DARK' }],
  ['0005', { name: 'Vitside Mafia', abbrev: 'VIT' }],
  ['0007', { name: 'Angry Chickens', abbrev: 'CHKN' }],
  ['0009', { name: 'The Dream', abbrev: 'DREAM' }],
  ['0010', { name: "Wabbit's Warriors", abbrev: 'WAB' }],
  ['0014', { name: 'Freak Show', abbrev: 'FREAK' }],
]);

// ── shouldSkipTransaction ──

describe('shouldSkipTransaction', () => {
  it('skips AUCTION_BID', () => {
    expect(shouldSkipTransaction({ type: 'AUCTION_BID' } as MFLRawTransaction)).toBe(true);
  });

  it('skips AUCTION_INIT', () => {
    expect(shouldSkipTransaction({ type: 'AUCTION_INIT' } as MFLRawTransaction)).toBe(true);
  });

  it('skips IR moves', () => {
    expect(shouldSkipTransaction({ type: 'IR' } as MFLRawTransaction)).toBe(true);
  });

  it('processes TRADE', () => {
    expect(shouldSkipTransaction({ type: 'TRADE' } as MFLRawTransaction)).toBe(false);
  });

  it('processes AUCTION_WON', () => {
    expect(shouldSkipTransaction({ type: 'AUCTION_WON' } as MFLRawTransaction)).toBe(false);
  });

  it('processes FREE_AGENT', () => {
    expect(shouldSkipTransaction({ type: 'FREE_AGENT' } as MFLRawTransaction)).toBe(false);
  });

  it('skips unknown types', () => {
    expect(shouldSkipTransaction({ type: 'SOME_UNKNOWN' } as MFLRawTransaction)).toBe(true);
  });
});

// ── isNewTransaction ──

describe('isNewTransaction', () => {
  it('returns true when timestamp is newer', () => {
    expect(isNewTransaction('1774444697', '1774400000')).toBe(true);
  });

  it('returns false when timestamp is equal', () => {
    expect(isNewTransaction('1774444697', '1774444697')).toBe(false);
  });

  it('returns false when timestamp is older', () => {
    expect(isNewTransaction('1774400000', '1774444697')).toBe(false);
  });

  it('handles zero watermark', () => {
    expect(isNewTransaction('1774444697', '0')).toBe(true);
  });
});

// ── formatSalaryCompact ──

describe('formatSalaryCompact', () => {
  it('formats millions', () => {
    expect(formatSalaryCompact(2_000_000)).toBe('$2.00M');
  });

  it('formats millions with cents', () => {
    expect(formatSalaryCompact(3_500_000)).toBe('$3.50M');
  });

  it('formats thousands', () => {
    expect(formatSalaryCompact(425_000)).toBe('$425K');
  });

  it('formats zero', () => {
    expect(formatSalaryCompact(0)).toBe('$0');
  });

  it('formats small numbers', () => {
    expect(formatSalaryCompact(500)).toBe('$500');
  });
});

// ── parseTransactionString ──

describe('parseTransactionString', () => {
  it('parses AUCTION_WON format: "15331|2000000|"', () => {
    const result = parseTransactionString('15331|2000000|', players);
    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('15331');
    expect(result[0].playerName).toBe("Ja'Marr Chase");
    expect(result[0].salary).toBe(2_000_000);
  });

  it('parses FREE_AGENT format: "|16608,"', () => {
    const result = parseTransactionString('|16608,', players);
    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('16608');
    expect(result[0].playerName).toBeUndefined(); // not in test fixtures
  });

  it('parses minimum salary auction: "15759|425000|"', () => {
    const result = parseTransactionString('15759|425000|', players);
    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('15759');
    expect(result[0].playerName).toBe('Tank Bigsby');
    expect(result[0].salary).toBe(425_000);
  });

  it('handles empty string', () => {
    expect(parseTransactionString('', players)).toHaveLength(0);
  });
});

// ── parseDraftPickId ──

describe('parseDraftPickId', () => {
  it('parses FP_0009_2026_3 correctly', () => {
    const pick = parseDraftPickId('FP_0009_2026_3', teams);
    expect(pick).not.toBeNull();
    expect(pick!.originalFranchiseId).toBe('0009');
    expect(pick!.year).toBe(2026);
    expect(pick!.round).toBe(3);
    expect(pick!.display).toBe("The Dream's 2026 3rd");
  });

  it('parses 1st round pick', () => {
    const pick = parseDraftPickId('FP_0010_2017_1', teams);
    expect(pick!.display).toBe("Wabbit's Warriors's 2017 1st");
  });

  it('parses 2nd round pick', () => {
    const pick = parseDraftPickId('FP_0005_2017_2', teams);
    expect(pick!.display).toBe("Vitside Mafia's 2017 2nd");
  });

  it('returns null for invalid format', () => {
    expect(parseDraftPickId('NOT_A_PICK', teams)).toBeNull();
  });

  it('handles unknown team', () => {
    const pick = parseDraftPickId('FP_9999_2026_1', teams);
    expect(pick!.display).toContain('Team 9999');
  });
});

// ── parseTradeAssets ──

describe('parseTradeAssets', () => {
  it('parses mixed players and picks', () => {
    const result = parseTradeAssets('7836,FP_0005_2017_2,FP_0009_2017_3,', players, teams);
    expect(result.players).toHaveLength(1);
    expect(result.players[0].playerName).toBe('Julio Jones');
    expect(result.picks).toHaveLength(2);
    expect(result.picks[0].round).toBe(2);
    expect(result.picks[1].round).toBe(3);
  });

  it('parses players only', () => {
    const result = parseTradeAssets('10695,', players, teams);
    expect(result.players).toHaveLength(1);
    expect(result.picks).toHaveLength(0);
  });

  it('parses picks only', () => {
    const result = parseTradeAssets('FP_0010_2017_1,', players, teams);
    expect(result.players).toHaveLength(0);
    expect(result.picks).toHaveLength(1);
  });

  it('handles empty string', () => {
    const result = parseTradeAssets('', players, teams);
    expect(result.players).toHaveLength(0);
    expect(result.picks).toHaveLength(0);
  });
});

// ── parseTransaction ──

describe('parseTransaction', () => {
  it('parses a TRADE transaction', () => {
    const raw: MFLRawTransaction = {
      type: 'TRADE',
      franchise: '0009',
      franchise2: '0010',
      timestamp: '1487525890',
      transaction: '',
      franchise1_gave_up: '7836,FP_0005_2017_2,FP_0009_2017_3,',
      franchise2_gave_up: '10695,FP_0010_2017_1,',
      comments: '',
    };
    const result = parseTransaction(raw, players, teams);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('TRADE');
    expect(result!.franchiseId).toBe('0009');
    expect(result!.franchiseId2).toBe('0010');
    // franchise1 acquired what franchise2 gave up
    expect(result!.playersAcquired).toHaveLength(1);
    expect(result!.playersAcquired[0].playerName).toBe('Ezekiel Elliott');
    expect(result!.picksAcquired).toHaveLength(1);
    // franchise1 gave up
    expect(result!.playersGivenUp).toHaveLength(1);
    expect(result!.playersGivenUp[0].playerName).toBe('Julio Jones');
    expect(result!.picksGivenUp).toHaveLength(2);
  });

  it('parses an AUCTION_WON transaction', () => {
    const raw: MFLRawTransaction = {
      type: 'AUCTION_WON',
      franchise: '0007',
      timestamp: '1774444697',
      transaction: '15331|2000000|',
    };
    const result = parseTransaction(raw, players, teams);
    expect(result!.type).toBe('AUCTION_WON');
    expect(result!.playersAcquired).toHaveLength(1);
    expect(result!.playersAcquired[0].playerName).toBe("Ja'Marr Chase");
    expect(result!.salary).toBe(2_000_000);
  });

  it('parses a FREE_AGENT transaction', () => {
    const raw: MFLRawTransaction = {
      type: 'FREE_AGENT',
      franchise: '0003',
      timestamp: '1771138552',
      transaction: '|15759,',
      by_commish: '1',
    };
    const result = parseTransaction(raw, players, teams);
    expect(result!.type).toBe('FREE_AGENT');
    expect(result!.byCommish).toBe(true);
    expect(result!.playersAcquired).toHaveLength(1);
  });

  it('normalizes WAIVER to FREE_AGENT', () => {
    const raw: MFLRawTransaction = {
      type: 'WAIVER',
      franchise: '0003',
      timestamp: '1771138552',
      transaction: '|15759,',
    };
    const result = parseTransaction(raw, players, teams);
    expect(result!.type).toBe('FREE_AGENT');
  });
});

// ── classifyTier ──

describe('classifyTier', () => {
  it('classifies TRADE as breaking', () => {
    const parsed = parseTransaction({
      type: 'TRADE', franchise: '0009', franchise2: '0010', timestamp: '1',
      transaction: '', franchise1_gave_up: '7836,', franchise2_gave_up: '10695,',
    }, players, teams)!;
    expect(classifyTier(parsed)).toBe('breaking');
  });

  it('classifies high-value AUCTION_WON as breaking', () => {
    const parsed = parseTransaction({
      type: 'AUCTION_WON', franchise: '0007', timestamp: '1',
      transaction: '15331|3500000|',
    }, players, teams)!;
    expect(classifyTier(parsed)).toBe('breaking');
  });

  it('classifies mid-value AUCTION_WON as standard', () => {
    const parsed = parseTransaction({
      type: 'AUCTION_WON', franchise: '0007', timestamp: '1',
      transaction: '14778|1900000|',
    }, players, teams)!;
    expect(classifyTier(parsed)).toBe('standard');
  });

  it('classifies low-value AUCTION_WON as minor', () => {
    const parsed = parseTransaction({
      type: 'AUCTION_WON', franchise: '0007', timestamp: '1',
      transaction: '15759|425000|',
    }, players, teams)!;
    expect(classifyTier(parsed)).toBe('minor');
  });

  it('classifies commish FREE_AGENT as minor', () => {
    const parsed = parseTransaction({
      type: 'FREE_AGENT', franchise: '0003', timestamp: '1',
      transaction: '|15759,', by_commish: '1',
    }, players, teams)!;
    expect(classifyTier(parsed)).toBe('minor');
  });
});

// ── generateHeadline ──

describe('generateHeadline', () => {
  it('generates trade headline with player names for simple trades', () => {
    const parsed = parseTransaction({
      type: 'TRADE', franchise: '0009', franchise2: '0010', timestamp: '1',
      transaction: '', franchise1_gave_up: '7836,', franchise2_gave_up: '10695,',
    }, players, teams)!;
    const headline = generateHeadline(parsed, teams);
    expect(headline).toContain('The Dream');
    expect(headline).toContain("Wabbit's Warriors");
  });

  it('generates auction headline with salary', () => {
    const parsed = parseTransaction({
      type: 'AUCTION_WON', franchise: '0007', timestamp: '1',
      transaction: '15331|2000000|',
    }, players, teams)!;
    const headline = generateHeadline(parsed, teams);
    expect(headline).toContain('Angry Chickens');
    expect(headline).toContain("Ja'Marr Chase");
    expect(headline).toContain('$2.00M');
  });

  it('generates free agent headline', () => {
    const parsed = parseTransaction({
      type: 'FREE_AGENT', franchise: '0003', timestamp: '1',
      transaction: '|15759,',
    }, players, teams)!;
    const headline = generateHeadline(parsed, teams);
    expect(headline).toContain('Computer Jocks');
    expect(headline).toContain('Tank Bigsby');
  });
});

// ── transactionToPost ──

describe('transactionToPost', () => {
  it('creates a valid SchefterPost from a trade', () => {
    const parsed = parseTransaction({
      type: 'TRADE', franchise: '0009', franchise2: '0010', timestamp: '1487525890',
      transaction: '', franchise1_gave_up: '7836,', franchise2_gave_up: '10695,',
    }, players, teams)!;
    const post = transactionToPost(parsed, teams, 'theleague');
    expect(post.id).toMatch(/^sf_/);
    expect(post.type).toBe('transaction');
    expect(post.transactionSubType).toBe('TRADE');
    expect(post.tier).toBe('breaking');
    expect(post.franchiseIds).toContain('0009');
    expect(post.franchiseIds).toContain('0010');
    expect(post.league).toBe('theleague');
    expect(post.timestamp).toBeTruthy();
  });

  it('creates a minor post for low-value auction', () => {
    const parsed = parseTransaction({
      type: 'AUCTION_WON', franchise: '0003', timestamp: '1774426954',
      transaction: '15759|425000|',
    }, players, teams)!;
    const post = transactionToPost(parsed, teams, 'theleague');
    expect(post.tier).toBe('minor');
    expect(post.transactionSubType).toBe('AUCTION_WON');
  });

  it('sets sourceTimestamp for dedup', () => {
    const parsed = parseTransaction({
      type: 'AUCTION_WON', franchise: '0007', timestamp: '1774444697',
      transaction: '15331|2000000|',
    }, players, teams)!;
    const post = transactionToPost(parsed, teams, 'theleague');
    expect(post.sourceTimestamp).toBe('1774444697');
  });
});
