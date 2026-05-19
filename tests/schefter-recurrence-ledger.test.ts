/**
 * Schefter recurrence ledger — stale-tip detection.
 *
 * A gossip bucket goes stale when it's been posted about in the two
 * preceding ISO weeks. Posting it again would be the 3rd consecutive week,
 * which is "old news" and gets relegated to the Friday mailbag.
 *
 * These tests pin the ISO-week math, the 3-week stale threshold, the
 * quiet-week reset behavior, the Labor Day season rollover, and the
 * bucket-fingerprint carve-outs (trade-offer + whisper-back threads are
 * exempt from recurrence tracking).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isoWeekLabel,
  isoWeekMinus,
  emptyLedger,
  markFingerprintSeen,
  isFingerprintStale,
  getStreakLength,
  rolloverForSeason,
  currentSeasonYear,
  LEDGER_VERSION,
} from '../scripts/lib/schefter-recurrence-ledger.mjs';
import {
  bucketFingerprint,
  isBucketStale,
  bucketStreakLength,
  buildTopicBuckets,
} from '../scripts/lib/schefter-bucket-logic.mjs';

describe('isoWeekLabel', () => {
  it('formats as YYYY-Www', () => {
    expect(isoWeekLabel(new Date('2026-05-13T00:00:00Z'))).toBe('2026-W20');
  });

  it('handles year boundary — Jan 1 2024 is W01 of 2024', () => {
    expect(isoWeekLabel(new Date('2024-01-01T12:00:00Z'))).toBe('2024-W01');
  });

  it('handles year boundary — Jan 1 2023 is W52 of 2022 (Sunday)', () => {
    expect(isoWeekLabel(new Date('2023-01-01T12:00:00Z'))).toBe('2022-W52');
  });

  it('handles year boundary — Dec 31 2024 is W01 of 2025 (Tuesday)', () => {
    expect(isoWeekLabel(new Date('2024-12-31T12:00:00Z'))).toBe('2025-W01');
  });
});

describe('isoWeekMinus', () => {
  it('walks back within a year', () => {
    expect(isoWeekMinus('2026-W20', 1)).toBe('2026-W19');
    expect(isoWeekMinus('2026-W20', 2)).toBe('2026-W18');
  });

  it('walks back across a year boundary', () => {
    expect(isoWeekMinus('2026-W01', 1)).toBe('2025-W52');
  });
});

describe('isFingerprintStale', () => {
  it('returns false for an unseen fingerprint', () => {
    const ledger = emptyLedger(2026);
    expect(isFingerprintStale(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(false);
  });

  it('returns false after one week of being seen', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    expect(isFingerprintStale(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(false);
  });

  it('returns true when the two prior consecutive weeks are present', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W18');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    expect(isFingerprintStale(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(true);
  });

  it('returns false when there is a gap in the prior weeks (one quiet week)', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W17');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    // W18 was quiet → not two prior consecutive
    expect(isFingerprintStale(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(false);
  });

  it('keeps returning true once a 3+ week streak is established and continues', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W17');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W18');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    expect(isFingerprintStale(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(true);
  });

  it('resets to non-stale after a quiet week breaks the streak', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W17');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W18');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    // W20 was quiet (no fresh tips, no entry). W21 has a fresh tip:
    // prevWeek1 = W20 (absent) → not stale.
    expect(isFingerprintStale(ledger, 'topic:trade:Geeks', '2026-W21')).toBe(false);
  });

  it('handles cross-year staleness', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2025-W52');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W01');
    expect(isFingerprintStale(ledger, 'topic:trade:Geeks', '2026-W02')).toBe(true);
  });
});

describe('markFingerprintSeen', () => {
  it('is idempotent within a week', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W20');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W20');
    expect(ledger.fingerprints['topic:trade:Geeks'].weeksSeen).toEqual(['2026-W20']);
  });

  it('keeps weeksSeen sorted and capped at 12 entries', () => {
    const ledger = emptyLedger(2026);
    for (let w = 1; w <= 15; w++) {
      markFingerprintSeen(ledger, 'topic:trade:Geeks', `2026-W${String(w).padStart(2, '0')}`);
    }
    const weeks = ledger.fingerprints['topic:trade:Geeks'].weeksSeen;
    expect(weeks.length).toBe(12);
    expect(weeks[0]).toBe('2026-W04');
    expect(weeks[weeks.length - 1]).toBe('2026-W15');
  });
});

describe('rolloverForSeason', () => {
  it('clears the ledger when the season changes', () => {
    const ledger = emptyLedger(2025);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2025-W40');
    const [next, reset] = rolloverForSeason(ledger, 2026);
    expect(reset).toBe(true);
    expect(next.season).toBe(2026);
    expect(next.fingerprints).toEqual({});
  });

  it('keeps the ledger intact when the season matches', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W10');
    const [next, reset] = rolloverForSeason(ledger, 2026);
    expect(reset).toBe(false);
    expect(next.fingerprints['topic:trade:Geeks'].weeksSeen).toEqual(['2026-W10']);
  });

  it('initializes from null', () => {
    const [next, reset] = rolloverForSeason(null, 2026);
    expect(reset).toBe(true);
    expect(next).toEqual({ version: LEDGER_VERSION, season: 2026, fingerprints: {} });
  });
});

describe('currentSeasonYear (Labor Day boundary)', () => {
  it('returns prior calendar year before Labor Day', () => {
    // 2026 Labor Day = Sep 7. Aug 1 2026 → 2025 season still.
    expect(currentSeasonYear(new Date('2026-08-01T12:00:00Z'))).toBe(2025);
  });

  it('returns current calendar year on or after Labor Day', () => {
    expect(currentSeasonYear(new Date('2026-09-07T12:00:00Z'))).toBe(2026);
    expect(currentSeasonYear(new Date('2026-12-15T12:00:00Z'))).toBe(2026);
  });
});

describe('bucketFingerprint exemptions', () => {
  it('returns the bucket key for web/groupme gossip buckets', () => {
    expect(bucketFingerprint({ key: 'topic:trade:Geeks', kind: 'gossip' })).toBe('topic:trade:Geeks');
  });

  it('returns null for the trade-offer bucket (own dedup path)', () => {
    expect(bucketFingerprint({ key: 'trade:offer', kind: 'trade' })).toBeNull();
  });

  it('returns null for whisper-back thread buckets', () => {
    expect(bucketFingerprint({ key: 'thread:sf_rumor_123', kind: 'gossip' })).toBeNull();
  });
});

describe('getStreakLength', () => {
  it('returns 1 for a never-seen fingerprint (this would be the first appearance)', () => {
    const ledger = emptyLedger(2026);
    expect(getStreakLength(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(1);
  });

  it('returns 2 after one prior week (W-1)', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    expect(getStreakLength(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(2);
  });

  it('returns 3 — the stale threshold — when both prior consecutive weeks are present', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W18');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    expect(getStreakLength(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(3);
  });

  it('grows past 3 when the streak continues', () => {
    const ledger = emptyLedger(2026);
    for (let w = 14; w <= 19; w++) {
      markFingerprintSeen(ledger, 'topic:trade:Geeks', `2026-W${String(w).padStart(2, '0')}`);
    }
    expect(getStreakLength(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(7);
  });

  it('stops at the first gap (does not count weeks before a quiet week)', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W15');
    // W16, W17 quiet
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W18');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    expect(getStreakLength(ledger, 'topic:trade:Geeks', '2026-W20')).toBe(3);
  });

  it('returns 1 after a quiet week breaks the streak (fresh start)', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W17');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W18');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    // W20 was quiet. W21 fresh appearance → streak=1 (W20 absent).
    expect(getStreakLength(ledger, 'topic:trade:Geeks', '2026-W21')).toBe(1);
  });
});

describe('bucketStreakLength', () => {
  it('returns 3 for a gossip bucket on its third consecutive week', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W18');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    const [bucket] = buildTopicBuckets([
      { id: 't1', topic: 'trade', franchiseHint: 'Geeks', text: 'x', submittedAt: Date.now(), source: 'web' },
    ]);
    expect(bucketStreakLength(bucket, ledger, '2026-W20')).toBe(3);
  });

  it('returns 1 for exempt buckets (trade-offer, whisper-back)', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'trade:offer', '2026-W18');
    markFingerprintSeen(ledger, 'trade:offer', '2026-W19');
    const [tradeBucket] = buildTopicBuckets([
      { id: 'o1', source: 'trade_offer', text: 'x', submittedAt: Date.now() },
    ]);
    expect(bucketStreakLength(tradeBucket, ledger, '2026-W20')).toBe(1);

    const [threadBucket] = buildTopicBuckets([
      { id: 'w1', topic: 'trade', text: 'x', submittedAt: Date.now(), source: 'web', repliesToPostId: 'sf_rumor_abc' },
    ]);
    expect(bucketStreakLength(threadBucket, ledger, '2026-W20')).toBe(1);
  });
});

describe('scanner + admin integration (source guards)', () => {
  const repoRoot = process.cwd();
  const SCANNER_SRC = readFileSync(path.join(repoRoot, 'scripts/schefter-rumor-scan.mjs'), 'utf8');
  const ADMIN_SRC = readFileSync(path.join(repoRoot, 'src/pages/api/admin/schefter-stats.ts'), 'utf8');

  it('scanner imports the recurrence ledger helpers', () => {
    expect(SCANNER_SRC).toMatch(/from '\.\/lib\/schefter-recurrence-ledger\.mjs'/);
    expect(SCANNER_SRC).toMatch(/markFingerprintSeen/);
    expect(SCANNER_SRC).toMatch(/rolloverForSeason/);
  });

  it('scanner skips stale buckets in the normal lane and keeps the mailbag path unfiltered', () => {
    // pickPrimaryBucket must be fed the filtered list — not the raw buckets.
    expect(SCANNER_SRC).toMatch(/pickPrimaryBucket\(normalLaneBuckets/);
    // Mailbag still draws from the gossip pool (fresh tips, not buckets), so
    // stale fingerprints reach the Friday roundup as intended.
    expect(SCANNER_SRC).toMatch(/mailbagBatch = gossipPool\.slice/);
  });

  it('HARD RULE 20 mentions staleStreakWeeks framing', () => {
    expect(SCANNER_SRC).toMatch(/staleStreakWeeks/);
    expect(SCANNER_SRC).toMatch(/RECURRENCE FRAMING/);
  });

  it('scanner annotates each anonymized tip with staleStreakWeeks before the LLM call', () => {
    expect(SCANNER_SRC).toMatch(/a\.staleStreakWeeks = streakById\.get/);
  });

  it('admin schefter-stats surfaces staleStreakWeeks + isStale per ranked bucket', () => {
    expect(ADMIN_SRC).toMatch(/staleStreakWeeks: bucketStreakLength/);
    expect(ADMIN_SRC).toMatch(/isStale: isBucketStale/);
    expect(ADMIN_SRC).toMatch(/from '\.\.\/\.\.\/\.\.\/\.\.\/data\/schefter\/topic-recurrence\.json'/);
  });
});

describe('isBucketStale integration with buildTopicBuckets', () => {
  it('flags a bucket as stale when its key has been posted two prior weeks', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W18');
    markFingerprintSeen(ledger, 'topic:trade:Geeks', '2026-W19');
    const tips = [
      {
        id: 't1',
        topic: 'trade',
        franchiseHint: 'Geeks',
        text: 'Geeks still shopping the WR',
        submittedAt: Date.now(),
        source: 'web',
      },
    ];
    const [bucket] = buildTopicBuckets(tips);
    expect(bucket.key).toBe('topic:trade:Geeks');
    expect(isBucketStale(bucket, ledger, '2026-W20')).toBe(true);
  });

  it('does not flag a trade-offer bucket as stale even if seen N weeks running', () => {
    const ledger = emptyLedger(2026);
    markFingerprintSeen(ledger, 'trade:offer', '2026-W18');
    markFingerprintSeen(ledger, 'trade:offer', '2026-W19');
    const tips = [
      {
        id: 'offer-1',
        source: 'trade_offer',
        text: 'redacted offer',
        submittedAt: Date.now(),
      },
    ];
    const [bucket] = buildTopicBuckets(tips);
    expect(bucket.key).toBe('trade:offer');
    // Even though the ledger has entries, bucketFingerprint returns null for
    // trade:offer — stale check is a no-op.
    expect(isBucketStale(bucket, ledger, '2026-W20')).toBe(false);
  });

  it('does not flag a whisper-back thread bucket as stale', () => {
    const ledger = emptyLedger(2026);
    const tips = [
      {
        id: 'w1',
        topic: 'trade',
        text: 'reply',
        submittedAt: Date.now(),
        source: 'web',
        repliesToPostId: 'sf_rumor_abc',
      },
    ];
    const [bucket] = buildTopicBuckets(tips);
    expect(bucket.key).toBe('thread:sf_rumor_abc');
    expect(isBucketStale(bucket, ledger, '2026-W20')).toBe(false);
  });
});
