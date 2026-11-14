import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  tradingWindowState,
  deadOfferReason,
  lastTradedAtByPlayer,
  tradingClosedPromptBlock,
} from '../scripts/lib/schefter-trading-window.mjs';

// MFL's real 2026 TRADE events (calendar export, Nov 2026).
const THELEAGUE_CAL = {
  calendar: {
    event: [
      { id: '8333802', type: 'TRADE', title: '', happens: '', start_time: '1794631500', end_time: '1799037900' },
    ],
  },
};
const AFL_CAL = [{ id: '8446868', type: 'TRADE', title: '', happens: '', start_time: '1795074300', end_time: '18' }];

const at = (iso: string) => new Date(iso);

describe('tradingWindowState — MFL calendar is the source of truth', () => {
  it('TheLeague: open Friday evening, closed the morning after the 8:45 PM PT deadline', () => {
    const before = tradingWindowState({ slug: 'theleague', leagueYear: 2026, now: at('2026-11-13T20:44:00-08:00'), calendar: THELEAGUE_CAL });
    expect(before.closed).toBe(false);
    expect(before.source).toBe('mfl');

    // The post that prompted this: Sat 2026-11-14, 8:06 AM PT.
    const after = tradingWindowState({ slug: 'theleague', leagueYear: 2026, now: at('2026-11-14T08:06:33-08:00'), calendar: THELEAGUE_CAL });
    expect(after.closed).toBe(true);
    expect(after.cutoffLabel).toBe('Fri, Nov 13 at 8:45 PM PT');
    expect(after.reopensISO).toBe(new Date(1799037900 * 1000).toISOString());
  });

  it("TheLeague: trading reopens at the event's end", () => {
    const s = tradingWindowState({ slug: 'theleague', leagueYear: 2026, now: new Date(1799037900 * 1000 + 60_000), calendar: THELEAGUE_CAL });
    expect(s.closed).toBe(false);
  });

  it("AFL: a junk end_time is ignored, so trading stays closed through the league year", () => {
    expect(tradingWindowState({ slug: 'afl-fantasy', leagueYear: 2026, now: at('2026-11-18T23:00:00-08:00'), calendar: AFL_CAL }).closed).toBe(false);
    const s = tradingWindowState({ slug: 'afl-fantasy', leagueYear: 2026, now: at('2026-12-20T12:00:00-08:00'), calendar: AFL_CAL });
    expect(s.closed).toBe(true);
    expect(s.reopensISO).toBeNull();
    expect(s.cutoffLabel).toBe('Wed, Nov 18 at 11:45 PM PT');
  });

  it('no calendar: falls back to the Constitution cutoff', () => {
    const s = tradingWindowState({ slug: 'theleague', leagueYear: 2026, now: at('2026-11-14T08:00:00-08:00'), calendar: null });
    expect(s.source).toBe('constitution');
    expect(s.closed).toBe(true);
    expect(tradingWindowState({ slug: 'theleague', leagueYear: 2026, now: at('2026-11-13T12:00:00-08:00') }).closed).toBe(false);
  });

  it('a league with no deadline is never closed', () => {
    expect(tradingWindowState({ slug: 'best-ball-1', leagueYear: 2026, now: at('2026-12-01T12:00:00-08:00') }).closed).toBe(false);
  });

  it('the prompt block forbids future-tense trade talk only while closed', () => {
    const closed = tradingWindowState({ slug: 'theleague', leagueYear: 2026, now: at('2026-11-14T08:00:00-08:00'), calendar: THELEAGUE_CAL });
    expect(tradingClosedPromptBlock(closed)).toMatch(/TRADING IS CLOSED/);
    expect(tradingClosedPromptBlock(closed)).toMatch(/did not get done/);
    expect(tradingClosedPromptBlock({ closed: false })).toBe('');
    expect(tradingClosedPromptBlock(null)).toBe('');
  });
});

describe('deadOfferReason — a proposal is dead once a player in it changes hands', () => {
  // McCaffrey (13130) went 0015 → 0016 on 2026-11-10 21:10 PT.
  const trades = {
    transactions: {
      transaction: [
        { type: 'TRADE', timestamp: '1794459004', franchise: '0015', franchise2: '0016', franchise1_gave_up: '13130,FP_0015_2027_3,', franchise2_gave_up: '12626,16620,FP_0016_2027_1,' },
      ],
    },
  };
  const lastTradedAt = lastTradedAtByPlayer(trades);
  const rosterOwnerByPlayerId = new Map([['13130', '0016'], ['15000', '0003'], ['15001', '0016']]);

  it('maps traded players to their latest trade, picks excluded', () => {
    expect(lastTradedAt.get('13130')).toBe(1794459004 * 1000);
    expect([...lastTradedAt.keys()].some((k) => k.startsWith('FP_'))).toBe(false);
  });

  it('dead: the player is now rostered outside the deal', () => {
    const offer = { franchise: '0015', franchise2: '0003', franchise1_gave_up: '13130,', franchise2_gave_up: '15000,', timestamp: '1794300000' };
    expect(deadOfferReason(offer, { rosterOwnerByPlayerId, lastTradedAt })).toMatch(/outside the deal/);
  });

  it("dead: the deal's own partner acquired the player in a different trade", () => {
    const offer = { franchise: '0015', franchise2: '0016', franchise1_gave_up: '13130,', franchise2_gave_up: '15001,', timestamp: '1794300000' };
    expect(deadOfferReason(offer, { rosterOwnerByPlayerId, lastTradedAt })).toMatch(/traded after/);
  });

  it('alive: a proposal made after the player last moved, between his owner and another team', () => {
    const offer = { franchise: '0016', franchise2: '0003', franchise1_gave_up: '13130,', franchise2_gave_up: '15000,', timestamp: '1794500000' };
    expect(deadOfferReason(offer, { rosterOwnerByPlayerId, lastTradedAt })).toBeNull();
  });

  it('no evidence is not death', () => {
    const offer = { franchise: '0001', franchise2: '0002', franchise1_gave_up: '99999,', franchise2_gave_up: 'FP_0002_2027_1,', timestamp: '1794300000' };
    expect(deadOfferReason(offer, {})).toBeNull();
  });
});

describe('rumor scan wiring', () => {
  const src = readFileSync('scripts/schefter-rumor-scan.mjs', 'utf8');

  it('skips the trade-offer lane while trading is closed', () => {
    expect(src).toMatch(/if \(tradingClosed\(\)\) \{[\s\S]{0,400}trade-offer lane skipped/);
  });
  it('drops queued offer / trade-block tips while trading is closed', () => {
    expect(src).toMatch(/tradingClosed\(\) && isLiveTradeTip\(t\)/);
  });
  it('never links the Trade Builder while trading is closed', () => {
    expect(src).toMatch(/const tradeFlavored = !tradingClosed\(\)/);
  });
  it('puts the closed-trading rule in the system prompt', () => {
    expect(src).toMatch(/tradingClosedPromptBlock\(TRADING_STATE\)/);
  });
  it('drops dead offers before they are counted', () => {
    const dead = src.indexOf('deadOfferReason(raw');
    const runs = src.indexOf('const positionRuns = new Map()');
    expect(dead).toBeGreaterThan(0);
    expect(dead).toBeLessThan(runs);
  });
});
