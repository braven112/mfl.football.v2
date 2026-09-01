/**
 * Blind-bid waiver claim validation.
 *
 * TheLeague is BBID_FCFS with a $425,000 minimum and $25,000 increments, so a
 * mistyped bid is rejected by MFL long after the owner has left the page. These
 * rules run before the write so the owner sees every problem at once.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  readBidRules,
  validateClaims,
  validateRound,
  buildPicksParam,
  waiverImportType,
  conferenceOfFranchise,
  freeAgencyIsLeagueWide,
  NO_DROP,
  type ClaimValidationContext,
} from '../src/utils/waiver-claim';

const RULES = { system: 'bbid' as const, blindBid: true, minimum: 425000, increment: 25000, conditional: true, maxRounds: 4 };
const ctx = (over: Partial<ClaimValidationContext> = {}): ClaimValidationContext => ({
  rules: RULES,
  availableBalance: 2_000_000,
  rosterPlayerIds: new Set(['1111', '2222']),
  freeAgentIds: new Set(['9001', '9002', '9003']),
  ...over,
});

describe('readBidRules — from the live league payload, never hardcoded', () => {
  it("matches TheLeague's committed league feed", () => {
    const p = path.join(process.cwd(), 'data/theleague/mfl-feeds/2026/league.json');
    const rules = readBidRules(JSON.parse(fs.readFileSync(p, 'utf-8')).league);
    expect(rules).toEqual({ system: 'bbid', blindBid: true, minimum: 425000, increment: 25000, conditional: true, maxRounds: 4 });
  });

  it('never yields a zero increment, which would divide by zero on every bid', () => {
    expect(readBidRules({ bbidIncrement: '0' }).increment).toBe(1);
    expect(readBidRules({}).increment).toBe(1);
    expect(validateClaims([{ addPlayerId: '9001', bid: 7 }], ctx({ rules: { ...readBidRules({}), system: 'bbid', blindBid: true } }))).toEqual([]);
  });
});

describe('blindBid — not every league bids', () => {
  it('reads TheLeague as a blind-bid league', () => {
    const p = path.join(process.cwd(), 'data/theleague/mfl-feeds/2026/league.json');
    expect(readBidRules(JSON.parse(fs.readFileSync(p, 'utf-8')).league).blindBid).toBe(true);
  });

  it('reads the AFL as NOT a blind-bid league', () => {
    // WAIVERS_FCFS: rolling priority, no bidding. Submitting a blind bid there
    // is the wrong endpoint, and its bid rules do not exist — readBidRules
    // would otherwise fall back to a $0 minimum and accept any amount.
    const p = path.join(process.cwd(), 'data/afl-fantasy/mfl-feeds/2026/league.json');
    const rules = readBidRules(JSON.parse(fs.readFileSync(p, 'utf-8')).league);
    expect(rules.blindBid).toBe(false);
    expect(rules.minimum).toBe(0);
  });
});

describe('validateClaims', () => {
  it('accepts a legal claim', () => {
    expect(validateClaims([{ addPlayerId: '9001', bid: 425000, dropPlayerId: '1111' }], ctx())).toEqual([]);
  });

  it('rejects a bid under the minimum, and says the minimum', () => {
    const errs = validateClaims([{ addPlayerId: '9001', bid: 400000 }], ctx());
    expect(errs.join()).toMatch(/below the \$425,000 minimum/);
  });

  it('rejects a bid off the increment', () => {
    expect(validateClaims([{ addPlayerId: '9001', bid: 430000 }], ctx()).join())
      .toMatch(/multiple of \$25,000/);
  });

  it('rejects a bid above the remaining budget', () => {
    expect(validateClaims([{ addPlayerId: '9001', bid: 500000 }], ctx({ availableBalance: 450000 })).join())
      .toMatch(/exceeds your \$450,000 remaining/);
  });

  it('does NOT sum conditional claims against the budget', () => {
    // Four $425K alternatives total $1.7M, but MFL awards at most one, so an
    // owner with $500K can legally submit all four.
    const claims = ['9001', '9002', '9003'].map((addPlayerId) => ({ addPlayerId, bid: 425000 }));
    expect(validateClaims(claims, ctx({ availableBalance: 425000 }))).toEqual([]);
  });

  it('refuses to drop a player the franchise does not own', () => {
    expect(validateClaims([{ addPlayerId: '9001', bid: 425000, dropPlayerId: '7777' }], ctx()).join())
      .toMatch(/only drop a player on your own roster/);
  });

  it('refuses to add someone who is not a free agent', () => {
    expect(validateClaims([{ addPlayerId: '1111', bid: 425000 }], ctx()).join())
      .toMatch(/not a free agent/);
  });

  it('catches a duplicate claim on one player in the same round', () => {
    const dupe = [
      { addPlayerId: '9001', bid: 425000 },
      { addPlayerId: '9001', bid: 450000 },
    ];
    expect(validateClaims(dupe, ctx()).join()).toMatch(/already have a claim on this player/);
  });

  it('requires a drop when the roster is already full', () => {
    const full = ctx({ rosterPlayerIds: new Set(['1111', '2222']), rosterLimit: 2 });
    expect(validateClaims([{ addPlayerId: '9001', bid: 425000 }], full).join()).toMatch(/roster is full \(2\/2\)/);
    expect(validateClaims([{ addPlayerId: '9001', bid: 425000, dropPlayerId: '1111' }], full)).toEqual([]);
  });

  it('reports EVERY problem, not just the first', () => {
    const errs = validateClaims([{ addPlayerId: '9001', bid: 1 }, { addPlayerId: 'abc', bid: 425000 }], ctx());
    expect(errs.length).toBeGreaterThan(1);
  });

  it('rejects an empty board', () => {
    expect(validateClaims([], ctx())).toEqual(['Submit at least one claim.']);
  });
});

describe('priority waivers (AFL) — no bidding', () => {
  const PRIORITY = { ...RULES, system: 'priority' as const, blindBid: false, minimum: 0, increment: 1 };

  it('accepts a claim with no bid at all', () => {
    expect(validateClaims([{ addPlayerId: '9001', dropPlayerId: '1111' }], ctx({ rules: PRIORITY }))).toEqual([]);
  });

  it('still enforces roster and free-agent rules', () => {
    expect(validateClaims([{ addPlayerId: '9001', dropPlayerId: '7777' }], ctx({ rules: PRIORITY })).join())
      .toMatch(/only drop a player on your own roster/);
    expect(validateClaims([{ addPlayerId: '1111' }], ctx({ rules: PRIORITY })).join())
      .toMatch(/not a free agent/);
  });

  it('omits the bid from PICKS — a bid there would be read as the drop id', () => {
    expect(buildPicksParam([{ addPlayerId: '9001', dropPlayerId: '1111' }], 'priority')).toBe('9001_1111');
    expect(buildPicksParam([{ addPlayerId: '9001' }], 'priority')).toBe('9001_0000');
  });

  it('requires a round even though the league is not conditional', () => {
    expect(validateRound(undefined, { ...PRIORITY, conditional: false })).toMatch(/between 1 and 4/);
    expect(validateRound(3, { ...PRIORITY, conditional: false })).toBeNull();
  });

  it('picks the right MFL import type for each system', () => {
    expect(waiverImportType(RULES)).toBe('blindBidWaiverRequest');
    expect(waiverImportType(PRIORITY)).toBe('waiverRequest');
  });
});

describe('conference-scoped free agency', () => {
  it('reads TheLeague as league-wide and the AFL as conference-scoped', () => {
    const tl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/theleague/mfl-feeds/2026/league.json'), 'utf-8')).league;
    const afl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/afl-fantasy/mfl-feeds/2026/league.json'), 'utf-8')).league;
    expect(freeAgencyIsLeagueWide(tl)).toBe(true);
    // AFL is playerLimitUnit: CONFERENCE with duplicate players — a rival
    // conference's roster says nothing about your availability.
    expect(freeAgencyIsLeagueWide(afl)).toBe(false);
  });

  it('resolves a franchise\'s conference through the DIVISIONS map', () => {
    // MFL puts `conference` on the division, not the franchise.
    const afl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/afl-fantasy/mfl-feeds/2026/league.json'), 'utf-8')).league;
    expect(conferenceOfFranchise(afl, '0001')).toBe('00');
    expect(conferenceOfFranchise(afl, '0021')).toBe('01');
    expect(conferenceOfFranchise(afl, '9999')).toBeNull();
  });

  it('returns null in a league with no divisions', () => {
    expect(conferenceOfFranchise({}, '0001')).toBeNull();
  });
});

describe('buildPicksParam', () => {
  it('formats addId_bid_dropId, comma-separated, preserving priority order', () => {
    expect(
      buildPicksParam([
        { addPlayerId: '9001', bid: 425000, dropPlayerId: '1111' },
        { addPlayerId: '9002', bid: 450000 },
      ])
    ).toBe('9001_425000_1111,9002_450000_0000');
  });

  it('uses MFL\'s 0000 sentinel when not dropping', () => {
    expect(buildPicksParam([{ addPlayerId: '9001', bid: 425000, dropPlayerId: NO_DROP }]))
      .toBe('9001_425000_0000');
  });

  it('refuses a blind bid with no amount rather than sending a $0 bid', () => {
    expect(() => buildPicksParam([{ addPlayerId: '9001' }], 'bbid')).toThrow(/has no bid amount/);
  });

  it('never re-sorts — the order IS the conditional priority', () => {
    const claims = [
      { addPlayerId: '9003', bid: 425000 },
      { addPlayerId: '9001', bid: 900000 },
    ];
    expect(buildPicksParam(claims)).toBe('9003_425000_0000,9001_900000_0000');
  });
});

describe('validateRound', () => {
  it('requires a round in range when the league bids conditionally', () => {
    expect(validateRound(1, RULES)).toBeNull();
    expect(validateRound(4, RULES)).toBeNull();
    expect(validateRound(5, RULES)).toMatch(/between 1 and 4/);
    expect(validateRound(0, RULES)).toMatch(/between 1 and 4/);
    expect(validateRound(undefined, RULES)).toMatch(/between 1 and 4/);
    expect(validateRound(1.5, RULES)).toMatch(/between 1 and 4/);
  });

  it('ignores the round when the league does not bid conditionally', () => {
    expect(validateRound(undefined, { ...RULES, conditional: false })).toBeNull();
  });
});
