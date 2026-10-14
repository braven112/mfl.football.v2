/**
 * The one icon each page wears, wherever it is linked from.
 *
 * `src/config/page-icons.json` maps every league-local page path to a sprite
 * glyph id (no `icon-` prefix), plus a handful of per-league overrides chosen
 * on purpose (the AFL's 16 jersey, the 03/07 live-scoring boards). The menu,
 * site search, related-pages cards, the draft and Front Office sub-navs and
 * the homepage tiles all read it here instead of naming a glyph themselves —
 * a Playoffs link once wore the bracket in the menu and the title belt in the
 * card below it. `tests/page-icons.test.ts` fails on any copy that disagrees,
 * and on a page-directory entry whose path has no icon here.
 */
import data from '../config/page-icons.json';

const PAGES: Record<string, string> = data.pages;
const OVERRIDES: Record<string, Record<string, string>> = data.leagueOverrides;

/**
 * The glyph id for a league-local page path (`/playoffs`, `/draft/order`,
 * `/standings?view=all_play`). An exact match wins, then the path without its
 * query or hash. Throws on a path with no entry: an unknown page is a missing
 * registry row, not something to paper over with a fallback glyph.
 */
export function pageIcon(path: string, leagueSlug?: string): string {
  const bare = path.split(/[?#]/)[0] || '/';
  const override = leagueSlug ? OVERRIDES[leagueSlug] : undefined;
  const icon = override?.[path] ?? PAGES[path] ?? override?.[bare] ?? PAGES[bare];
  if (!icon) {
    throw new Error(`pageIcon: no icon for "${path}" — add it to src/config/page-icons.json`);
  }
  return icon;
}

/** True when the registry has an icon for this league-local path. */
export function hasPageIcon(path: string): boolean {
  const bare = path.split(/[?#]/)[0] || '/';
  return path in PAGES || bare in PAGES;
}
