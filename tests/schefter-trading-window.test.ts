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

describe('deadline wrap-up', async () => {
  const {
    buildDeadlineWrapFacts, deadlineWrapTemplate, wrapHasStory, deadlineWrapSystemPrompt,
  } = await import('../scripts/lib/schefter-deadline-wrap.mjs');
  const cutoffMs = 1794631500 * 1000; // Fri 2026-11-13 8:45 PM PT
  // TheLeague's real trades in the run-up (MFL, Nov 2026).
  const completedTrades = [
    { type: 'TRADE', timestamp: '1794632843', franchise: '0015', franchise2: '0002', franchise1_gave_up: '16190,', franchise2_gave_up: '14136,FP_0002_2027_1,' },
    { type: 'TRADE', timestamp: '1794459004', franchise: '0015', franchise2: '0016', franchise1_gave_up: '13130,FP_0015_2027_3,', franchise2_gave_up: '12626,16620,FP_0016_2027_1,' },
    { type: 'TRADE', timestamp: '1794458988', franchise: '0002', franchise2: '0003', franchise1_gave_up: 'FP_0002_2027_2,', franchise2_gave_up: '16583,' },
    { type: 'TRADE', timestamp: '1794451000', franchise: '0008', franchise2: '0009', franchise1_gave_up: '16187,', franchise2_gave_up: '10700,' },
    { type: 'TRADE', timestamp: '1794450951', franchise: '0011', franchise2: '0001', franchise1_gave_up: '15287,15757,', franchise2_gave_up: '15284,14823,11675,16617,FP_0001_2027_2,' },
  ];
  const playerMap = new Map([
    ['13130', { name: 'McCaffrey, Christian' }],
    ['15000', { name: 'Nacua, Puka' }],
    ['15001', { name: 'Bijan Robinson' }],
  ]);
  const rosterOwnerByPlayerId = new Map([['13130', '0016'], ['15000', '0004'], ['15001', '0005']]);
  const offers = [
    // McCaffrey offer from his old team, made before he was traded → missed.
    { id: 'a', franchise: '0015', franchise2: '0007', franchise1_gave_up: '13130,', franchise2_gave_up: 'FP_0007_2027_1,', timestamp: '1794300000', expires: '1795000000' },
    // Still-valid offer, open at the deadline → may resurface.
    { id: 'b', franchise: '0004', franchise2: '0005', franchise1_gave_up: '15000,', franchise2_gave_up: '15001,', timestamp: '1794500000', expires: '1795000000' },
    // The same offer again (owner report + MFL) → counted once.
    { id: 'b', franchise: '0005', franchise2: '0004', franchise1_gave_up: '15001,', franchise2_gave_up: '15000,', timestamp: '1794500000', expires: '1795000000' },
    // Expired before the deadline → not "on the table".
    { id: 'c', franchise: '0004', franchise2: '0006', franchise1_gave_up: '15000,', franchise2_gave_up: '', timestamp: '1794000000', expires: '1794100000' },
    // Proposed after the deadline → not counted.
    { id: 'd', franchise: '0004', franchise2: '0006', franchise1_gave_up: '15000,', franchise2_gave_up: '', timestamp: '1794700000', expires: '1795000000' },
  ];
  const facts = buildDeadlineWrapFacts({
    offers, cutoffMs, completedTrades, rosterOwnerByPlayerId,
    lastTradedAt: lastTradedAtByPlayer(completedTrades), playerMap, rostersCarryOver: true,
  });

  it('counts deals left open at the deadline and deals done in the run-up', () => {
    expect(facts.openAtDeadline).toBe(2);
    // The 0015/0002 deal is stamped 9:07 PM PT, after the 8:45 PM cutoff, so it is not run-up.
    expect(facts.completedInRunup).toBe(4);
    expect(wrapHasStory(facts)).toBe(true);
  });

  it('a traded player is a missed opportunity; an untouched deal may resurface in a carry-over league', () => {
    expect(facts.missedPlayers).toEqual(['Christian McCaffrey']);
    expect(facts.stillAlivePlayers.length).toBe(1);
    const text = deadlineWrapTemplate(facts, 'Fri, Nov 13 at 8:45 PM PT');
    expect(text).toMatch(/none of them got done/);
    expect(text).toMatch(/Christian McCaffrey talks are a missed opportunity/);
    expect(text).toMatch(/offseason/);
    expect(text).not.toMatch(/more to come|coming|imminent/i);
  });

  it('no offseason line when rosters do not carry over', () => {
    const redraft = buildDeadlineWrapFacts({
      offers, cutoffMs, completedTrades, rosterOwnerByPlayerId,
      lastTradedAt: lastTradedAtByPlayer(completedTrades), playerMap, rostersCarryOver: false,
    });
    expect(deadlineWrapTemplate(redraft, null)).not.toMatch(/offseason/);
  });

  it('nothing open and nothing done is no story', () => {
    expect(wrapHasStory(buildDeadlineWrapFacts({ offers: [], cutoffMs, completedTrades: [], rostersCarryOver: true }))).toBe(false);
  });

  it('the model is told past tense, no teams, and the carry-over rule', () => {
    const sys = deadlineWrapSystemPrompt();
    expect(sys).toMatch(/past tense/);
    expect(sys).toMatch(/NEVER name a fantasy team/);
    expect(sys).toMatch(/rostersCarryOver is false, do not mention the offseason/);
  });

  it('the scanner posts the wrap once per deadline, before the offer lane is skipped', () => {
    const src = readFileSync('scripts/schefter-rumor-scan.mjs', 'utf8');
    expect(src).toMatch(/trade_deadline_wrap:/);
    expect(src.indexOf('await maybePostDeadlineWrap(')).toBeLessThan(src.indexOf('trade-offer lane skipped'));
  });
});
