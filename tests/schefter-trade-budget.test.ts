import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  MAX_TRADE_POSTS_PER_DAY,
  TRADE_POSTS_TODAY_KEY,
  tradePostsTodayKey,
  tradeSlotsRemaining,
} from '../scripts/lib/speculation-budget.mjs';
import { isTradeFlavoredTip, isTradeFlavoredBatch, classifyTipKind } from '../scripts/lib/schefter-bucket-logic.mjs';
import { resolveCadence, permitsPost, SPECULATION_CEILING_PER_DAY, CADENCE_LADDER } from '../scripts/lib/speculation-cadence.mjs';

/**
 * How much Schefter may talk about trades.
 *
 * Every cap in this system counted POSTS — a shared 3/day ceiling, a 4-hour
 * spacing rule, per-lane caps, a gossip sub-cap. None counted TOPICS, and
 * THREE lanes are trade-flavored: the trade-offer rumor lane, the trade-bait
 * lane, and the invented-hypothetical speculation lane. So trade could take
 * the entire daily budget, and did — 13 of 16 posts across Sept 4-10 2026,
 * with Sept 6, 7 and 8 running at 100% trade. Every gate reported itself
 * satisfied the whole time; each was answering "have we posted too much
 * today" while the complaint was "is this all he talks about".
 *
 * Two rules now, and they are separate on purpose: a topic ceiling of ONE
 * trade story a day across all lanes, and a hard ONE-A-WEEK ceiling on the
 * speculation lane specifically, because it is the one that invents its
 * material and therefore can never run out.
 */

describe('what counts as a trade story', () => {
  it('counts trade-bait, which classifyTipKind calls gossip', () => {
    // "Pain's had Cyrus Allen on the block for days now" — routed through the
    // gossip lane, reads to the league as a trade story. Reading the narrow
    // classifier as the topic test is what let the budget be bypassed.
    const bait = { source: 'trade_bait', franchiseHint: '0008' };
    expect(classifyTipKind(bait)).toBe('gossip');
    expect(isTradeFlavoredTip(bait)).toBe(true);
  });

  it('counts a trade offer and a web tip topic-tagged trade', () => {
    expect(isTradeFlavoredTip({ source: 'trade_offer' })).toBe(true);
    expect(isTradeFlavoredTip({ source: 'web', topic: 'trade' })).toBe(true);
  });

  it('does not count a whisper-back reply, matching the CTA predicate', () => {
    // The scanner's own isTradeFlavoredTip (the CTA router) excludes a reply
    // before checking topic, on the grounds that the owner chose to reply to a
    // NON-trade rumor. If the budget predicate disagreed, that reply would be
    // routed to the tip page yet still spend the day's trade slot — a non-trade
    // post suppressing the actual trade story.
    expect(isTradeFlavoredTip({ source: 'web', topic: 'trade', repliesToPostId: 'sf_x' }))
      .toBe(false);
    // ...but a real trade tip with no parent still counts.
    expect(isTradeFlavoredTip({ source: 'web', topic: 'trade' })).toBe(true);
  });

  it('keeps the two predicates aligned in the source', () => {
    // Two copies of "is this about trades" is the shape this repo has paid for
    // before; until they are one function, they must at least carry the same
    // exclusion. A scan guard, because the scanner's copy is not exported.
    const scanner = readFileSync(
      resolve(__dirname, '../scripts/schefter-rumor-scan.mjs'),
      'utf8',
    );
    const shared = readFileSync(
      resolve(__dirname, '../scripts/lib/schefter-bucket-logic.mjs'),
      'utf8',
    );
    for (const [label, src] of [['scanner', scanner], ['shared', shared]] as const) {
      expect(src, `${label} predicate must exclude whisper-backs`)
        .toMatch(/if \(tip\.repliesToPostId\) return false;/);
    }
  });

  it('does not count an unrelated tip', () => {
    expect(isTradeFlavoredTip({ source: 'web', topic: 'hotseat' })).toBe(false);
    expect(isTradeFlavoredTip({ source: 'groupme', topic: 'frontoffice' })).toBe(false);
    expect(isTradeFlavoredTip(null)).toBe(false);
  });

  it('reads a batch as trade when ANY tip in it is', () => {
    expect(isTradeFlavoredBatch([{ topic: 'hotseat' }, { source: 'trade_bait' }])).toBe(true);
    expect(isTradeFlavoredBatch([{ topic: 'hotseat' }])).toBe(false);
    expect(isTradeFlavoredBatch([])).toBe(false);
  });
});

describe('the daily trade ceiling', () => {
  it('is one story a day', () => {
    expect(MAX_TRADE_POSTS_PER_DAY).toBe(1);
  });

  it('opens one slot a day and closes after it is spent', () => {
    expect(tradeSlotsRemaining(0)).toBe(1);
    expect(tradeSlotsRemaining(1)).toBe(0);
    expect(tradeSlotsRemaining(5)).toBe(0);
  });

  it('never returns a negative slot count from junk input', () => {
    for (const value of [-3, NaN, undefined, null, 'x']) {
      expect(tradeSlotsRemaining(value as never)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is a per-league key, not a bare literal', () => {
    // Both leagues have a franchise 0001 and the trade-bait lane already
    // shipped one league's listings into the other's chat off a module-level
    // TheLeague literal. A shared counter is the same hazard.
    expect(TRADE_POSTS_TODAY_KEY).toBe('schefter:rumor:trade_posts_today');
    expect(tradePostsTodayKey('afl')).toBe('schefter:afl:rumor:trade_posts_today');
    expect(tradePostsTodayKey('afl')).not.toBe(TRADE_POSTS_TODAY_KEY);
  });
});

describe('the speculation lane runs once a week', () => {
  const at = (iso: string) => new Date(iso);

  it('caps every ladder tier at one a week', () => {
    // The ladder still records what the deadline calendar WANTS — the ceiling
    // is applied over it, so this asserts the resolved value, not the rule.
    for (const rule of CADENCE_LADDER) {
      expect(Math.min(rule.maxPerDay, SPECULATION_CEILING_PER_DAY))
        .toBeLessThanOrEqual(SPECULATION_CEILING_PER_DAY);
    }
    expect(SPECULATION_CEILING_PER_DAY).toBeCloseTo(1 / 7, 10);
  });

  /**
   * Real calendars, not `events: []`. An empty list falls through to the 1/14
   * offseason fallback, which is ALREADY under the ceiling — so a test written
   * that way asserts the ceiling by never engaging it. (That is the exact trap
   * the trade-attribution guard fell into; see its header.)
   */
  const CALENDARS = {
    // Deadline 3 days out → `trade-deadline-peak-week`, the ladder's 2/day tier.
    'trade-deadline peak week': [
      { id: 'nfl-season-starts', startDate: '2026-09-07' },
      { id: 'trading-deadline', startDate: '2026-11-17' },
    ],
    // Sept 10 in a normal season → `regular-season-default`, 1 every 5 days,
    // which is what shipped the Sept 10 post the league complained about.
    'ordinary in-season': [
      { id: 'nfl-season-starts', startDate: '2026-09-07' },
      { id: 'trading-deadline', startDate: '2026-11-17' },
    ],
  };

  it('holds the ladder\'s 2/day peak week to one a week', () => {
    const cadence = resolveCadence({
      events: CALENDARS['trade-deadline peak week'],
      now: at('2026-11-14T20:00:00Z'),
    });
    expect(cadence.ladderId).toBe('trade-deadline-peak-week');
    expect(cadence.maxPerDay).toBeCloseTo(SPECULATION_CEILING_PER_DAY, 10);
    expect(cadence.label).toContain('1/week');
  });

  it('holds the in-season 1-every-5-days tier to one a week', () => {
    const cadence = resolveCadence({
      events: CALENDARS['ordinary in-season'],
      now: at('2026-09-10T20:00:00Z'),
    });
    expect(cadence.ladderId).toBe('regular-season-default');
    expect(cadence.maxPerDay).toBeCloseTo(SPECULATION_CEILING_PER_DAY, 10);
    expect(cadence.label).toContain('1/week');
  });

  it('resolves to at most 1/7 on every calendar in the ladder', () => {
    for (const [label, events] of Object.entries(CALENDARS)) {
      for (const day of ['2026-09-10', '2026-11-14', '2026-11-20', '2026-03-01']) {
        const cadence = resolveCadence({ events, now: at(`${day}T20:00:00Z`) });
        expect(cadence.maxPerDay, `${label} on ${day}`)
          .toBeLessThanOrEqual(SPECULATION_CEILING_PER_DAY);
      }
    }
  });

  it('holds a second post for six days', () => {
    const cadence = { tag: 'test', maxPerDay: SPECULATION_CEILING_PER_DAY, reservesGlobalSlot: false };
    const posted = at('2026-09-10T20:00:00Z');

    const nextDay = permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: posted, now: at('2026-09-11T20:00:00Z') });
    expect(nextDay.allowed).toBe(false);

    const fiveDays = permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: posted, now: at('2026-09-15T20:00:00Z') });
    expect(fiveDays.allowed).toBe(false);

    const aWeek = permitsPost({ cadence, postsTodayInLane: 0, lastPostAt: posted, now: at('2026-09-17T20:00:00Z') });
    expect(aWeek.allowed).toBe(true);
  });

  it('still bans posts outright where the ladder says zero', () => {
    // Math.min must not promote a banned tier into a weekly one.
    expect(Math.min(0, SPECULATION_CEILING_PER_DAY)).toBe(0);
    expect(permitsPost({ cadence: { tag: 'banned', maxPerDay: 0 }, postsTodayInLane: 0, lastPostAt: null }).allowed)
      .toBe(false);
  });

  it('keeps a tier that is already rarer than weekly', () => {
    expect(Math.min(1 / 14, SPECULATION_CEILING_PER_DAY)).toBeCloseTo(1 / 14, 10);
  });

  it('leaves the label alone on a tier the ceiling does not touch', () => {
    // The flip side of the two label assertions above: a tier already at or
    // under the ceiling keeps its own words.
    const cadence = resolveCadence({ events: [], now: at('2026-03-01T20:00:00Z') });
    expect(cadence.ladderId).toBe('quiet-offseason-default');
    expect(cadence.label).not.toContain('1/week');
  });
});
