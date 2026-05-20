/**
 * Feature 7 — "saying no, out loud" (quiet-day post).
 *
 * Tests `evaluateQuietDayConditions` — the pure decision function that
 * decides whether the scanner should ship a candid slow-news-day post in
 * place of going silent. Cooldown + Redis state are caller concerns and
 * tested via the scanner-source contract assertions at the bottom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — .mjs imported via allowJs
import { evaluateQuietDayConditions } from '../scripts/schefter-rumor-scan.mjs';

const ctxEntry = (overrides: Record<string, unknown> = {}) => ({
  hashedOwnerId: 'placeholder',
  tipsInQueue: 1,
  rumorsTotal: 0,
  isFirstTime: true,
  isProlific: false,
  beat: null,
  ...overrides,
});

describe('evaluateQuietDayConditions', () => {
  it('refuses when a normal bucket pick is available (no quiet day if there is real news)', () => {
    const result = evaluateQuietDayConditions({
      pick: { primary: {}, secondary: null },
      mailbagBatch: null,
      freshTips: [],
      normalLaneBuckets: [],
      staleBuckets: [],
      tipsterContext: new Map(),
    });
    expect(result.shouldFire).toBe(false);
    expect(result.reason).toBe('normal-pick-available');
  });

  it('refuses when the Friday mailbag is already firing', () => {
    const result = evaluateQuietDayConditions({
      pick: null,
      mailbagBatch: [{ id: 't1' }],
      freshTips: [],
      normalLaneBuckets: [],
      staleBuckets: [],
      tipsterContext: new Map(),
    });
    expect(result.shouldFire).toBe(false);
    expect(result.reason).toBe('mailbag-active');
  });

  it('fires when the queue is empty (the most honest quiet day)', () => {
    const result = evaluateQuietDayConditions({
      pick: null,
      mailbagBatch: null,
      freshTips: [],
      normalLaneBuckets: [],
      staleBuckets: [],
      tipsterContext: new Map(),
    });
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toBe('queue-empty');
    expect(result.queueSize).toBe(0);
  });

  it('fires when the only voice in the queue is a single prolific tipster', () => {
    const ctx = new Map([
      ['busy0001', ctxEntry({ hashedOwnerId: 'busy0001', isProlific: true, isFirstTime: false, rumorsTotal: 50 })],
    ]);
    const result = evaluateQuietDayConditions({
      pick: null,
      mailbagBatch: null,
      freshTips: [
        { id: 't1', source: 'web', hashedOwnerId: 'busy0001' },
        { id: 't2', source: 'web', hashedOwnerId: 'busy0001' },
        { id: 't3', source: 'web', hashedOwnerId: 'busy0001' },
      ],
      normalLaneBuckets: [],
      staleBuckets: [],
      tipsterContext: ctx,
    });
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toBe('single-prolific-tipster');
    expect(result.queueSize).toBe(3);
  });

  it('does NOT fire when the single queued tipster is just a regular (not prolific)', () => {
    const ctx = new Map([
      ['reg00003', ctxEntry({ hashedOwnerId: 'reg00003', rumorsTotal: 3, isProlific: false, isFirstTime: false })],
    ]);
    const result = evaluateQuietDayConditions({
      pick: null,
      mailbagBatch: null,
      freshTips: [{ id: 't1', source: 'web', hashedOwnerId: 'reg00003' }],
      normalLaneBuckets: [],
      staleBuckets: [],
      tipsterContext: ctx,
    });
    expect(result.shouldFire).toBe(false);
  });

  it('does NOT fire when two distinct tipsters have queued tips (real noise, not a quiet day)', () => {
    const ctx = new Map([
      ['busy0001', ctxEntry({ hashedOwnerId: 'busy0001', isProlific: true, rumorsTotal: 50 })],
      ['newbie01', ctxEntry({ hashedOwnerId: 'newbie01', isFirstTime: true })],
    ]);
    const result = evaluateQuietDayConditions({
      pick: null,
      mailbagBatch: null,
      freshTips: [
        { id: 't1', source: 'web', hashedOwnerId: 'busy0001' },
        { id: 't2', source: 'web', hashedOwnerId: 'newbie01' },
      ],
      normalLaneBuckets: [],
      staleBuckets: [],
      tipsterContext: ctx,
    });
    expect(result.shouldFire).toBe(false);
  });

  it('fires when only stale buckets remain (queue is all 3-week repeats)', () => {
    const result = evaluateQuietDayConditions({
      pick: null,
      mailbagBatch: null,
      freshTips: [
        { id: 't1', source: 'web', hashedOwnerId: 'mixed001' },
        { id: 't2', source: 'web', hashedOwnerId: 'mixed002' },
      ],
      normalLaneBuckets: [],
      staleBuckets: [{ key: 'topic:trade:0001' }, { key: 'topic:roster:league-wide' }],
      tipsterContext: new Map([
        ['mixed001', ctxEntry({ hashedOwnerId: 'mixed001', rumorsTotal: 4 })],
        ['mixed002', ctxEntry({ hashedOwnerId: 'mixed002', rumorsTotal: 4 })],
      ]),
    });
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toBe('all-stale');
  });

  it('does NOT fire when there is a non-stale normal-lane bucket (gossip cap is the only blocker)', () => {
    // Caller-side scenario: pick was null because gossipAllowedToday was
    // false, but a fresh non-stale bucket exists. Holding for next cycle is
    // correct here — quiet-day would be a lie when there is real news
    // queued up waiting for tomorrow's slot.
    const result = evaluateQuietDayConditions({
      pick: null,
      mailbagBatch: null,
      freshTips: [{ id: 't1', source: 'web', hashedOwnerId: 'mixed001' }],
      normalLaneBuckets: [{ key: 'topic:trade:0001' }],
      staleBuckets: [],
      tipsterContext: new Map([
        ['mixed001', ctxEntry({ hashedOwnerId: 'mixed001', rumorsTotal: 4 })],
      ]),
    });
    expect(result.shouldFire).toBe(false);
    expect(result.reason).toBe('no-quiet-day-trigger');
  });

  it('tolerates a missing tipsterContext gracefully', () => {
    const result = evaluateQuietDayConditions({
      pick: null,
      mailbagBatch: null,
      freshTips: [{ id: 't1', source: 'web', hashedOwnerId: 'busy0001' }],
      normalLaneBuckets: [],
      staleBuckets: [],
      tipsterContext: undefined,
    });
    // No context → can't verify prolific status → falls through to
    // no-quiet-day (single queued tip from an unknown is just a held tip).
    expect(result.shouldFire).toBe(false);
  });
});

// ── Scanner-source contracts (regression guards) ──

describe('rumor-scan quiet-day wiring', () => {
  const SRC = readFileSync(
    path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
    'utf8',
  );

  it('defines the cooldown key + the days-between constant', () => {
    expect(SRC).toMatch(/QUIET_DAY_LAST_DATE_KEY\s*=\s*'schefter:rumor:quiet_day_last_date'/);
    expect(SRC).toMatch(/QUIET_DAY_COOLDOWN_DAYS\s*=\s*\d+/);
  });

  it('calls the quiet-day path inside the no-pick branch', () => {
    // The decision helper must be invoked AFTER the normal pick is null
    // (so quiet day only fires when there is no real news to ship).
    expect(SRC).toMatch(/if\s*\(!pick\)\s*\{[\s\S]*?evaluateQuietDayConditions\(/);
  });

  it('respects the cooldown — bails out when last fired within QUIET_DAY_COOLDOWN_DAYS', () => {
    expect(SRC).toMatch(/ageDays\s*<\s*QUIET_DAY_COOLDOWN_DAYS/);
  });

  it('writes the quiet-day post to the feed but skips GroupMe (slow news day must not ping the chat)', () => {
    // The quiet-day post block uses loadFeed/fs.writeFile but never calls
    // postToGroupMe inside its branch. Lock the no-ping invariant by
    // confirming the surrounding "Deliberately NO GroupMe ping" note is
    // present — if anyone deletes it and adds a postToGroupMe call, the
    // test fails and the reviewer has to confront the design choice.
    expect(SRC).toMatch(/Deliberately NO GroupMe ping/);
  });
});
