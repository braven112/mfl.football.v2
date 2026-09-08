/**
 * Tip-queue admission — does a tip that a producer actually enqueues survive
 * the scanner's own re-read?
 *
 * This is the regression that motivated the file. From 2026-04-30 to
 * 2026-09-03 the scanner required a truthy `text` on every queue item, while
 * `redactTradeOffer` built its tips with `text: ''` by design. Every
 * trade-offer tip was therefore enqueued, re-read, and silently discarded
 * within the same run — and since they were usually alone in the queue, the
 * "no fresh tips" branch then DELETED the queue. The enqueue logged success
 * every single time, so nothing looked wrong from the outside.
 *
 * The lesson these tests encode: assert against real producer output round-
 * tripped through JSON, never against a hand-built fixture that happens to
 * carry the fields the consumer wants. A fixture written by the same person
 * who wrote the consumer agrees with it by construction.
 */
import { describe, it, expect } from 'vitest';
import {
  dedupeTipsById,
  isUsableTip,
  TEXTLESS_TIP_SOURCES,
} from '../scripts/lib/schefter-tip-queue.mjs';
import { redactTradeOffer } from '../scripts/lib/redact-trade-offer.mjs';

type RedactorArgs = Parameters<typeof redactTradeOffer>[0];

function buildOfferArgs(): RedactorArgs {
  const rawOffer = {
    id: 'offer_admission_1',
    franchise: '0001',
    franchise2: '0002',
    franchise1_gave_up: '17472,15201',
    franchise2_gave_up: '16161',
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const playerMap = new Map<string, { name: string; position: string; nflTeam: string }>([
    ['17472', { name: "Ja'Marr Chase", position: 'WR', nflTeam: 'CIN' }],
    ['15201', { name: 'Breece Hall', position: 'RB', nflTeam: 'NYJ' }],
    ['16161', { name: 'Garrett Wilson', position: 'WR', nflTeam: 'NYJ' }],
  ]);
  const teamMap = new Map<string, { name: string; nameShort: string; division: string }>([
    ['0001', { name: 'Pacific Pigskins', nameShort: 'Pigskins', division: 'Pacific' }],
    ['0002', { name: 'Midwestside Connection', nameShort: 'Midwestside', division: 'Central' }],
  ]);
  return {
    rawOffer,
    offeringFid: '0001',
    playerMap,
    teamMap,
    counts: {
      ownerOfferCount7d: 1,
      divisionOfferCount7d: 0,
      playerHistory: new Map(),
    },
    currentYear: 2026,
    framingHint: 'fresh',
    offerAgeMs: 3 * 60 * 60 * 1000,
    exposureCount: 0,
    adpRankByPlayerId: new Map<string, number>([
      ['17472', 1],
      ['15201', 5],
      ['16161', 100],
    ]),
  } as RedactorArgs;
}

describe('tip-queue admission — the trade-offer round trip', () => {
  it('admits a real redactTradeOffer tip after a JSON round trip', () => {
    const result = redactTradeOffer(buildOfferArgs());
    expect(result.skip).toBeFalsy();

    // `redactTradeOffer` returns EITHER `{skip, reason}` or `{tip, debug}`, so
    // `tip` is optional on the result type. Throw rather than `!`-assert: if
    // the redactor ever starts skipping this offer the fixture has gone stale,
    // and that should say so instead of failing on a null deref two lines down.
    const { tip } = result;
    if (!tip) throw new Error(`redactTradeOffer skipped a well-formed offer: ${result.reason}`);

    // The precondition that made the bug invisible: the producer really does
    // emit an empty string here, and always has.
    expect(tip.text).toBe('');
    expect(tip.source).toBe('trade_offer');

    // Redis stores JSON strings; the scanner parses them back. Assert on the
    // round-tripped value, which is what the consumer actually sees.
    const roundTripped = JSON.parse(JSON.stringify(tip));
    expect(isUsableTip(roundTripped)).toBe(true);
  });

  it('would have failed under the old truthy-text rule', () => {
    const tip = JSON.parse(JSON.stringify(redactTradeOffer(buildOfferArgs()).tip));
    // The exact predicate that shipped for four months. Pinned so the
    // regression is legible rather than folklore.
    const oldRule = Boolean(tip && typeof tip === 'object' && tip.id && tip.text);
    expect(oldRule).toBe(false);
    expect(isUsableTip(tip)).toBe(true);
  });
});

describe('tip-queue admission — text-carrying sources still require text', () => {
  it('admits a web tip with text', () => {
    expect(isUsableTip({ id: 'sf_tip_1', source: 'web', text: 'Chase is available.' })).toBe(true);
  });

  it('rejects a web tip with an empty body — a human tip with no words is malformed', () => {
    expect(isUsableTip({ id: 'sf_tip_2', source: 'web', text: '' })).toBe(false);
  });

  it('rejects a GroupMe tip with an empty body', () => {
    expect(isUsableTip({ id: 'sf_tip_3', source: 'groupme', text: '' })).toBe(false);
  });

  it('keeps web and groupme out of the textless allowlist', () => {
    expect(TEXTLESS_TIP_SOURCES.has('web')).toBe(false);
    expect(TEXTLESS_TIP_SOURCES.has('groupme')).toBe(false);
    expect(TEXTLESS_TIP_SOURCES.has('trade_offer')).toBe(true);
  });
});

describe('tip-queue admission — structural rejects', () => {
  it('rejects a tip with no id regardless of source', () => {
    expect(isUsableTip({ source: 'trade_offer', text: '' })).toBe(false);
    expect(isUsableTip({ source: 'web', text: 'real text' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isUsableTip(null)).toBe(false);
    expect(isUsableTip(undefined)).toBe(false);
    expect(isUsableTip('a string')).toBe(false);
    expect(isUsableTip(42)).toBe(false);
  });

  it('rejects an unknown textless source — the allowlist is closed', () => {
    expect(isUsableTip({ id: 'x', source: 'some_future_lane', text: '' })).toBe(false);
  });
});

/**
 * Duplicate queue rows — the 2026-09-08 owner report.
 *
 * `scanTradeOffers` enqueues a row every time an offer passes its dice roll,
 * and an unposted row is requeued for up to seven days, so one offer that
 * rolled on two different days sat in the queue twice under the same
 * `to_<offerId>` id. The busy-morning split read two rows as two OFFERS and
 * shipped two beats about offer `to_1080` a second apart. Duplicate ids had
 * also been landing inside single batches — one published post's tipIds read
 * `to_1081, to_1078, to_1081, to_1078, to_1081, to_1076`.
 *
 * The per-offer repost cooldown could never have caught it: that anchor is
 * stamped on DELIVERY, and duplicate rows deliver in the same cycle.
 */
describe('tip-queue dedupe — one row per tip id', () => {
  const HOUR = 60 * 60 * 1000;

  it('collapses two rows for the same offer into one', () => {
    const day1 = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 1_000 };
    const day2 = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 90_000 };
    expect(dedupeTipsById([day1, day2])).toHaveLength(1);
  });

  it('leaves genuinely distinct offers alone, in queue order', () => {
    const rows = ['to_1076', 'to_1078', 'to_1081'].map((id, i) => ({
      id,
      source: 'trade_offer',
      text: '',
      submittedAt: i * HOUR,
    }));
    expect(dedupeTipsById(rows).map((t) => t.id)).toEqual(['to_1076', 'to_1078', 'to_1081']);
  });

  it('keeps the NEWEST payload — a closure tip must not be swallowed by a stale live row', () => {
    // redactTradeOffer stamps `to_<offerId>` on EVERY tip for an offer, the
    // closure callback included, so a closure lands on the same id as the
    // live rows already queued. OFFER_CLOSED_KEY is written at enqueue,
    // before the tip ships, so a dropped closure is never retried — the stale
    // "still shopping" beat would ship in its place, permanently.
    const live = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: 1_000,
      framingHint: 'fresh',
      offerAgeMs: 3 * HOUR,
    };
    const closure = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: 900_000,
      framingHint: 'closure',
      offerAgeMs: 11 * 24 * HOUR,
      closure: { reason: 'accepted', daysOpen: 11, priorPosts: 3 },
    };
    const [kept] = dedupeTipsById([live, closure]);
    expect(kept.closure).toEqual({ reason: 'accepted', daysOpen: 11, priorPosts: 3 });
    expect(kept.framingHint).toBe('closure');
    // Arrival order must not decide it either.
    expect(dedupeTipsById([closure, live])[0].closure?.reason).toBe('accepted');
  });

  it('holds the closure across THREE rows — the compare tracks the newest row seen', () => {
    // Two rows behaved; three did not. Once a merge had happened the map held
    // the OLDEST timestamp, so any later row beat the accumulated payload on a
    // timestamp it never had, and the closure was dropped exactly as before.
    const closure = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: 9_000,
      leadKind: 'closure',
      framingHint: 'closure',
    };
    const live = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 1_000, framingHint: 'fresh' };
    const changed = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 5_000, framingHint: 'changed' };
    for (const order of [
      [closure, live, changed],
      [live, changed, closure],
      [changed, closure, live],
    ]) {
      const [kept] = dedupeTipsById(order);
      expect(kept.leadKind).toBe('closure');
    }
  });

  it('gives a closure its OWN clock and a clean ledger, not the live row\'s budget', () => {
    // Dedupe runs at the queue read and the expiry/strike filter immediately
    // after it, so a closure that inherited a 6d23h-old row's submittedAt is
    // dropped as `expired` within the hour — and OFFER_CLOSED_KEY was written
    // at enqueue, so it never comes back.
    const SEVEN_DAYS = 7 * 24 * HOUR;
    const nearlyExpired = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: Date.now() - (SEVEN_DAYS - HOUR),
      suppressedStrikes: 2,
      firstSuppressedAt: Date.now() - 40 * HOUR,
    };
    const closure = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: Date.now(),
      leadKind: 'closure',
    };
    const [kept] = dedupeTipsById([nearlyExpired, closure]);
    expect(kept.leadKind).toBe('closure');
    expect(Date.now() - kept.submittedAt).toBeLessThan(HOUR);
    expect(kept.suppressedStrikes).toBeUndefined();
    expect(kept.firstSuppressedAt).toBeUndefined();
  });

  it('does NOT hand a live re-roll its own clock — only a closure is exempt', () => {
    // The exemption is for a terminal story sharing an id, never for another
    // copy of the same live one; otherwise the 7-day expiry stops biting.
    const first = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 1_000, framingHint: 'fresh' };
    const reroll = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 900_000, framingHint: 'changed' };
    const [kept] = dedupeTipsById([first, reroll]);
    expect(kept.framingHint).toBe('changed');
    expect(kept.submittedAt).toBe(1_000);
  });

  it('carries the NEWER row\'s framing and offer age, not the first sighting\'s', () => {
    // An ask-changed beat is enqueued as a later row; keeping the earlier one
    // wholesale shipped the old framing and understated how long the offer
    // had been sitting.
    const first = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: 1_000,
      framingHint: 'fresh',
      offerAgeMs: 3 * HOUR,
      exposure: 1,
    };
    const changed = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: 900_000,
      framingHint: 'changed',
      offerAgeMs: 50 * HOUR,
      exposure: 2,
    };
    const [kept] = dedupeTipsById([first, changed]);
    expect(kept.framingHint).toBe('changed');
    expect(kept.offerAgeMs).toBe(50 * HOUR);
    expect(kept.exposure).toBe(2);
  });

  it('keeps the EARLIEST submittedAt so the tip still ages out', () => {
    // submittedAt is the anchor for the framing, the age-boost and
    // TIP_EXPIRY_MS alike. Carrying the newest forward would let a re-rolled
    // offer refresh its own clock forever — the "dead proposals never leave"
    // failure of the 2026-09-07 insight, with a fresh timestamp each day. So
    // the payload comes from the newest row and the timestamp from the oldest.
    const older = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 1_000 };
    const newer = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 900_000 };
    expect(dedupeTipsById([older, newer])[0].submittedAt).toBe(1_000);
    // Order of arrival must not decide it.
    expect(dedupeTipsById([newer, older])[0].submittedAt).toBe(1_000);
  });

  it('folds strike state forward — a fresh copy cannot reset hold-and-strike', () => {
    const struck = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: 1_000,
      suppressedStrikes: 2,
      firstSuppressedAt: 50_000,
    };
    const fresh = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 900_000 };
    const [kept] = dedupeTipsById([struck, fresh]);
    expect(kept.suppressedStrikes).toBe(2);
    expect(kept.firstSuppressedAt).toBe(50_000);

    // ...including when the STRUCK row is the newer of the two, so the kept
    // row is the one that never carried the counter.
    const oldClean = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 1_000 };
    const newStruck = {
      id: 'to_1080',
      source: 'trade_offer',
      text: '',
      submittedAt: 900_000,
      suppressedStrikes: 3,
      firstSuppressedAt: 950_000,
    };
    const [merged] = dedupeTipsById([oldClean, newStruck]);
    expect(merged.submittedAt).toBe(1_000);
    expect(merged.suppressedStrikes).toBe(3);
    expect(merged.firstSuppressedAt).toBe(950_000);
  });

  it('does not invent a strike counter on a tip that never had one', () => {
    const a = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 1_000 };
    const b = { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 2_000 };
    expect(dedupeTipsById([a, b])[0]).not.toHaveProperty('suppressedStrikes');
  });

  it('survives the JSON round trip a real producer tip takes', () => {
    const tip = redactTradeOffer(buildOfferArgs()).tip;
    if (!tip) throw new Error('redactTradeOffer skipped a well-formed offer');
    const rowA = JSON.parse(JSON.stringify(tip));
    const rowB = JSON.parse(JSON.stringify(tip));
    rowB.submittedAt = (rowA.submittedAt ?? 0) + 24 * HOUR;
    const deduped = dedupeTipsById([rowA, rowB]);
    expect(deduped).toHaveLength(1);
    expect(isUsableTip(deduped[0])).toBe(true);
  });

  it('handles an empty queue and a single row', () => {
    expect(dedupeTipsById([])).toEqual([]);
    const one = { id: 'to_1', source: 'trade_offer', text: '', submittedAt: 1 };
    expect(dedupeTipsById([one])).toEqual([one]);
  });
});

describe('tip-queue dedupe — the function does not touch its inputs', () => {
  it('leaves every input row byte-identical', () => {
    const rows = [
      { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 1_000, suppressedStrikes: 2 },
      { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 900_000 },
      { id: 'to_1076', source: 'trade_offer', text: '', submittedAt: 5_000 },
    ];
    const before = JSON.stringify(rows);
    dedupeTipsById(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('answers the same on a second pass over the same array', () => {
    // Writing the merged fields onto a kept input row left two duplicates
    // sharing a timestamp, and the newest-wins compare then broke that tie by
    // arrival order — so calling twice kept the other row.
    const rows = [
      { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 1_000, framingHint: 'fresh' },
      { id: 'to_1080', source: 'trade_offer', text: '', submittedAt: 900_000, framingHint: 'changed' },
    ];
    expect(dedupeTipsById(rows)).toEqual(dedupeTipsById(rows));
    expect(dedupeTipsById(rows)[0].framingHint).toBe('changed');
  });
});
