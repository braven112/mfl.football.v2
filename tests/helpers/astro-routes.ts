import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const PAGES_DIR = path.resolve(__dirname, '../../src/pages');

/**
 * Does an internal href resolve to a real Astro route?
 *
 * Checked against `src/pages/` rather than `page-directory.json`: the
 * directory is a search index a page can legitimately be missing from, while
 * a route either exists or 404s — and a link is about the second thing.
 *
 * DYNAMIC SEGMENTS MATTER HERE. Every Schefter article permalink is
 * `/theleague/news/<id>`, served by `news/[id].astro`, so a resolver that only
 * looked for a literal file would call all four published articles broken and
 * teach whoever hit it that the guard is noise. A segment therefore matches:
 *   - a literal `<segment>.astro` or `<segment>/index.astro`
 *   - any `[param].astro` in that directory (one segment)
 *   - any `[...rest].astro` (the remaining segments, so matching stops there)
 * Query strings and hashes are stripped first — `?b=0012` is not a path.
 */
export function astroRouteExists(href: string, pagesDir = PAGES_DIR): boolean {
  if (typeof href !== 'string' || !href.startsWith('/')) return false;
  const [pathOnly] = href.split(/[?#]/);
  const segments = pathOnly.split('/').filter(Boolean);
  if (segments.length === 0) return existsSync(path.join(pagesDir, 'index.astro'));

  let dir = pagesDir;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;

    if (isLast && existsSync(path.join(dir, `${segment}.astro`))) return true;
    if (isLast && existsSync(path.join(dir, segment, 'index.astro'))) return true;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    // A rest param swallows everything left, so it settles the whole path —
    // EXCEPT at the pages root, where `[...path].astro` is the shared-host
    // router that maps unprefixed paths onto a league and 404s everything
    // else. Counting it would make every string on earth a valid route and
    // this whole check a no-op, which is how `/schefter/tip` (unprefixed, and
    // genuinely dead on the shared host) first passed.
    if (i > 0 && entries.some((e) => e.startsWith('[...') && e.endsWith('.astro'))) return true;

    if (!isLast && existsSync(path.join(dir, segment))) {
      dir = path.join(dir, segment);
      continue;
    }
    if (isLast) {
      return entries.some((e) => /^\[[^.\]]+\]\.astro$/.test(e));
    }
    // A dynamic DIRECTORY segment, e.g. pecking-order/[year]/…
    const dynamicDir = entries.find((e) => /^\[[^.\]]+\]$/.test(e));
    if (dynamicDir) {
      dir = path.join(dir, dynamicDir);
      continue;
    }
    return false;
  }
  return false;
}
