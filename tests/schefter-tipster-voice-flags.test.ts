/**
 * Tipster-aware voice flags surface from anonymizeTips. Locks the contract
 * between the per-cycle tipsterContext (built by buildTipsterContext from
 * Redis) and the anonymized tip metadata the LLM prompt actually consumes:
 *
 *   - firstTimeTipster  → HARD RULE 22 (curiosity sparks)
 *   - prolificTipster   → HARD RULE 23 (grain of salt)
 *   - tipsterBeat       → HARD RULE 24 (standing beat — option B; NO codename)
 *
 * All three flags MUST NOT carry hashedOwnerId, franchise, or division. The
 * tipsterBeat field is allowed to carry the topic name only (per option B
 * design — codename-topic binding stays internal).
 */
import { describe, it, expect } from 'vitest';
import { anonymizeTips } from '../scripts/schefter-rumor-scan.mjs';

const teams = new Map<string, { name: string; nameShort?: string; division?: string }>([
  ['0001', { name: 'Pacific Pigskins', nameShort: 'Pigskins', division: 'Northwest' }],
  ['0002', { name: 'Nashville Geeks', nameShort: 'Geeks', division: 'Northwest' }],
]);

const baseTip = (overrides: Record<string, unknown>) => ({
  source: 'web',
  topic: 'roster',
  text: 'something',
  franchiseHint: 'league-wide',
  submittedAt: Date.now(),
  ...overrides,
});

const ctxEntry = (overrides: Record<string, unknown> = {}) => ({
  hashedOwnerId: 'placeholder',
  tipsInQueue: 1,
  rumorsTotal: 0,
  isFirstTime: true,
  isProlific: false,
  beat: null,
  ...overrides,
});

describe('anonymizeTips — tipster voice flags', () => {
  it('does not set tipster flags when no context is provided (back-compat default)', async () => {
    const tips = [baseTip({ id: 't1', hashedOwnerId: 'aaaa1111' })];
    const out = await anonymizeTips(tips, teams);
    expect(out[0].firstTimeTipster).toBeUndefined();
    expect(out[0].prolificTipster).toBeUndefined();
    expect(out[0].tipsterBeat).toBeUndefined();
  });

  it('surfaces firstTimeTipster when the context says so', async () => {
    const ctx = new Map([
      ['newbie01', ctxEntry({ hashedOwnerId: 'newbie01', isFirstTime: true })],
    ]);
    const tips = [baseTip({ id: 't1', hashedOwnerId: 'newbie01' })];
    const out = await anonymizeTips(tips, teams, [], new Date(), null, ctx);
    expect(out[0].firstTimeTipster).toBe(true);
    expect(out[0].prolificTipster).toBeUndefined();
  });

  it('surfaces prolificTipster when the context says so', async () => {
    const ctx = new Map([
      ['reg00003', ctxEntry({
        hashedOwnerId: 'reg00003',
        rumorsTotal: 50,
        isFirstTime: false,
        isProlific: true,
      })],
    ]);
    const tips = [baseTip({ id: 't1', hashedOwnerId: 'reg00003' })];
    const out = await anonymizeTips(tips, teams, [], new Date(), null, ctx);
    expect(out[0].firstTimeTipster).toBeUndefined();
    expect(out[0].prolificTipster).toBe(true);
  });

  it('surfaces tipsterBeat with ONLY the topic name (option B — no codename)', async () => {
    const ctx = new Map([
      ['reg00003', ctxEntry({
        hashedOwnerId: 'reg00003',
        rumorsTotal: 12,
        isFirstTime: false,
        isProlific: true,
        beat: { topic: 'trade', count: 9, total: 12, share: 0.75 },
      })],
    ]);
    const tips = [baseTip({ id: 't1', hashedOwnerId: 'reg00003', topic: 'trade' })];
    const out = await anonymizeTips(tips, teams, [], new Date(), null, ctx);
    // Exactly the topic — never the codename, hash, count, or share.
    expect(out[0].tipsterBeat).toEqual({ topic: 'trade' });
  });

  it('omits tipsterBeat when the context has no beat for the tipster', async () => {
    const ctx = new Map([
      ['reg00003', ctxEntry({
        hashedOwnerId: 'reg00003',
        rumorsTotal: 5,
        isFirstTime: false,
        beat: null,
      })],
    ]);
    const tips = [baseTip({ id: 't1', hashedOwnerId: 'reg00003' })];
    const out = await anonymizeTips(tips, teams, [], new Date(), null, ctx);
    expect(out[0].tipsterBeat).toBeUndefined();
  });

  it('does not surface flags for groupme tips (they have their own attribution path)', async () => {
    const ctx = new Map([
      ['gm00001', ctxEntry({ hashedOwnerId: 'gm00001', isFirstTime: true })],
    ]);
    const tips = [{
      id: 't1',
      source: 'groupme',
      topic: 'roster',
      text: 'public chat msg',
      author: 'Wabbit',
      attributable: true,
      hashedOwnerId: 'gm00001',
      submittedAt: Date.now(),
    }];
    const out = await anonymizeTips(tips, teams, [], new Date(), null, ctx);
    // GroupMe path returns early — the flags would step on the public-chat
    // attribution model. The voice cues are web-only.
    expect(out[0].firstTimeTipster).toBeUndefined();
    expect(out[0].prolificTipster).toBeUndefined();
  });

  it('does not surface flags for trade_offer tips (no tipster identity at all)', async () => {
    const ctx = new Map();
    const tips = [{
      id: 't1',
      source: 'trade_offer',
      topic: 'trade',
      submittedAt: Date.now(),
      framingHint: 'fresh',
      volumeHint: 'two-for-two',
      positionTokens: ['RB', 'WR'],
      pickTokens: [],
    }];
    const out = await anonymizeTips(tips, teams, [], new Date(), null, ctx);
    expect(out[0].firstTimeTipster).toBeUndefined();
    expect(out[0].prolificTipster).toBeUndefined();
    expect(out[0].tipsterBeat).toBeUndefined();
  });

  it('never leaks hashedOwnerId into the anonymized output regardless of flags', async () => {
    const ctx = new Map([
      ['newbie01', ctxEntry({ hashedOwnerId: 'newbie01', isFirstTime: true, beat: { topic: 'trade', count: 9, total: 12, share: 0.75 } })],
    ]);
    const tips = [baseTip({ id: 't1', hashedOwnerId: 'newbie01' })];
    const out = await anonymizeTips(tips, teams, [], new Date(), null, ctx);
    const serialized = JSON.stringify(out[0]);
    expect(serialized).not.toContain('newbie01');
  });
});
