/**
 * Feature 10 — cross-week memory recall (HARD RULE 25).
 *
 * Tests:
 *   - the ledger v1 → v2 migration (existing files load without losing data)
 *   - markFingerprintSeen now accepts + merges tipster hashes
 *   - getMemoryRecall returns the right payload when a "different voice"
 *     returns to an old bucket and null otherwise
 *   - the privacy contract: only counts cross the wire, never identities
 *   - the scanner annotation path is wired (regex check on source)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — .mjs imported via allowJs
import {
  LEDGER_VERSION,
  emptyLedger,
  markFingerprintSeen,
  getMemoryRecall,
  loadLedger,
  saveLedger,
} from '../scripts/lib/schefter-recurrence-ledger.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';

describe('recurrence ledger v2 — tipsterHashes roster', () => {
  it('LEDGER_VERSION is 2 (post-feature-10 schema)', () => {
    expect(LEDGER_VERSION).toBe(2);
  });

  it('emptyLedger initialises with the current version', () => {
    const l = emptyLedger(2026);
    expect(l.version).toBe(2);
    expect(l.fingerprints).toEqual({});
  });

  it('markFingerprintSeen records weeksSeen AND merges tipsterHashes', () => {
    const l = emptyLedger(2026);
    markFingerprintSeen(l, 'topic:trade:0001', '2026-W20', '2026-05-20T00:00:00Z', ['hash-a', 'hash-b']);
    const entry = l.fingerprints['topic:trade:0001'];
    expect(entry.weeksSeen).toEqual(['2026-W20']);
    expect(entry.tipsterHashes).toEqual(['hash-a', 'hash-b']);
  });

  it('merges new tipster hashes without duplicating, keeps sorted-unique', () => {
    const l = emptyLedger(2026);
    markFingerprintSeen(l, 'fp', '2026-W18', '2026-05-06T00:00:00Z', ['hash-b', 'hash-a']);
    markFingerprintSeen(l, 'fp', '2026-W20', '2026-05-20T00:00:00Z', ['hash-a', 'hash-c']);
    expect(l.fingerprints.fp.tipsterHashes).toEqual(['hash-a', 'hash-b', 'hash-c']);
  });

  it('ignores empty / non-string hashes', () => {
    const l = emptyLedger(2026);
    markFingerprintSeen(l, 'fp', '2026-W20', null, ['', 'hash-a', undefined as unknown as string, null as unknown as string]);
    expect(l.fingerprints.fp.tipsterHashes).toEqual(['hash-a']);
  });

  it('caps the per-fingerprint hash list so a runaway bucket cannot grow without bound', () => {
    const l = emptyLedger(2026);
    const many: string[] = [];
    for (let i = 0; i < 100; i++) many.push(`h${i.toString().padStart(3, '0')}`);
    markFingerprintSeen(l, 'fp', '2026-W20', null, many);
    expect(l.fingerprints.fp.tipsterHashes.length).toBeLessThanOrEqual(64);
  });
});

describe('getMemoryRecall', () => {
  const buildLedger = (weeksSeen: string[], tipsterHashes: string[]) => {
    const l = emptyLedger(2026);
    l.fingerprints['topic:trade:0001'] = {
      weeksSeen,
      tipsterHashes,
      lastUpdated: '2026-05-19T00:00:00Z',
    };
    return l;
  };

  it('returns null when the fingerprint has never been seen', () => {
    const l = emptyLedger(2026);
    expect(getMemoryRecall(l, 'topic:trade:0001', ['hash-a'], '2026-W20')).toBeNull();
  });

  it('returns null when the fingerprint has only one week recorded (no recall yet)', () => {
    const l = buildLedger(['2026-W19'], ['hash-a']);
    expect(getMemoryRecall(l, 'topic:trade:0001', ['hash-b'], '2026-W20')).toBeNull();
  });

  it('returns null when all current tipsters were already on the roster (same voice, not "circled back")', () => {
    const l = buildLedger(['2026-W18', '2026-W19'], ['hash-a', 'hash-b']);
    expect(getMemoryRecall(l, 'topic:trade:0001', ['hash-a'], '2026-W20')).toBeNull();
  });

  it('returns a payload when ≥2 prior weeks exist AND a fresh voice is on the line', () => {
    const l = buildLedger(['2026-W17', '2026-W19'], ['hash-a']);
    const r = getMemoryRecall(l, 'topic:trade:0001', ['hash-b'], '2026-W20');
    expect(r).not.toBeNull();
    expect(r.totalWeeksSeen).toBe(2);
    expect(r.weeksSinceFirstSeen).toBe(3);  // W17 → W20 = 3 weeks
    expect(r.distinctVoicesAcrossTime).toBe(2);  // hash-a (prior) + hash-b (current)
  });

  it('does not leak the raw hashes back to the caller', () => {
    const l = buildLedger(['2026-W17', '2026-W19'], ['hash-a']);
    const r = getMemoryRecall(l, 'topic:trade:0001', ['hash-b'], '2026-W20');
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('hash-a');
    expect(serialized).not.toContain('hash-b');
  });

  it('handles the no-fingerprint and null-fingerprint cases without throwing', () => {
    const l = emptyLedger(2026);
    expect(getMemoryRecall(l, null, ['hash-a'], '2026-W20')).toBeNull();
    expect(getMemoryRecall(l, '', ['hash-a'], '2026-W20')).toBeNull();
  });
});

describe('loadLedger v1 → v2 migration', () => {
  it('reads a v1 file and upgrades it in-place, backfilling tipsterHashes arrays', () => {
    const dir = path.join(os.tmpdir(), `schefter-ledger-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'topic-recurrence.json');
    writeFileSync(file, JSON.stringify({
      version: 1,
      season: 2026,
      fingerprints: {
        'topic:trade:0001': { weeksSeen: ['2026-W18', '2026-W19'], lastUpdated: '2026-05-13T00:00:00Z' },
      },
    }));
    try {
      const loaded = loadLedger(file);
      expect(loaded.version).toBe(2);
      expect(loaded.fingerprints['topic:trade:0001'].tipsterHashes).toEqual([]);
      expect(loaded.fingerprints['topic:trade:0001'].weeksSeen).toEqual(['2026-W18', '2026-W19']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('discards a ledger with an unknown future version (safer to start fresh)', () => {
    const dir = path.join(os.tmpdir(), `schefter-ledger-test-fresh-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'topic-recurrence.json');
    writeFileSync(file, JSON.stringify({ version: 99, season: 2026, fingerprints: {} }));
    try {
      const loaded = loadLedger(file);
      // Fresh ledger — version aligns with current schema, no v99 leftovers.
      expect(loaded.version).toBe(2);
      expect(loaded.fingerprints).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips a v2 ledger through saveLedger → loadLedger', () => {
    const dir = path.join(os.tmpdir(), `schefter-ledger-test-rt-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'topic-recurrence.json');
    try {
      const original = emptyLedger(2026);
      markFingerprintSeen(original, 'fp', '2026-W20', '2026-05-20T00:00:00Z', ['hash-a', 'hash-b']);
      saveLedger(original, file);
      const loaded = loadLedger(file);
      expect(loaded.fingerprints.fp.tipsterHashes).toEqual(['hash-a', 'hash-b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rumor-scan source — memory recall wiring', () => {
  const SRC = readFileSync(
    path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
    'utf8',
  );

  it('imports getMemoryRecall from the ledger module', () => {
    expect(SRC).toMatch(/getMemoryRecall,/);
  });

  it('annotates anonymized tips with memoryRecall before generation', () => {
    expect(SRC).toMatch(/annotateMemoryRecall\(anonymized,\s*batch\)/);
    expect(SRC).toMatch(/a\.memoryRecall\s*=\s*r/);
  });

  it('passes current-cycle tipster hashes into markFingerprintSeen at post-commit', () => {
    expect(SRC).toMatch(/markFingerprintSeen\(\s*recurrenceLedger,\s*fp,\s*currentIsoWeek,\s*now\.toISOString\(\),\s*tipsterHashes\s*\)/);
  });

  it('HARD RULE 25 references the memoryRecall payload shape', () => {
    expect(SRC).toMatch(/25\.\s+CROSS-WEEK MEMORY RECALL/);
    expect(SRC).toMatch(/memoryRecall:\s*\{\s*weeksSinceFirstSeen/);
    expect(SRC).toMatch(/distinctVoicesAcrossTime/);
  });

  it('HARD RULE 25 keeps the privacy invariant — never name a codename or franchise', () => {
    // The phrasing "never name a codename, never name a franchise" lives
    // inside the rule's hard constraints block. Locking with substring
    // checks so a future edit that loosens the privacy stance fails CI.
    expect(SRC).toMatch(/CROSS-WEEK MEMORY RECALL[\s\S]+?never name a codename[\s\S]+?never name a franchise/);
  });
});
