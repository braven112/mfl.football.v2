import { describe, it, expect } from 'vitest';
import { canonicalizeForFixture, normalizeExtra } from '../scripts/record-mfl-fixture.mjs';

/**
 * The fixture recorder's canonical form. Pinned because a fixture is only
 * deterministic if two recordings of the same league produce the same bytes:
 * MFL returns arrays in arbitrary order (docs/claude/rules/storage-and-build.md),
 * so the sort must be stable across runs AND must not depend on which key a
 * particular export happens to expose.
 */
describe('canonicalizeForFixture', () => {
  it('sorts object keys and sorts object arrays by the first stable key present, numerically', () => {
    const out = canonicalizeForFixture({
      z: 1,
      rows: [{ id: '10', n: 'b' }, { id: '9', n: 'a' }, { id: '100', n: 'c' }],
    });
    expect(Object.keys(out)).toEqual(['rows', 'z']);
    expect(out.rows.map((r: { id: string }) => r.id)).toEqual(['9', '10', '100']);
  });

  it('falls through the key list (id → player → franchise → week → name) and to whole-object JSON when none is shared', () => {
    const byPlayer = canonicalizeForFixture([{ player: '2' }, { player: '1' }]);
    expect(byPlayer.map((r: { player: string }) => r.player)).toEqual(['1', '2']);
    const mixed = canonicalizeForFixture([{ b: 1 }, { a: 1 }]);
    expect(mixed).toEqual([{ a: 1 }, { b: 1 }]);
  });

  it('sorts scalar arrays and is idempotent', () => {
    const once = canonicalizeForFixture({ list: ['b', 'a', 'c'], nested: [{ id: '2', tags: ['y', 'x'] }, { id: '1' }] });
    expect(once.list).toEqual(['a', 'b', 'c']);
    expect(once.nested[0]).toEqual({ id: '1' });
    expect(canonicalizeForFixture(once)).toEqual(once);
  });

  it('breaks ties and ignores non-scalar or empty keys, so order is a function of content alone', () => {
    // schedule.weeklySchedule[].matchup[]: `franchise` is an ARRAY on every element
    const matchups = [
      { franchise: [{ id: '0002' }, { id: '0001' }] },
      { franchise: [{ id: '0004' }, { id: '0003' }] },
    ];
    const a = canonicalizeForFixture([matchups[0], matchups[1]]);
    const b = canonicalizeForFixture([matchups[1], matchups[0]]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // draftResults: `player` is '' on unmade picks — ties must still order deterministically
    const picks = [{ player: '', round: '2' }, { player: '', round: '1' }, { player: '9', round: '1' }];
    const p1 = canonicalizeForFixture(picks);
    const p2 = canonicalizeForFixture([...picks].reverse());
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
    // transactions keyed by franchise: ties on the key fall through to the whole element
    const t1 = canonicalizeForFixture([{ franchise: '0001', type: 'B' }, { franchise: '0001', type: 'A' }]);
    expect(t1.map((t: { type: string }) => t.type)).toEqual(['A', 'B']);
  });

  it('is order-blind: two permutations of the same payload canonicalize identically', () => {
    const a = canonicalizeForFixture({ franchise: [{ id: '0001', players: ['x', 'y'] }, { id: '0002' }] });
    const b = canonicalizeForFixture({ franchise: [{ id: '0002' }, { players: ['y', 'x'], id: '0001' }] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('normalizeExtra', () => {
  it('always yields a leading & (or nothing), whatever the caller typed', () => {
    expect(normalizeExtra('FRANCHISE=0001')).toBe('&FRANCHISE=0001');
    expect(normalizeExtra('&FRANCHISE=0001')).toBe('&FRANCHISE=0001');
    expect(normalizeExtra('?W=3')).toBe('&W=3');
    expect(normalizeExtra('')).toBe('');
    expect(normalizeExtra(undefined)).toBe('');
  });
});
