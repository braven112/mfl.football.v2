import { describe, it, expect } from 'vitest';
import { canonicalizeForFixture } from '../scripts/record-mfl-fixture.mjs';

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

  it('is order-blind: two permutations of the same payload canonicalize identically', () => {
    const a = canonicalizeForFixture({ franchise: [{ id: '0001', players: ['x', 'y'] }, { id: '0002' }] });
    const b = canonicalizeForFixture({ franchise: [{ id: '0002' }, { players: ['y', 'x'], id: '0001' }] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
