/**
 * Hold-and-strike (Option A) invariant tests for the rumor-mill scanner.
 *
 * Locks two related contracts:
 *
 * 1. Multi-source promotion: anonymizeTips MUST count held tips (those
 *    carrying a `suppressedStrikes` marker from a previous cycle) toward
 *    the `franchise-multi-source` threshold. Without this, the cross-cycle
 *    corroboration story is broken — a held vague tip + a fresh corroborating
 *    tip would still ship as single-source and likely fail the gate again.
 *
 * 2. Hold-and-strike publish loop: source-pinning that the strike counter,
 *    requeue path, exhaustion archive, and allowed-only feed write all
 *    survive future refactors. These behaviors are local to main() so we
 *    grep the source rather than execute the loop.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore — sibling .mjs module, no .d.ts
import { anonymizeTips } from '../scripts/schefter-rumor-scan.mjs';

const SCANNER_SRC = readFileSync(
  path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
  'utf8',
);

const teams = new Map<string, { name: string; nameShort?: string; division?: string }>([
  ['0001', { name: 'Pacific Pigskins', nameShort: 'Pigskins', division: 'Northwest' }],
  ['0002', { name: 'Nashville Geeks', nameShort: 'Geeks', division: 'Northwest' }],
  ['0003', { name: 'Southwest Mafia', nameShort: 'Mafia', division: 'Southwest' }],
]);

describe('hold-and-strike — multi-source promotion across cycles (Option A)', () => {
  it('promotes scope to franchise-multi-source when two web tips name the same franchise', async () => {
    const now = Date.now();
    const tips = [
      { id: 't1', source: 'web', topic: 'roster', text: 'X is shopping a TE', franchiseHint: '0001', submittedAt: now },
      { id: 't2', source: 'web', topic: 'roster', text: 'Y heard the same', franchiseHint: '0001', submittedAt: now },
    ];
    const out = await anonymizeTips(tips, teams);
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[1].scope.kind).toBe('franchise-multi-source');
    expect(out[0].scope.sourceCount).toBe(2);
    expect(out[0].scope.franchise).toBe('Pigskins');
  });

  it('promotes ALSO when one tip has been previously suppressed (the cross-cycle invariant)', async () => {
    // The held tip carries `suppressedStrikes` and `firstSuppressedAt` from a
    // previous gate suppression. The fresh tip arrives this cycle. Both share
    // the same topic + franchise so they end up in the same bucket; the
    // multi-source check MUST count the held tip.
    const now = Date.now();
    const tips = [
      {
        id: 'held1',
        source: 'web',
        topic: 'roster',
        text: 'X is shopping a TE',
        franchiseHint: '0001',
        submittedAt: now - 60 * 60 * 1000,
        suppressedStrikes: 1,
        firstSuppressedAt: now - 60 * 60 * 1000,
      },
      {
        id: 'fresh1',
        source: 'web',
        topic: 'roster',
        text: 'Same — heard from another desk',
        franchiseHint: '0001',
        submittedAt: now,
      },
    ];
    const out = await anonymizeTips(tips, teams);
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[1].scope.kind).toBe('franchise-multi-source');
    expect(out[0].scope.sourceCount).toBe(2);
  });

  it('does NOT promote a held tip alone — single-source falls through to division fuzz', async () => {
    // No hashedOwnerId on the tip, so the `franchise-explicit-pick` lane is
    // also disabled. The scope falls through to division fuzz — which means
    // a re-eval cycle without a corroborating tip will likely re-suppress.
    // That's intentional: Option A is "strikes until corroboration arrives or
    // we age out", not "auto-promote everything that hangs around".
    const now = Date.now();
    const tips = [
      {
        id: 'held1',
        source: 'web',
        topic: 'roster',
        text: 'X is doing something',
        franchiseHint: '0001',
        submittedAt: now,
        suppressedStrikes: 1,
        firstSuppressedAt: now - 60 * 60 * 1000,
      },
    ];
    const out = await anonymizeTips(tips, teams);
    expect(out[0].scope.kind).not.toBe('franchise-multi-source');
    expect(['division', 'league-wide']).toContain(out[0].scope.kind);
  });

  it('promotes when both tips have been previously suppressed (re-eval still works after both held)', async () => {
    const now = Date.now();
    const tips = [
      {
        id: 'held1',
        source: 'web',
        topic: 'roster',
        franchiseHint: '0001',
        submittedAt: now - 2 * 60 * 60 * 1000,
        suppressedStrikes: 2,
        firstSuppressedAt: now - 2 * 60 * 60 * 1000,
      },
      {
        id: 'held2',
        source: 'web',
        topic: 'roster',
        franchiseHint: '0001',
        submittedAt: now - 30 * 60 * 1000,
        suppressedStrikes: 1,
        firstSuppressedAt: now - 30 * 60 * 1000,
      },
    ];
    const out = await anonymizeTips(tips, teams);
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[1].scope.kind).toBe('franchise-multi-source');
  });

  it('does not bridge across franchises — tips on different franchises stay single-source', async () => {
    const now = Date.now();
    const tips = [
      { id: 't1', source: 'web', topic: 'roster', franchiseHint: '0001', submittedAt: now, suppressedStrikes: 1, firstSuppressedAt: now },
      { id: 't2', source: 'web', topic: 'roster', franchiseHint: '0002', submittedAt: now },
    ];
    const out = await anonymizeTips(tips, teams);
    expect(out[0].scope.kind).not.toBe('franchise-multi-source');
    expect(out[1].scope.kind).not.toBe('franchise-multi-source');
  });

  it('does not count GroupMe tips toward multi-source (web-only by design)', async () => {
    // Per anonymizeTips: a GroupMe mention of franchise X isn't an anonymity
    // leak (the speaker publicly named it). The multi-source counter is
    // web-only. So 1 web held tip + 1 GroupMe tip on the same franchise
    // does NOT promote — the web tip stays single-source.
    const now = Date.now();
    const tips = [
      {
        id: 'webheld',
        source: 'web',
        topic: 'roster',
        franchiseHint: '0001',
        submittedAt: now,
        suppressedStrikes: 1,
        firstSuppressedAt: now - 60 * 60 * 1000,
      },
      {
        id: 'gm1',
        source: 'groupme',
        topic: 'roster',
        text: 'Pigskins are doing something',
        franchiseHint: '0001',
        submittedAt: now,
        attributable: true,
        author: 'Wabbit',
      },
    ];
    const out = await anonymizeTips(tips, teams);
    expect(out[0].scope.kind).not.toBe('franchise-multi-source');
    expect(out[1].scope.kind).toBe('groupme-public');
  });
});

describe('hold-and-strike — queue-load filter drops exhausted tips', () => {
  it('exposes MAX_SUPPRESSED_STRIKES = 3 and MAX_HELD_MS = 48h constants', () => {
    expect(SCANNER_SRC).toMatch(/const MAX_SUPPRESSED_STRIKES\s*=\s*3\b/);
    expect(SCANNER_SRC).toMatch(/const MAX_HELD_MS\s*=\s*48\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b/);
  });

  it('queue-load filter rejects tips with suppressedStrikes >= MAX_SUPPRESSED_STRIKES', () => {
    expect(SCANNER_SRC).toMatch(/if \(strikes >= MAX_SUPPRESSED_STRIKES\) return false/);
  });

  it('queue-load filter rejects tips held longer than MAX_HELD_MS', () => {
    expect(SCANNER_SRC).toMatch(/now\.getTime\(\) - t\.firstSuppressedAt > MAX_HELD_MS/);
  });
});

describe('hold-and-strike — publish loop classifies allowed vs held beats', () => {
  it('builds an allowedIndexSet from the gate results', () => {
    expect(SCANNER_SRC).toMatch(/const allowedIndexSet = new Set\(/);
    expect(SCANNER_SRC).toMatch(/g && g\.allow !== false/);
  });

  it('pushes suppressed tips back into the queue with suppressedStrikes incremented', () => {
    expect(SCANNER_SRC).toMatch(/suppressedStrikes:\s*strikes/);
    expect(SCANNER_SRC).toMatch(/heldTipsForRequeue\.push\(\{[\s\S]*?\.\.\.tip/);
  });

  it('stamps firstSuppressedAt the first time a tip is held (preserves on re-hold)', () => {
    expect(SCANNER_SRC).toMatch(/typeof tip\.firstSuppressedAt === 'number' \? tip\.firstSuppressedAt : now\.getTime\(\)/);
  });

  it('diverts strike-exhausted tips to heldTipsExhausted (not the requeue list)', () => {
    expect(SCANNER_SRC).toMatch(/strikes >= MAX_SUPPRESSED_STRIKES[\s\S]{0,200}heldTipsExhausted\.push/);
  });

  it('queue rewrite combines unusedTips and heldTipsForRequeue into one rpush', () => {
    expect(SCANNER_SRC).toMatch(/const requeueTips\s*=\s*\[\.\.\.unusedTips,\s*\.\.\.heldTipsForRequeue\]/);
  });

  it('archive only consumes allowed batch tip ids + strike-exhausted ids', () => {
    expect(SCANNER_SRC).toMatch(/const archiveTipIds\s*=\s*\[\.\.\.consumedTipIds,\s*\.\.\.heldTipsExhausted\.map/);
    expect(SCANNER_SRC).toMatch(/redis\.lpush\(TIPS_PROCESSED_KEY,\s*\.\.\.archiveTipIds\)/);
  });

  it('feed write only persists allowedPosts (held posts never enter the website feed)', () => {
    expect(SCANNER_SRC).toMatch(/feed\.posts\s*=\s*\[\s*\.\.\.allowedPosts,\s*\.\.\.existingPosts\s*\]/);
    expect(SCANNER_SRC).toMatch(/All beats suppressed — skipping feed write/);
  });

  it('GroupMe send loop iterates over allowedPosts only', () => {
    expect(SCANNER_SRC).toMatch(/for \(let i = 0; i < allowedPosts\.length; i\+\+\)\s*\{[\s\S]*?postToGroupMe\(groupMeTextFor\(allowedPosts\[i\]\)\)/);
  });

  it('tipster scorecard credit fires only for consumedBatch (allowed beats)', () => {
    expect(SCANNER_SRC).toMatch(/incrementTipsterCounters\([\s\S]*?batch:\s*consumedBatch/);
  });

  it('team-naming counter bumps only for allowed posts', () => {
    expect(SCANNER_SRC).toMatch(/for \(let i = 0; i < allowedPosts\.length; i\+\+\)[\s\S]*?recordTeamNaming/);
  });

  it('thread registry indexes only allowed posts', () => {
    expect(SCANNER_SRC).toMatch(/for \(const p of allowedPosts\)\s*\{[\s\S]*?p\.threadId/);
  });
});
