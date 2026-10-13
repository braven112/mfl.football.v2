/**
 * The icon sprite URL for a page — the league's icon set, with a content hash.
 *
 * A league picks its icon set in the registry (`iconSet`, read with
 * `leagueIconSet`); every set carries the same glyph ids
 * (tests/icon-set-parity.test.ts), so a page asks for `#icon-<name>` and never
 * knows which set it got. See docs/plans/icon-sets.md.
 *
 * The hash is per file and computed once at module load. It is load-bearing:
 * public/sw.js serves /assets/** stale-while-revalidate, so an edited sprite
 * only shows up because its URL changed.
 *
 * Usage in .astro files — resolve from the request, never hardcode the path
 * (tests/sprite-url-guard.test.ts):
 *   import { spriteUrlFor } from '../utils/sprite-url';
 *   const spriteUrl = spriteUrlFor(Astro.url);
 *   <use href={`${spriteUrl}#icon-foo`} />
 *
 * Client scripts and React islands read the same URL from
 * `<html data-sprite-url>`, which every layout stamps (src/utils/sprite-url-client.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ALL_LEAGUES, buildHostToSlugMap, leagueIconSet, type IconSet } from '../config/leagues';

/** Public path of each set's sprite. `classic` keeps the original location. */
export const ICON_SET_PATHS: Record<IconSet, string> = {
  classic: '/assets/icons/sprite.svg',
  line: '/assets/icons/sets/line/sprite.svg',
};

const hashedUrls = Object.fromEntries(
  (Object.entries(ICON_SET_PATHS) as [IconSet, string][]).map(([set, publicPath]) => {
    const content = fs.readFileSync(path.join(process.cwd(), 'public', publicPath), 'utf-8');
    const hash = createHash('md5').update(content).digest('hex').slice(0, 8);
    return [set, `${publicPath}?v=${hash}`];
  }),
) as Record<IconSet, string>;

/** A set's sprite URL with its cache-busting query, e.g. `/assets/icons/sprite.svg?v=a1b2c3d4`. */
export function spriteUrlForSet(set: IconSet): string {
  return hashedUrls[set] ?? hashedUrls.classic;
}

/** The sprite URL for a league's icon set; classic for an unknown or absent league. */
export function spriteUrlForLeague(slug: string | null | undefined): string {
  return spriteUrlForSet(slug ? leagueIconSet(slug) : 'classic');
}

const HOST_TO_SLUG = buildHostToSlugMap();

/**
 * The league a request belongs to: its path prefix (`/theleague/…` — also what
 * a league apex is rewritten to by middleware), else the league that owns the
 * host. Null for a page that belongs to no league (the shared front door,
 * /live, /instructions), which therefore draws the classic set.
 */
function leagueSlugForUrl(url: URL): string | null {
  for (const league of ALL_LEAGUES) {
    if (url.pathname === `/${league.slug}` || url.pathname.startsWith(`/${league.slug}/`)) return league.slug;
  }
  return HOST_TO_SLUG[url.hostname] ?? null;
}

/** The sprite URL for the page at `url` — pass `Astro.url`. */
export function spriteUrlFor(url: URL): string {
  return spriteUrlForLeague(leagueSlugForUrl(url));
}
