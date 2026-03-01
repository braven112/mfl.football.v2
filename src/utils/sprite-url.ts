/**
 * Sprite URL with content-based cache buster.
 *
 * Computes a short hash from the sprite file so browsers always fetch
 * the latest version after an icon is added or modified.
 *
 * Usage in .astro files:
 *   import { spriteUrl } from '../utils/sprite-url';
 *   <use href={`${spriteUrl}#icon-foo`} />
 *
 * Usage in client-side JS (set via define:vars or data attribute):
 *   The layout writes a global `window.__spriteUrl` for React/client components.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const spritePath = path.join(process.cwd(), 'public/assets/icons/sprite.svg');
const spriteContent = fs.readFileSync(spritePath, 'utf-8');
const hash = createHash('md5').update(spriteContent).digest('hex').slice(0, 8);

/** Sprite URL with cache-busting query string, e.g. `/assets/icons/sprite.svg?v=a1b2c3d4` */
export const spriteUrl = `/assets/icons/sprite.svg?v=${hash}`;
