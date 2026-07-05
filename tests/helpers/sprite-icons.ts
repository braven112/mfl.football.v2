import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Shared sprite-glyph loader for data-validation tests.
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
 */
export function loadSpriteIconIds(): Set<string> {
  const svg = readFileSync(SPRITE_ABS_PATH, 'utf8');
  return new Set([...svg.matchAll(/\bid="icon-([^"]+)"/g)].map((m) => m[1]));
}
