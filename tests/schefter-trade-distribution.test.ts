import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FEED_ONLY_BYPASSABLE_GATES,
  IN_SEASON_TRADE_CHAT_PER_WEEK,
  OFFSEASON_TRADE_CHAT_PER_WEEK,
  TRADE_CHAT_MIN_SCORE,
  TRADE_CHAT_WINDOW_MS,
  TRADE_LANE_SOURCES,
  isTradeLaneBatch,
  isTradeLaneTip,
  recentChatPings,
  resolveTradeChatPing,
  tradeChatAllowanceReason,
  tradeChatMinGapMs,
  tradeChatWeeklyAllowance,
  tradeLaneMayBypass,
} from '../scripts/lib/schefter-trade-distribution.mjs';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
const SCANNER = read('scripts/schefter-rumor-scan.mjs');

const DAY = 24 * 60 * 60 * 1000;
// Mid-October: a season is being played in both leagues, and outside every
// deadline window (TheLeague Nov 13, the AFL the Wednesday between weeks
// 10 and 11).
const IN_SEASON = new Date('2026-10-14T19:00:00Z');
// Mid-May: no season, no deadline.
const OFFSEASON = new Date('2026-05-14T19:00:00Z');

describe('which tips are a trade beat', () => {
  it('counts both trade lanes, and only those', () => {
    expect([...TRADE_LANE_SOURCES].sort()).toEqual(['trade_bait', 'trade_offer']);
    expect(isTradeLaneTip({ source: 'trade_offer' })).toBe(true);
    expect(isTradeLaneTip({ source: 'trade_bait' })).toBe(true);
    expect(isTradeLaneTip({ source: 'web', topic: 'trade' })).toBe(false);
    expect(isTradeLaneTip({ source: 'groupme', topic: 'trade' })).toBe(false);
    expect(isTradeLaneTip(null)).toBe(false);
  });

  it('needs EVERY tip in the batch, and at least one', () => {
    // Under-claiming costs one extra chat post. Over-claiming mutes a tip an
    // owner wrote by hand, which is the whole reason the chat still exists.
    expect(isTradeLaneBatch([{ source: 'trade_offer' }, { source: 'trade_bait' }])).toBe(true);
    expect(isTradeLaneBatch([{ source: 'trade_offer' }, { source: 'web' }])).toBe(false);
    expect(isTradeLaneBatch([])).toBe(false);
    expect(isTradeLaneBatch(null)).toBe(false);
  });

  it('keys off the SOURCE, never the bucket kind', () => {
    // A trade-block listing buckets per franchise the way a topic tip does, so
    // reading the bucket would have left half the trade lane in the chat.
    const src = read('scripts/lib/schefter-trade-distribution.mjs');
    expect(src).toMatch(/tip\.source/);
    expect(src).not.toMatch(/\.kind === 'trade'/);
  });
});

describe('which gates a feed-only trade cycle may walk past', () => {
  it('bypasses the three CHAT budgets and nothing else', () => {
    expect([...FEED_ONLY_BYPASSABLE_GATES].sort()).toEqual([
      'mill-cap',
      'shared-budget',
      'spacing',
    ]);
    for (const code of ['shared-budget', 'mill-cap', 'spacing']) {
      expect(tradeLaneMayBypass(code)).toBe(true);
    }
  });

  it('never bypasses quiet hours, the LLM valve, or the marinate window', () => {
    // Quiet hours: a 3am beat reads as a bot whatever channel it lands in.
    // gen-attempts: a spend ceiling, not a cadence rule.
    // marinate / no-anchor: the tip is not ready to report yet.
    for (const code of ['quiet-hours', 'gen-attempts', 'marinate', 'no-anchor', undefined, null, '']) {
      expect(tradeLaneMayBypass(code as string)).toBe(false);
    }
  });

  it('is matched on the gate CODE, so a copy-edit cannot open the lane', () => {
    // Every refusal in checkGates carries a blockedBy code beside its prose.
    for (const code of ['quiet-hours', 'shared-budget', 'mill-cap', 'gen-attempts', 'spacing', 'no-anchor', 'marinate']) {
      expect(SCANNER).toContain(`blockedBy: '${code}'`);
    }
    expect(SCANNER).toMatch(/tradeLaneMayBypass\(gates\.blockedBy\)/);
  });
});

describe('the weekly chat allowance inverts with the calendar', () => {
  it('is one a week in season, three in the offseason', () => {
    expect(IN_SEASON_TRADE_CHAT_PER_WEEK).toBe(1);
    expect(OFFSEASON_TRADE_CHAT_PER_WEEK).toBe(3);
    expect(tradeChatWeeklyAllowance('theleague', IN_SEASON)).toBe(1);
    expect(tradeChatWeeklyAllowance('theleague', OFFSEASON)).toBe(3);
    expect(tradeChatWeeklyAllowance('afl-fantasy', IN_SEASON)).toBe(1);
    expect(tradeChatWeeklyAllowance('afl-fantasy', OFFSEASON)).toBe(3);
  });

  it('opens back up in each league\'s own deadline run-up', () => {
    // TheLeague's deadline is a fixed Nov 13; the AFL's is the Wednesday
    // between weeks 10 and 11. A shared window would be wrong in both leagues
    // on both days, which is why the resolver is per league.
    expect(tradeChatWeeklyAllowance('theleague', new Date('2026-11-10T19:00:00Z'))).toBe(3);
    expect(tradeChatAllowanceReason('theleague', new Date('2026-11-10T19:00:00Z')))
      .toBe('trade-deadline window');
    expect(tradeChatAllowanceReason('theleague', IN_SEASON)).toBe('in season');
    expect(tradeChatAllowanceReason('theleague', OFFSEASON)).toBe('offseason');
  });

  it('spreads the allowance instead of letting it burst', () => {
    // Three pings in one afternoon and then six days of silence reads as one
    // spam burst, not as three stories.
    expect(tradeChatMinGapMs(1)).toBe(TRADE_CHAT_WINDOW_MS);
    expect(tradeChatMinGapMs(3)).toBe(Math.floor(TRADE_CHAT_WINDOW_MS / 3));
    expect(tradeChatMinGapMs(0)).toBe(TRADE_CHAT_WINDOW_MS);
  });

  it('measures the window as a ROLLING seven days', () => {
    const now = Date.parse('2026-05-14T19:00:00Z');
    const log = [now - 1 * DAY, now - 6 * DAY, now - 8 * DAY, now - 400 * DAY];
    expect(recentChatPings(log, now)).toEqual([now - 1 * DAY, now - 6 * DAY]);
    expect(recentChatPings(null, now)).toEqual([]);
    expect(recentChatPings(['nonsense', 0, -1], now)).toEqual([]);
  });
});

describe('resolveTradeChatPing — the one beat a week that earns the chat', () => {
  const nowMs = Date.parse('2026-05-14T19:00:00Z');
  const base = {
    nowMs,
    chatLog: [] as number[],
    allowance: 3,
    postsToday: 0,
    maxPostsPerDay: 3,
    lastPostTs: 0,
    minSpacingMs: 4 * 60 * 60 * 1000,
  };

  it('sends the highest-scoring beat that clears the bar', () => {
    const out = resolveTradeChatPing({
      ...base,
      candidates: [
        { index: 0, score: TRADE_CHAT_MIN_SCORE },
        { index: 1, score: 10 },
      ],
    });
    expect(out.index).toBe(1);
    expect(out.score).toBe(10);
  });

  it('holds when nothing clears the bar, however publishable', () => {
    // The publish bar (6, or 3 on a quiet week) asks whether a post is worth
    // READING. This asks whether it is worth interrupting sixteen people for.
    const out = resolveTradeChatPing({
      ...base,
      candidates: [{ index: 0, score: TRADE_CHAT_MIN_SCORE - 1 }],
    });
    expect(out.index).toBe(-1);
    expect(out.reason).toMatch(/chat bar/);
  });

  it('never pings on a null score', () => {
    // null means the scorer could not run. The feed fails OPEN on that and
    // costs a mediocre post; the chat fails CLOSED and costs nothing.
    const out = resolveTradeChatPing({ ...base, candidates: [{ index: 0, score: null }] });
    expect(out.index).toBe(-1);
  });

  it('refuses once the week\'s allowance is spent', () => {
    const out = resolveTradeChatPing({
      ...base,
      allowance: 1,
      chatLog: [nowMs - 2 * DAY],
      candidates: [{ index: 0, score: 10 }],
    });
    expect(out.index).toBe(-1);
    expect(out.reason).toMatch(/allowance spent/);
  });

  it('refuses inside the gap even with allowance left', () => {
    const out = resolveTradeChatPing({
      ...base,
      allowance: 3,
      chatLog: [nowMs - 1 * DAY],
      candidates: [{ index: 0, score: 10 }],
    });
    expect(out.index).toBe(-1);
    expect(out.reason).toMatch(/gap between chat pings/);
  });

  it('sends once the gap has passed and the week has room', () => {
    const out = resolveTradeChatPing({
      ...base,
      allowance: 3,
      chatLog: [nowMs - 3 * DAY],
      candidates: [{ index: 0, score: 9 }],
    });
    expect(out.index).toBe(0);
  });

  it('still obeys the shared chat budget and the spacing clock', () => {
    // A trade rumor landing ten minutes after a gossip post is the same
    // pile-up, arriving from two lanes.
    expect(
      resolveTradeChatPing({ ...base, postsToday: 3, candidates: [{ index: 0, score: 10 }] }).reason,
    ).toMatch(/shared chat budget/);
    expect(
      resolveTradeChatPing({
        ...base,
        lastPostTs: nowMs - 10 * 60 * 1000,
        candidates: [{ index: 0, score: 10 }],
      }).reason,
    ).toMatch(/chat spacing/);
  });

  it('always answers with a reason, even when it sends nothing', () => {
    // A lane that posts nothing and logs nothing is indistinguishable from a
    // broken one, and this cap will otherwise take the blame for every message
    // anybody thinks went missing.
    for (const out of [
      resolveTradeChatPing({ ...base, candidates: [] }),
      resolveTradeChatPing({ ...base, candidates: [{ index: 0, score: 2 }] }),
      resolveTradeChatPing({ ...base, candidates: [{ index: 0, score: 10 }] }),
    ]) {
      expect(typeof out.reason).toBe('string');
      expect(out.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('the scanner wires the split up the way the policy assumes', () => {
  it('routes chat per beat rather than posting every allowed beat', () => {
    expect(SCANNER).toMatch(/const chatIndexes = new Set\(\)/);
    expect(SCANNER).toMatch(/postToGroupMe\(groupMeTextFor\(allowedPosts\[i\]\), allowedPosts\[i\], \{ chat: chatIndexes\.has\(i\) \}\)/);
  });

  it('pushes on EVERY delivered beat, chat or not', () => {
    // Push is opt-in per owner and per category; the group chat is one room
    // everybody is in. Only the second one needs rationing.
    expect(SCANNER).toMatch(/async function postToGroupMe\(text, post = null, \{ chat = true \} = \{\}\) \{\s*\n\s*await pushRumor\(post\);/);
  });

  it('spends the chat budgets on the PING, not on the feed post', () => {
    expect(SCANNER).toMatch(/const chatDelivered = chatIndexes\.size > 0;/);
    expect(SCANNER).toMatch(/if \(chatDelivered\) \{[\s\S]{0,400}redis\.incr\(RUMOR_POSTS_TODAY_KEY\)/);
  });

  it('logs the trade chat decision either way', () => {
    expect(SCANNER).toMatch(/\[trade-chat\]/);
  });

  it('files no quiet-day post on a feed-only cycle', () => {
    // The quiet-day post spends the shared budget and the mill's own slot —
    // the exact slots a feed-only cycle was just refused.
    expect(SCANNER).toMatch(/if \(feedOnlyTradeCycle\) \{[\s\S]{0,200}return 0;/);
  });

  it('keeps the rolling chat log bounded by trimming on write', () => {
    expect(SCANNER).toMatch(/recentChatPings\(Array\.isArray\(parsed\) \? parsed : \[\], now\.getTime\(\)\)/);
    expect(SCANNER).toMatch(/RUMOR_TRADE_CHAT_LOG_KEY, JSON\.stringify\(next\)/);
  });

  it('counts feed-only posts but never gates on the count', () => {
    // The trade feed lane has no daily ceiling by design; the counter is the
    // only way to find out after the fact how loud a day actually got.
    expect(SCANNER).toMatch(/RUMOR_TRADE_FEED_POSTS_TODAY_KEY/);
    expect(SCANNER).not.toMatch(/>= *[A-Z_]*TRADE_FEED_POSTS/);
  });
});
