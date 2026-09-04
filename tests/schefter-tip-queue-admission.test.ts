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
import { isUsableTip, TEXTLESS_TIP_SOURCES } from '../scripts/lib/schefter-tip-queue.mjs';
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

    const tip = result.tip;
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
