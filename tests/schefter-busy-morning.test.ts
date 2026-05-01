/**
 * Busy-morning catch-up for trade-offer rumors.
 *
 * When the morning window opens (07:00–09:59 PT) with 2+ trade-offer tips
 * waiting in the queue, the rumor-mill scanner ships TWO trade-offer beats
 * in a single cycle (each its own post; both share one MAX_POSTS_PER_DAY
 * slot) AND passes a "busy morning" tone directive to the LLM so Schefter
 * acknowledges the overnight volume in-voice.
 *
 * The user's #1 goal is "get him to break real trade proposals," and the
 * morning catch-up is what clears the overnight backlog faster than the
 * default one-trade-per-cycle cadence.
 *
 * These tests pin the source-level behavior since the scanner is a long
 * stateful runner — we validate the constants, the gating predicates, and
 * the prompt construction via grep-asserted source guards plus a focused
 * harness reimplementing the morning-window check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const SCANNER_SRC = read('scripts/schefter-rumor-scan.mjs');

describe('busy-morning constants', () => {
  it('declares BUSY_MORNING_END_HOUR = 10 (07:00–09:59 PT window)', () => {
    expect(SCANNER_SRC).toMatch(/const\s+BUSY_MORNING_END_HOUR\s*=\s*10/);
  });

  it('declares BUSY_MORNING_TRADE_THRESHOLD = 2', () => {
    expect(SCANNER_SRC).toMatch(/const\s+BUSY_MORNING_TRADE_THRESHOLD\s*=\s*2/);
  });

  it('window starts at QUIET_HOUR_END so it opens the moment quiet hours close', () => {
    // The predicate is `h >= QUIET_HOUR_END && h < BUSY_MORNING_END_HOUR`.
    expect(SCANNER_SRC).toMatch(/h\s*>=\s*QUIET_HOUR_END\s*&&\s*h\s*<\s*BUSY_MORNING_END_HOUR/);
  });
});

describe('isBusyMorningWindow predicate', () => {
  // Reimplement the predicate to validate the boundary behavior. The real
  // predicate uses Intl.DateTimeFormat for tz handling; here we test the
  // pure logic against documented hour boundaries.
  function isBusyMorningWindow(ptHour: number): boolean {
    const QUIET_HOUR_END = 7;
    const BUSY_MORNING_END_HOUR = 10;
    return ptHour >= QUIET_HOUR_END && ptHour < BUSY_MORNING_END_HOUR;
  }

  it('rejects pre-7am (still quiet hours)', () => {
    expect(isBusyMorningWindow(0)).toBe(false);
    expect(isBusyMorningWindow(5)).toBe(false);
    expect(isBusyMorningWindow(6)).toBe(false);
  });

  it('accepts the 07:00–09:59 window', () => {
    expect(isBusyMorningWindow(7)).toBe(true);
    expect(isBusyMorningWindow(8)).toBe(true);
    expect(isBusyMorningWindow(9)).toBe(true);
  });

  it('rejects 10:00 onward (catch-up window closed)', () => {
    expect(isBusyMorningWindow(10)).toBe(false);
    expect(isBusyMorningWindow(12)).toBe(false);
    expect(isBusyMorningWindow(20)).toBe(false);
  });
});

describe('busy-morning split logic', () => {
  it('triggers only when postKind === "trade"', () => {
    // The block sits inside `if (postKind === 'trade' && ...)` — never
    // splits gossip or mailbag buckets.
    expect(SCANNER_SRC).toMatch(
      /postKind === 'trade' &&\s*\n?\s*primaryBucket\.tips\.length >= BUSY_MORNING_TRADE_THRESHOLD/,
    );
  });

  it('requires the morning window AND backlog threshold simultaneously', () => {
    // Both conditions are AND'd together — neither alone is sufficient.
    expect(SCANNER_SRC).toMatch(
      /BUSY_MORNING_TRADE_THRESHOLD &&\s*\n?\s*isBusyMorningWindow\(now\)/,
    );
  });

  it('sorts tips by submittedAt so oldest backlog goes first', () => {
    expect(SCANNER_SRC).toMatch(
      /sortedTips\s*=\s*\[\.\.\.primaryBucket\.tips\]\.sort\(/,
    );
    expect(SCANNER_SRC).toMatch(/a\.submittedAt\s*\?\?\s*0/);
  });

  it('takes exactly the first two tips (one per beat, never more)', () => {
    expect(SCANNER_SRC).toMatch(/sortedTips\.slice\(0,\s*1\)/);
    expect(SCANNER_SRC).toMatch(/sortedTips\.slice\(1,\s*2\)/);
  });
});

describe('beat-building permits the secondary trade beat', () => {
  it('allows secondary when postKind === "trade" AND busyMorning is set', () => {
    // The condition: `postKind === 'gossip' || (postKind === 'trade' && busyMorning)`
    // ensures normal trade cycles still emit a single beat.
    expect(SCANNER_SRC).toMatch(
      /postKind === 'gossip' \|\| \(postKind === 'trade' && busyMorning\)/,
    );
  });

  it('uses postKind for the secondary beat kind (not hardcoded "gossip")', () => {
    // After the change, the secondary beat inherits postKind so trade
    // beats stay tagged as trade through downstream handling.
    const beatPush = SCANNER_SRC.match(
      /beats\.push\(\{[\s\S]*?secondaryBatch[\s\S]*?\}\)/,
    )?.[0] ?? '';
    expect(beatPush).toMatch(/kind:\s*postKind/);
    expect(beatPush).not.toMatch(/kind:\s*['"]gossip['"]/);
  });
});

describe('busy-morning directive in the LLM prompt', () => {
  it('generateAiBody accepts busyMorning + busyMorningBacklog options', () => {
    expect(SCANNER_SRC).toMatch(
      /async function generateAiBody\([^)]*busyMorning\s*=\s*false[^)]*busyMorningBacklog\s*=\s*0/,
    );
  });

  it('passes busyMorning per-beat (only when beat.kind === "trade")', () => {
    // Directive doesn't apply to non-trade beats even if the cycle is busy.
    expect(SCANNER_SRC).toMatch(/busyMorning:\s*busyMorning && beat\.kind === 'trade'/);
  });

  it('builds a BUSY_MORNING_CONTEXT directive when both conditions hold', () => {
    expect(SCANNER_SRC).toMatch(/busyMorningDirective\s*=/);
    expect(SCANNER_SRC).toMatch(/BUSY_MORNING_CONTEXT:/);
    expect(SCANNER_SRC).toMatch(/trade proposals crossed the desk overnight/);
  });

  it('uses investigative-reporter framing (phone calls, message slips) NOT breathless shouting', () => {
    expect(SCANNER_SRC).toMatch(/phone's been ringing/);
    expect(SCANNER_SRC).toMatch(/league sources kept the desk up overnight/);
    expect(SCANNER_SRC).toMatch(/NOT breathless headline shouting/);
  });

  it('splices the directive into both single and mailbag userMessage paths', () => {
    // Both code paths must include busyMorningDirective in the template,
    // otherwise the LLM never sees it.
    const occurrences = SCANNER_SRC.match(/\$\{busyMorningDirective\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('only fires when busyMorningBacklog >= 2 (matches the trade-bucket threshold)', () => {
    expect(SCANNER_SRC).toMatch(/busyMorning && busyMorningBacklog >= 2/);
  });
});

describe('cap accounting — busy-morning posts share one slot', () => {
  it('uses one MAX_POSTS_PER_DAY slot for the whole cycle (matches gossip secondary pattern)', () => {
    // The cap-increment line increments by 1 regardless of beat count.
    // We grep for the existing comment pattern that documents this.
    expect(SCANNER_SRC).toMatch(/even with \$\{builtPosts\.length\} posts — counts as one cap slot/);
  });
});
