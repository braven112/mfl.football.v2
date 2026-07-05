import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * Shared sprite-glyph validation for data-file tests.
 *
 * Display code renders icons as `<use href="${sprite}#icon-${value}">`,
 * so data files must store the BARE glyph name ("eye", not "icon-eye").
 * A double-prefixed value resolves to #icon-icon-* — which doesn't exist —
 * and silently renders an empty icon.
 */

export const SPRITE_REL_PATH = 'public/assets/icons/sprite.svg';

const SPRITE_ABS_PATH = resolve(__dirname, '../../', SPRITE_REL_PATH);

/**
 * Parse sprite.svg and return the set of glyph names (symbol ids with the
 * "icon-" prefix stripped) that data-file `icon` fields may reference.
 * Scoped to <symbol> elements so a stray icon-* id on a gradient or
 * clip-path inside a glyph can't be false-allowed as referenceable.
 */
export function loadSpriteIconIds(): Set<string> {
  const svg = readFileSync(SPRITE_ABS_PATH, 'utf8');
  return new Set([...svg.matchAll(/<symbol[^>]*\bid="icon-([^"]+)"/g)].map((m) => m[1]));
}

/** One icon reference from a data file, with a `source` label for failure messages. */
export interface SpriteIconRef {
  source: string;
  icon: string | undefined;
}

/**
 * Register the standard three-test sprite validation suite for a data file's
 * icon references: sprite parse sanity, no "icon-" double-prefix, and every
 * value exists as a glyph in the sprite.
 */
export function describeSpriteIconValidation(dataLabel: string, refs: SpriteIconRef[]): void {
  describe(`${dataLabel} sprite icons`, () => {
    const spriteIds = loadSpriteIconIds();

    it(`parsed glyph ids from ${SPRITE_REL_PATH} (sanity check)`, () => {
      expect(spriteIds.size).toBeGreaterThan(0);
    });

    it('no icon value carries the "icon-" prefix (consumers add it)', () => {
      const doublePrefixed = refs
        .filter((r) => r.icon?.startsWith('icon-'))
        .map((r) => `${r.source} -> "${r.icon}"`);
      expect(
        doublePrefixed,
        `Icon values must be bare glyph names ("eye", not "icon-eye"). Display code prepends ` +
          `"icon-", so a prefixed value resolves to a nonexistent #icon-icon-* glyph and ` +
          `renders an empty icon.`,
      ).toEqual([]);
    });

    it(`every icon refers to a real glyph in ${SPRITE_REL_PATH}`, () => {
      const unknown = refs
        .filter((r) => r.icon && !spriteIds.has(r.icon))
        .map((r) => `${r.source} -> "${r.icon}"`);
      expect(
        unknown,
        `Icons not found in the sprite. Use an existing glyph id (without the "icon-" ` +
          `prefix) or add the glyph to ${SPRITE_REL_PATH}.`,
      ).toEqual([]);
    });
  });
}
