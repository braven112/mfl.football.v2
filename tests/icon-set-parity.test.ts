import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { SPRITE_REL_PATH } from './helpers/sprite-icons';

/**
 * Icon-set parity (docs/plans/icon-sets.md).
 *
 * Every icon set is a drop-in replacement for the classic sprite: pages ask
 * for `#icon-<name>` and never know which set is loaded. So every set under
 * public/assets/icons/sets/<name>/sprite.svg must define EXACTLY the classic
 * sprite's glyph ids. A set missing one renders a blank icon with no error,
 * and a set with an extra one invites a page to use a glyph the other sets
 * cannot draw. Adding a glyph to the classic sprite therefore fails this test
 * until every set has its own drawing of it.
 */

const ROOT = resolve(__dirname, '..');
const SETS_DIR = resolve(ROOT, 'public/assets/icons/sets');

function glyphIds(svg: string): Set<string> {
  return new Set([...svg.matchAll(/<symbol[^>]*\bid="icon-([^"]+)"/g)].map((m) => m[1]));
}

const classic = glyphIds(readFileSync(resolve(ROOT, SPRITE_REL_PATH), 'utf8'));
const sets = existsSync(SETS_DIR)
  ? readdirSync(SETS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

describe('icon sets', () => {
  it('the classic sprite parsed (sanity check)', () => {
    expect(classic.size).toBeGreaterThan(0);
  });

  it('at least one alternate set exists', () => {
    expect(sets.length).toBeGreaterThan(0);
  });

  for (const name of sets) {
    describe(`set "${name}"`, () => {
      const path = resolve(SETS_DIR, name, 'sprite.svg');

      it('has a sprite.svg', () => {
        expect(existsSync(path), `missing public/assets/icons/sets/${name}/sprite.svg`).toBe(true);
      });

      it('defines exactly the classic sprite\'s glyph ids', () => {
        const ids = glyphIds(readFileSync(path, 'utf8'));
        const missing = [...classic].filter((id) => !ids.has(id)).sort();
        const extra = [...ids].filter((id) => !classic.has(id)).sort();
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      });

      it('gives every glyph its own viewBox', () => {
        const svg = readFileSync(path, 'utf8');
        const noViewBox = [...svg.matchAll(/<symbol\b[^>]*>/g)]
          .map((m) => m[0])
          .filter((tag) => !/\bviewBox="/.test(tag));
        expect(noViewBox).toEqual([]);
      });
    });
  }

  /**
   * A sprite is fetched as an XML document, and an XML parser STOPS at the
   * first well-formedness error — so every symbol after it renders blank,
   * while the ones before it keep working and hide the fault. The line set
   * shipped without `xmlns:xlink` on its root while the Premier League mark
   * uses `xlink:href`, which silently blanked every brand mark after it
   * (lion, Archie, Schefter). A full parse is not available here, so this
   * checks the error that actually happened: every namespace prefix used must
   * be declared on the root.
   */
  const allSprites = [
    ['classic', resolve(ROOT, SPRITE_REL_PATH)],
    ...sets.map((name) => [name, resolve(SETS_DIR, name, 'sprite.svg')]),
  ];
  for (const [name, path] of allSprites) {
    it(`"${name}" declares every namespace prefix it uses`, () => {
      const svg = readFileSync(path, 'utf8');
      const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
      const used = new Set(
        [...svg.matchAll(/\s([A-Za-z][\w-]*):[\w-]+=/g)].map((m) => m[1]).filter((p) => p !== 'xmlns' && p !== 'xml'),
      );
      const undeclared = [...used].filter((p) => !new RegExp(`\\sxmlns:${p}=`).test(root)).sort();
      expect(undeclared, `declare these on the sprite's root <svg>`).toEqual([]);
    });
  }
});
