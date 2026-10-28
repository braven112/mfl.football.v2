/**
 * Writes src/data/league-routes.json: every static page each league serves,
 * as a path under the league's prefix ('' is the league home).
 *
 * The league switcher (nav-utils#getEquivalentRoute) reads it to keep a
 * visitor on the same page only when the target league HAS that page. Without
 * it, switching from the AFL's standings to Best Ball linked
 * /best-ball-1/standings, a page Best Ball (draft-only) does not have, and the
 * visitor got a 404.
 *
 * Dynamic routes ([param]) are left out: the equivalence map only names static
 * pages. tests/league-routes.test.ts fails when this file is stale.
 *
 *   node scripts/generate-league-routes.mjs
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PAGES = path.join(root, 'src/pages');
const OUT = path.join(root, 'src/data/league-routes.json');

/** Static page routes under one directory, relative to it ('' for its index). */
async function routesUnder(dir) {
  const out = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.includes('[') || entry.name.startsWith('_')) continue;
      if (entry.isDirectory()) {
        await walk(path.join(abs, entry.name), `${rel}/${entry.name}`);
      } else if (entry.name.endsWith('.astro')) {
        const name = entry.name.slice(0, -'.astro'.length);
        out.push(name === 'index' ? rel : `${rel}/${name}`);
      }
    }
  }
  await walk(dir, '');
  return out.sort();
}

export async function buildLeagueRoutes() {
  const routes = {};
  for (const league of ALL_LEAGUES) {
    routes[league.slug] = await routesUnder(path.join(PAGES, league.slug));
  }
  return routes;
}

export async function writeLeagueRoutes(routes) {
  await fs.writeFile(OUT, `${JSON.stringify(routes, null, 2)}\n`);
  console.log(`[league-routes] wrote ${path.relative(root, OUT)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeLeagueRoutes(await buildLeagueRoutes());
}
