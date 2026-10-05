/**
 * The package-league page kit: one template per package route
 * (templates/package-league/<route>.tmpl), rendered into every package
 * league's src/pages/<slug>/ — Archie's included.
 *
 * The templates are the source. A league's route files are OUTPUT: edit the
 * template, then `node scripts/sync-league-routes.mjs --all`, and the fix
 * reaches every league at once. tests/package-league-routes.test.ts fails on a
 * route file that drifted from its template, and on a route that exists
 * without its feature (or is missing with it).
 *
 * Kept outside src/ (and as .tmpl) because the placeholders sit inside import
 * paths: under src/ the type checker would resolve `data/__LEAGUE_SLUG__/…`.
 *
 * Placeholders: __LEAGUE_SLUG__ (registry slug — also the data dir and URL
 * prefix), __LEAGUE_NAME__ (full name), __LEAGUE_SHORT__ (short name, falling
 * back to the full name).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES } from '../../src/config/leagues-data.mjs';
import {
  PACKAGE_ROUTES,
  isPackageLeague,
  packageRouteForPath,
  packageRoutesFor,
} from '../../src/config/package-league-routes.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const KIT_DIR = 'templates/package-league';

/** A route's template text. */
export function kitTemplate(route) {
  return fs.readFileSync(path.join(ROOT, KIT_DIR, `${route}.tmpl`), 'utf8');
}

/** Fill a template for a league ({ slug, name, shortName? }). */
export function renderKit(template, league) {
  return template
    .replaceAll('__LEAGUE_NAME__', league.name)
    .replaceAll('__LEAGUE_SHORT__', league.shortName ?? league.name)
    .replaceAll('__LEAGUE_SLUG__', league.slug);
}

/** `src/pages/<slug>/<route>` for a league. */
export const routeFile = (league, route) => `src/pages/${league.slug}/${route}`;

/**
 * What a package league's page dir must hold: every entitled route's rendered
 * file, and which manifest routes must NOT exist (feature off). Routes outside
 * the manifest (a league's own competition page) are the league's own and are
 * never touched.
 */
export function kitPlan(league) {
  const entitled = new Set(packageRoutesFor(league.features));
  const write = [...entitled].map((route) => ({
    path: routeFile(league, route),
    content: renderKit(kitTemplate(route), league),
  }));
  const remove = Object.keys(PACKAGE_ROUTES)
    .filter((route) => !entitled.has(route))
    .map((route) => routeFile(league, route));
  return { write, remove };
}

// ── Site search + nav ────────────────────────────────────────────────────────

const kitJson = (name, league) =>
  JSON.parse(renderKit(fs.readFileSync(path.join(ROOT, KIT_DIR, name), 'utf8'), league));

/** The package route an entry/link path serves for this league, or null. */
function routeOfLeaguePath(league, p) {
  const prefix = `/${league.slug}`;
  if (p !== prefix && !p.startsWith(`${prefix}/`)) return null;
  return packageRouteForPath(p.slice(prefix.length));
}

/**
 * Insert each `wanted` item missing from `list` (matched by `key`) just before
 * the nearest item that FOLLOWS it in `order` and is present (else at the
 * end) — so a re-ticked feature's link returns to where it was, after any of
 * the league's own links that sat before it.
 */
function mergeInOrder(list, wanted, order, key) {
  const out = [...list];
  for (const item of wanted) {
    if (out.some((x) => key(x) === key(item))) continue;
    const after = order.slice(order.findIndex((o) => key(o) === key(item)) + 1);
    const anchor = after.map((o) => out.findIndex((x) => key(x) === key(o))).find((i) => i >= 0);
    out.splice(anchor === undefined ? out.length : anchor, 0, item);
  }
  return out;
}

/** page-directory.json with this league's kit entries matching its features. */
export function syncDirectory(directory, league) {
  const entitled = new Set(packageRoutesFor(league.features));
  const template = kitJson('page-directory.json', league);
  const wanted = template.filter((e) => entitled.has(routeOfLeaguePath(league, e.path)));
  const kept = directory.filter((e) => {
    const route = routeOfLeaguePath(league, e.path);
    return !route || entitled.has(route);
  });
  const missing = wanted.filter((e) => !kept.some((x) => x.path === e.path));
  return [...kept, ...missing];
}

/**
 * nav-config.json with this league's section holding exactly its entitled kit
 * links (its own links — Archie's Gauntlet — untouched). A league with no
 * section gets the kit's, inserted after the last package league's.
 */
export function syncNav(nav, league) {
  const entitled = new Set(packageRoutesFor(league.features));
  const template = kitJson('nav-section.json', league);
  const wanted = template.links.filter((l) => entitled.has(packageRouteForPath(l.path)));
  const sections = [...nav.sections];
  const at = sections.findIndex((s) => s.id === league.slug);
  if (at < 0) {
    const packageIds = new Set(ALL_LEAGUES.filter(isPackageLeague).map((l) => l.slug));
    const last = sections.map((s) => packageIds.has(s.id)).lastIndexOf(true);
    sections.splice(last + 1, 0, { ...template, links: wanted });
    return { ...nav, sections };
  }
  const section = sections[at];
  const kept = section.links.filter((l) => {
    const route = packageRouteForPath(l.path);
    return !route || entitled.has(route);
  });
  sections[at] = { ...section, links: mergeInOrder(kept, wanted, template.links, (l) => l.path) };
  return { ...nav, sections };
}

/**
 * Every file change that brings a package league in line with its features:
 * { path, content } to write, { path, content: null } to delete. Unchanged
 * files are left out, so an in-line league plans nothing.
 */
export function syncPlan(league) {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const changes = [];
  const { write, remove } = kitPlan(league);
  for (const f of write) if (!exists(f.path) || read(f.path) !== f.content) changes.push(f);
  for (const p of remove) if (exists(p)) changes.push({ path: p, content: null });

  const dirPath = 'src/data/page-directory.json';
  const dir = `${JSON.stringify(syncDirectory(JSON.parse(read(dirPath)), league), null, 2)}\n`;
  if (dir !== read(dirPath)) changes.push({ path: dirPath, content: dir });

  const navPath = 'src/config/nav-config.json';
  const nav = `${JSON.stringify(syncNav(JSON.parse(read(navPath)), league), null, 2)}\n`;
  if (nav !== read(navPath)) changes.push({ path: navPath, content: nav });
  return changes;
}

/** Write (or, for `content: null`, delete) each planned change; prunes emptied dirs under src/pages. */
export function applyChanges(changes) {
  for (const c of changes) {
    const abs = path.join(ROOT, c.path);
    if (c.content === null) {
      fs.rmSync(abs, { force: true });
      for (let dir = path.dirname(abs); dir.startsWith(path.join(ROOT, 'src/pages') + path.sep); dir = path.dirname(dir)) {
        if (fs.readdirSync(dir).length) break;
        fs.rmdirSync(dir);
      }
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, c.content);
    }
  }
}
