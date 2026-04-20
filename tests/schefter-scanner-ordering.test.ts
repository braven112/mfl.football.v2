/**
 * Source-level invariant tests for the Schefter scanners.
 *
 * Both scanners send messages to GroupMe. The feed file is the authoritative
 * record of what Schefter has said. If GroupMe is ever posted to without the
 * feed being written first, the site drifts out of sync with GroupMe —
 * exactly the incident we hit on 2026-04-18 when a pending-trade rumor
 * reached the group chat but was missing from /theleague/news.
 *
 * These tests pin the invariant at the source level so regressions in either
 * scanner script are caught in CI without needing a live GroupMe dry-run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('schefter-scan.mjs — scanPendingTrades feed-vs-GroupMe ordering', () => {
  const src = read('scripts/schefter-scan.mjs');

  // Isolate the scanPendingTrades function body so we don't accidentally
  // match code from other scan functions in the same file.
  const match = src.match(/async function scanPendingTrades[\s\S]+?\n\}\n/);
  if (!match) throw new Error('scanPendingTrades not found in scanner');
  const body = match[0];

  it('writes the feed to disk BEFORE posting to GroupMe', () => {
    // The previous implementation buffered new posts in memory and flushed
    // AFTER the loop, so a mid-loop throw could leave GroupMe ahead of the
    // feed. The fix moves fs.writeFile into the iteration, before postToGroupMe.
    const writeIdx = body.indexOf('await fs.writeFile(league.feedPath');
    const groupMeIdx = body.indexOf('postToGroupMe(groupMeText');
    expect(writeIdx).toBeGreaterThan(-1);
    expect(groupMeIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeLessThan(groupMeIdx);
  });

  it('wraps each trade iteration in its own try/catch', () => {
    // One bad trade (e.g. a malformed AI response) shouldn't block the rest
    // of the batch from persisting.
    expect(body).toMatch(/for \(const trade of newPending\)\s*\{\s*[\s\S]*?try\s*\{/);
    expect(body).toMatch(/\[rumor-mill\] Skipping trade \$\{offerId\} due to error/);
  });

  it('does not delete the post-loop feed write (watermark flush still runs)', () => {
    // After the loop we still need to persist the updated pendingTradeWatermark
    // and any non-post-array metadata. That final write must remain.
    const tail = body.slice(body.lastIndexOf('for (const trade of newPending)'));
    expect(tail).toMatch(/pendingTradeWatermark\s*=\s*Array\.from/);
    expect(tail).toMatch(/fs\.writeFile\(league\.feedPath/);
  });
});

describe('schefter-rumor-scan.mjs — main rumor-mill ordering', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('writes the feed to disk BEFORE posting to GroupMe (live path)', () => {
    // Feed-first is the invariant. The main rumor-mill post pipeline already
    // honored this; pinning it ensures future refactors don't swap the order.
    // GroupMe text now includes a tip-page URL appended to post.body, so we
    // match the live-call variable (groupMeText) instead of the old literal.
    //
    // The DRY_RUN block also calls postToGroupMe(groupMeText), so `indexOf`
    // alone would land on the dry-run call. Use `lastIndexOf` to land on the
    // live call and assert the feed write precedes it.
    const writeIdx = src.indexOf('await fs.writeFile(FEED_PATH');
    const groupMeIdx = src.lastIndexOf('await postToGroupMe(groupMeText)');
    expect(writeIdx).toBeGreaterThan(-1);
    expect(groupMeIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeLessThan(groupMeIdx);
  });
});
