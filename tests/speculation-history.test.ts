import { describe, it, expect } from 'vitest';
import {
  tradeSignature,
  recentlyPostedTrade,
  franchiseInRecentRotation,
  pruneLedger,
  appendEntry,
  postsToday,
  lastPostAt,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/speculation-history.mjs';

const DAY = 24 * 60 * 60 * 1000;

describe('tradeSignature — canonical key', () => {
  it('is order-independent on franchise pair', () => {
    const a = tradeSignature({
      seller: '0001', buyer: '0002', marqueeId: 'p1', returnPkgIds: ['p2', 'p3'],
    });
    const b = tradeSignature({
      seller: '0002', buyer: '0001', marqueeId: 'p1', returnPkgIds: ['p2', 'p3'],
    });
    expect(a).toBe(b);
  });

  it('changes when the package contents change', () => {
    const a = tradeSignature({
      seller: '0001', buyer: '0002', marqueeId: 'p1', returnPkgIds: ['p2', 'p3'],
    });
    const b = tradeSignature({
      seller: '0001', buyer: '0002', marqueeId: 'p1', returnPkgIds: ['p2', 'p4'],
    });
    expect(a).not.toBe(b);
  });
});

describe('recentlyPostedTrade — 30-day rotation gate', () => {
  const sig = tradeSignature({
    seller: '0001', buyer: '0002', marqueeId: 'pX', returnPkgIds: ['pA', 'pB'],
  });

  it('flags as recently posted within the 30-day window', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const ledger = {
      version: 1,
      entries: [
        { signature: sig, postedAt: now.getTime() - 10 * DAY, franchiseIds: ['0001', '0002'] },
      ],
    };
    expect(recentlyPostedTrade(ledger, sig, now)).toBe(true);
  });

  it('clears once the entry is older than 30 days', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const ledger = {
      version: 1,
      entries: [
        { signature: sig, postedAt: now.getTime() - 31 * DAY, franchiseIds: ['0001', '0002'] },
      ],
    };
    expect(recentlyPostedTrade(ledger, sig, now)).toBe(false);
  });
});

describe('franchiseInRecentRotation — 7-day per-franchise cooldown', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const ledger = {
    version: 1,
    entries: [
      { signature: 'sig1', postedAt: now.getTime() - 3 * DAY, franchiseIds: ['0001', '0005'] },
      { signature: 'sig2', postedAt: now.getTime() - 9 * DAY, franchiseIds: ['0002', '0001'] },
    ],
  };

  it('flags franchises featured in the last 7 days', () => {
    expect(franchiseInRecentRotation(ledger, '0001', now)).toBe(true);
    expect(franchiseInRecentRotation(ledger, '0005', now)).toBe(true);
  });

  it('clears once the entry is older than 7 days', () => {
    // 0002 was only in the 9-day-old entry → has cooled off
    expect(franchiseInRecentRotation(ledger, '0002', now)).toBe(false);
  });

  it('returns false for a never-featured franchise', () => {
    expect(franchiseInRecentRotation(ledger, '0099', now)).toBe(false);
  });
});

describe('pruneLedger — drops ancient entries', () => {
  it('keeps recent and drops older than 35 days', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const ledger = {
      version: 1,
      entries: [
        { signature: 'fresh', postedAt: now.getTime() - 1 * DAY, franchiseIds: ['0001'] },
        { signature: 'old', postedAt: now.getTime() - 40 * DAY, franchiseIds: ['0001'] },
      ],
    };
    const pruned = pruneLedger(ledger, now);
    expect(pruned.entries).toHaveLength(1);
    expect(pruned.entries[0].signature).toBe('fresh');
  });
});

describe('appendEntry / postsToday / lastPostAt', () => {
  it('appendEntry produces a new immutable ledger', () => {
    const original = { version: 1, entries: [] };
    const next = appendEntry(original, { signature: 's1', postedAt: 100, franchiseIds: ['0001'] });
    expect(original.entries).toHaveLength(0);
    expect(next.entries).toHaveLength(1);
  });

  it('postsToday counts entries posted in the current PT calendar day', () => {
    const ptNoon = new Date('2026-06-15T19:00:00Z'); // 12pm PT
    const ledger = {
      version: 1,
      entries: [
        { signature: 'a', postedAt: new Date('2026-06-15T16:00:00Z').getTime(), franchiseIds: [] },
        { signature: 'b', postedAt: new Date('2026-06-14T19:00:00Z').getTime(), franchiseIds: [] },
      ],
    };
    expect(postsToday(ledger, ptNoon)).toBe(1);
  });

  it('lastPostAt returns the newest entry timestamp as a Date', () => {
    const ledger = {
      version: 1,
      entries: [
        { signature: 'a', postedAt: 100, franchiseIds: [] },
        { signature: 'b', postedAt: 500, franchiseIds: [] },
        { signature: 'c', postedAt: 300, franchiseIds: [] },
      ],
    };
    expect(lastPostAt(ledger)?.getTime()).toBe(500);
  });

  it('lastPostAt returns null on empty ledger', () => {
    expect(lastPostAt({ version: 1, entries: [] })).toBeNull();
  });
});
