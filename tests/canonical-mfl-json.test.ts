/**
 * canonical-json.mjs — the skip-if-unchanged layer under every MFL feed write.
 *
 * MFL returns arrays in nondeterministic order, so the 5-minute roster-sync
 * cron used to rewrite (and commit) semantically identical files ~18×/day per
 * league. These tests pin the behavior that stops that: order-blind
 * comparison, volatile-key exclusion, and the write actually being skipped
 * (file bytes untouched), not just logged differently.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalCompareString,
  jsonEquivalent,
  writeJsonIfChanged,
} from '../scripts/lib/canonical-json.mjs';

const playersFeed = (order: 'ab' | 'ba') => {
  const a = { id: '1234', name: 'Ward, Cam', position: 'QB', team: 'TEN' };
  const b = { id: '5678', name: 'Hall, Breece', position: 'RB', team: 'NYJ' };
  return {
    version: '1.0',
    players: { timestamp: '1755300000', player: order === 'ab' ? [a, b] : [b, a] },
  };
};

describe('jsonEquivalent', () => {
  it('treats MFL array reordering as unchanged', () => {
    expect(jsonEquivalent(playersFeed('ab'), playersFeed('ba'))).toBe(true);
  });

  it('treats object key reordering as unchanged', () => {
    const a = { rosters: { franchise: [{ id: '0001', week: '1' }] } };
    const b = { rosters: { franchise: [{ week: '1', id: '0001' }] } };
    expect(jsonEquivalent(a, b)).toBe(true);
  });

  it('detects a real field change', () => {
    const changed = playersFeed('ab');
    (changed.players.player[0] as { team: string }).team = 'FA';
    expect(jsonEquivalent(playersFeed('ab'), changed)).toBe(false);
  });

  it('detects added and removed array elements', () => {
    const shorter = playersFeed('ab');
    shorter.players.player = shorter.players.player.slice(0, 1);
    expect(jsonEquivalent(playersFeed('ab'), shorter)).toBe(false);
    // A duplicate of an existing element is also a change (multiset semantics).
    const duped = playersFeed('ab');
    duped.players.player = [...duped.players.player, duped.players.player[0]];
    expect(jsonEquivalent(playersFeed('ab'), duped)).toBe(false);
  });

  it('ignores volatile keys at any depth when asked', () => {
    const a = { lastFetched: '2026-08-16T00:00:00Z', brackets: { '1': { x: 1 } } };
    const b = { lastFetched: '2026-08-16T00:05:00Z', brackets: { '1': { x: 1 } } };
    expect(jsonEquivalent(a, b, { ignoreKeys: ['lastFetched'] })).toBe(true);
    expect(jsonEquivalent(a, b)).toBe(false);
  });

  it('distinguishes scalar types and null', () => {
    expect(jsonEquivalent({ a: '1' }, { a: 1 })).toBe(false);
    expect(jsonEquivalent({ a: null }, { a: 0 })).toBe(false);
    expect(jsonEquivalent({ a: null }, { a: null })).toBe(true);
  });

  it('produces a deterministic comparison string', () => {
    expect(canonicalCompareString(playersFeed('ab'))).toBe(
      canonicalCompareString(playersFeed('ba'))
    );
  });
});

describe('writeJsonIfChanged', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-json-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a new file and reports it', () => {
    const file = path.join(dir, 'players.json');
    expect(writeJsonIfChanged(file, playersFeed('ab'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).players.player).toHaveLength(2);
  });

  it('leaves the file byte-untouched on a shuffled-equal payload', () => {
    const file = path.join(dir, 'players.json');
    writeJsonIfChanged(file, playersFeed('ab'));
    const before = fs.readFileSync(file, 'utf8');
    const beforeMtime = fs.statSync(file).mtimeMs;

    expect(writeJsonIfChanged(file, playersFeed('ba'))).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.statSync(file).mtimeMs).toBe(beforeMtime);
  });

  it('skips when only an ignored volatile key changed, preserving the old value', () => {
    const file = path.join(dir, 'playoff-brackets.json');
    writeJsonIfChanged(file, { lastFetched: 'T1', brackets: { '1': {} } });
    expect(
      writeJsonIfChanged(file, { lastFetched: 'T2', brackets: { '1': {} } }, { ignoreKeys: ['lastFetched'] })
    ).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).lastFetched).toBe('T1');
  });

  it('rewrites on a real change and takes the fresh volatile value with it', () => {
    const file = path.join(dir, 'playoff-brackets.json');
    writeJsonIfChanged(file, { lastFetched: 'T1', brackets: { '1': { w: '15' } } });
    expect(
      writeJsonIfChanged(file, { lastFetched: 'T2', brackets: { '1': { w: '16' } } }, { ignoreKeys: ['lastFetched'] })
    ).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).lastFetched).toBe('T2');
  });

  it('byte-compares pre-serialized string payloads', () => {
    const file = path.join(dir, 'raw.json');
    writeJsonIfChanged(file, '{"a":1}');
    expect(writeJsonIfChanged(file, '{"a":1}')).toBe(false);
    expect(writeJsonIfChanged(file, '{"a":2}')).toBe(true);
  });

  it('overwrites an existing non-JSON file', () => {
    const file = path.join(dir, 'corrupt.json');
    fs.writeFileSync(file, 'not json{');
    expect(writeJsonIfChanged(file, { ok: true })).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).ok).toBe(true);
  });
});
