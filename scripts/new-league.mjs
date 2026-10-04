#!/usr/bin/env node
/**
 * Generate a new league site from a launch spec — the "Launch" half of the
 * League Launcher (step 3 of the new-league roadmap).
 *
 *   node scripts/new-league.mjs --spec spec.json            # write everything
 *   node scripts/new-league.mjs --spec spec.json --dry-run  # print the plan
 *   node scripts/new-league.mjs --spec '{"mflId":…}' --offline
 *
 * `--spec` is a path or inline JSON:
 *
 *   {
 *     "mflId": "12345",                 MFL league id
 *     "slug": "smith",                  lowercase letters/digits; also the nav slug
 *     "name": "Smith Family League",
 *     "shortName": "Smith",             optional
 *     "mflHost": "www4x.myfantasyleague.com",  the league's MFL server
 *     "archetype": "standard-redraft",  src/config/league-archetypes.mjs
 *     "features": { …every catalog key: boolean },
 *     "duplicatePlayers": false,        optional (MFL playerLimitUnit ≠ LEAGUE)
 *     "adminFranchiseIds": ["0001"],    optional
 *     "theme": "archies"                optional; a file in src/themes/
 *   }
 *
 * What it writes (all derived from the spec and the registry, nothing per
 * league is hand-kept here):
 *   - the registry entry in src/config/leagues-data.mjs;
 *   - data/<slug>/<slug>.config.json (empty teams; filled by branding);
 *   - data seeds the pages import directly (news feed, free-agents shape);
 *   - one thin route per page the ticked features entitle, generated from
 *     Archie's routes (the package-league template) with the slug swapped;
 *   - page-directory entries and a nav section for those routes;
 *   - its config in chromatic.yml (the scheduled jobs read the registry —
 *     scripts/lib/league-jobs.mjs — so no workflow lists the league);
 *   - the regenerated theme stylesheet (it selects every league).
 * Then, unless `--offline`: fetches the league's MFL feeds, suggests its
 * branding, and computes its free-agent board.
 *
 * Pages are Archie's set gated by feature: the shared pages that already
 * work for any league. The richer TheLeague/AFL pages arrive as they are
 * unforked (roadmap item 6). Archie's own competition (The Gauntlet, the MAD
 * standings) and its theme previews are never copied.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES } from '../src/config/leagues-data.mjs';
import { ARCHETYPES } from '../src/config/league-archetypes.mjs';
import { FEATURE_KEYS } from '../src/config/league-feature-catalog.mjs';
import { PACKAGE_ROUTES, packageRouteForPath, packageRoutesFor } from '../src/config/package-league-routes.mjs';
import { specErrors as baseSpecErrors } from '../src/config/launch-spec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = 'archies';
const TEMPLATE_DIR = path.join(ROOT, 'src/pages', TEMPLATE);
export const PLACEHOLDER_LOGO = '/assets/logos/league-placeholder.svg';


// ── Spec ─────────────────────────────────────────────────────────────────────

/**
 * Every problem with a spec: the shared checks (src/config/launch-spec.mjs,
 * the same ones the Launcher page runs) plus this checkout's filesystem.
 */
export function specErrors(spec) {
  const errors = baseSpecErrors(spec);
  if (errors.length) return errors;
  if (spec.theme !== undefined && !fs.existsSync(path.join(ROOT, 'src/themes', `${spec.theme}.json`))) {
    errors.push(`theme ${spec.theme} has no src/themes/${spec.theme}.json`);
  }
  if (fs.existsSync(path.join(ROOT, 'src/pages', spec.slug))) errors.push(`src/pages/${spec.slug} already exists`);
  return errors;
}

/** The routes a spec's features entitle (src/config/package-league-routes.mjs). */
export const routesFor = packageRoutesFor;

// ── Text transforms ──────────────────────────────────────────────────────────

/** Rewrite Archie's template text for the new league. */
export function retarget(text, spec) {
  const short = spec.shortName ?? spec.name;
  return text
    .replaceAll(`data/${TEMPLATE}/${TEMPLATE}.config.json`, `data/${spec.slug}/${spec.slug}.config.json`)
    .replace(/Archie's Fantasy Football League/g, spec.name)
    .replace(/Archie's/g, short)
    .replace(/archiesConfig/g, 'leagueConfig')
    .replace(/\barchies\b/g, spec.slug);
}

/** `/archies/standings` → `standings.astro` (the route that serves it), else null. */
function routeOfPath(p) {
  if (p !== `/${TEMPLATE}` && !p.startsWith(`/${TEMPLATE}/`)) return null;
  return packageRouteForPath(p.slice(TEMPLATE.length + 1));
}

// ── Registry entry ───────────────────────────────────────────────────────────

/** A JS literal in the registry's house style: single-quoted strings. */
const q = (v) =>
  JSON.stringify(v).replace(/"((?:[^"\\]|\\.)*)"/g, (_, body) => {
    const raw = JSON.parse(`"${body}"`);
    return raw.includes("'") ? JSON.stringify(raw) : `'${raw}'`;
  }).replace(/,(?=\S)/g, ', ');

export function registryEntry(spec, today = new Date().toISOString().slice(0, 10)) {
  const preset = ARCHETYPES[spec.archetype];
  const example = preset.example ? LEAGUES[preset.example] : null;
  const rankingSources = (example ?? LEAGUES[TEMPLATE]).defaultRankingSources ?? [];
  const f = spec.features;
  const lines = [
    `  ${spec.slug}: {`,
    `    /** Generated by scripts/new-league.mjs on ${today} (${spec.archetype}). */`,
    `    id: ${q(String(spec.mflId))},`,
    `    slug: ${q(spec.slug)},`,
    `    navSlug: /** @type {const} */ (${q(spec.slug)}),`,
    `    theme: ${q(spec.theme ?? TEMPLATE)},`,
    `    archetype: ${q(spec.archetype)},`,
    `    adminFranchiseIds: ${q(spec.adminFranchiseIds ?? [])},`,
    `    name: ${q(spec.name)},`,
    ...(spec.shortName ? [`    shortName: ${q(spec.shortName)},`] : []),
    `    /** Placeholder mark until the league's own art is set (both cuts, per the registry rule). */`,
    `    logo: { light: ${q(PLACEHOLDER_LOGO)}, dark: ${q(PLACEHOLDER_LOGO)} },`,
    `    mflHost: ${q(spec.mflHost)},`,
    `    dataPath: ${q(`data/${spec.slug}`)},`,
    `    configPath: ${q(`data/${spec.slug}/${spec.slug}.config.json`)},`,
    `    schefterFeedPath: ${q(`data/${spec.slug}/schefter-feed.json`)},`,
    `    domains: [],`,
    `    stagingDomains: [],`,
    `    advertiseOnSharedHost: false,`,
    `    optInNav: true,`,
    `    ownersPoll: { enabled: false, slots: 0, closeWeekday: 4, closeHourPT: 16 },`,
    ...(f.powerRankings ? [`    peckingOrder: { topN: 25 },`] : []),
    ...(spec.duplicatePlayers ? [`    duplicatePlayers: true,`] : []),
    `    officialClock: {`,
    `      id: 'PT',`,
    `      zone: 'America/Los_Angeles',`,
    `      label: 'PT',`,
    `      name: "The league's clock (Pacific)",`,
    `      equivalents: ['America/Vancouver', 'America/Tijuana'],`,
    `    },`,
    `    tradeDeadline: null,`,
    `    features: {`,
    ...FEATURE_KEYS.map((k) => `      ${k}: ${Boolean(f[k])},`),
    `    },`,
    `    defaultRankingSources: ${q(rankingSources)},`,
    `    /** No weekly Schefter articles until chosen: each type links pages a package league may not have. */`,
    `    articleTypes: [],`,
    `  },`,
  ];
  return lines.join('\n') + '\n';
}

/** Insert `entry` as the last member of `export const LEAGUES = { … };`. */
export function insertRegistryEntry(source, entry) {
  const start = source.indexOf('export const LEAGUES = {');
  if (start < 0) throw new Error('LEAGUES object not found in leagues-data.mjs');
  const end = source.indexOf('\n};\n', start);
  if (end < 0) throw new Error('end of LEAGUES object not found');
  return `${source.slice(0, end + 1)}${entry}${source.slice(end + 1)}`;
}

// ── Plan ─────────────────────────────────────────────────────────────────────

/**
 * Every file the launch writes, as { path, content } with repo-relative paths.
 * Pure apart from reading the template files and the current repo files.
 */
export function planLaunch(spec) {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const files = [];
  const year = new Date().getFullYear();

  // Registry.
  const registryPath = 'src/config/leagues-data.mjs';
  files.push({ path: registryPath, content: insertRegistryEntry(read(registryPath), registryEntry(spec)) });

  // Data seeds the pages import directly.
  const dataDir = `data/${spec.slug}`;
  files.push({
    path: `${dataDir}/${spec.slug}.config.json`,
    content: `${JSON.stringify(
      {
        $comment: `${spec.name}: teams, divisions and branding. Seeded empty by scripts/new-league.mjs; filled by scripts/suggest-league-branding.mjs --league ${spec.slug} --write, then edited by hand or the branding editor.`,
        leagueId: String(spec.mflId),
        name: spec.name,
        structure: 'divisions',
        divisions: [],
        teams: [],
      },
      null,
      2,
    )}\n`,
  });
  files.push({
    path: `${dataDir}/schefter-feed.json`,
    content: `${JSON.stringify({ $comment: `${spec.name} news feed. Starts empty.`, posts: [] }, null, 2)}\n`,
  });
  files.push({
    path: `${dataDir}/derived/free-agents.json`,
    content: `${JSON.stringify(
      {
        generatedForYear: year,
        statsSeasonYear: year,
        mflHost: spec.mflHost,
        conferences: { ids: [], names: {}, franchiseConferences: {} },
        rosterFranchiseCount: 0,
        hasProjected: false,
        hasSeasonPts: false,
        hasAdp: false,
        defaultSort: 'projected',
        defaultDir: 'desc',
        faCounts: {},
        positions: [],
        nflTeamsList: [],
        topFa: null,
        players: [],
      },
      null,
      2,
    )}\n`,
  });

  // Routes.
  const routes = routesFor(spec.features);
  for (const route of routes) {
    files.push({
      path: `src/pages/${spec.slug}/${route}`,
      content: retarget(fs.readFileSync(path.join(TEMPLATE_DIR, route), 'utf8'), spec),
    });
  }
  const routeSet = new Set(routes);

  // Page directory: Archie's public entries whose route was generated.
  const dirPath = 'src/data/page-directory.json';
  const directory = JSON.parse(read(dirPath));
  const added = directory
    .filter((e) => {
      const route = routeOfPath(e.path);
      return route && routeSet.has(route) && e.visibility === 'all';
    })
    .map((e) => JSON.parse(retarget(JSON.stringify(e), spec)));
  files.push({ path: dirPath, content: `${JSON.stringify([...directory, ...added], null, 2)}\n` });

  // Nav: Archie's section, links limited to generated routes.
  const navPath = 'src/config/nav-config.json';
  const nav = JSON.parse(read(navPath));
  const template = nav.sections.find((s) => s.id === TEMPLATE);
  if (template) {
    const section = JSON.parse(retarget(JSON.stringify(template), spec));
    section.links = section.links.filter((l) => routeSet.has(routeOfPath(`/${TEMPLATE}${l.path}`) ?? ''));
    const at = nav.sections.indexOf(template) + 1;
    nav.sections.splice(at, 0, section);
    files.push({ path: navPath, content: `${JSON.stringify(nav, null, 2)}\n` });
  }

  // Chromatic: every league's config renders into a story (the shared
  // league-config loader globs them all), so each one is a trigger path.
  const chromaticPath = '.github/workflows/chromatic.yml';
  const chromatic = read(chromaticPath);
  const configLine = /^(\s+)- 'data\/archies\/archies\.config\.json'\n/gm;
  if (!configLine.test(chromatic)) throw new Error('chromatic.yml config path anchor not found');
  files.push({
    path: chromaticPath,
    content: chromatic.replace(configLine, (line, indent) => `${line}${indent}- 'data/${spec.slug}/${spec.slug}.config.json'\n`),
  });

  return { files, routes, directoryEntries: added.length };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function readSpec(arg) {
  if (!arg) throw new Error('--spec <file|json> is required');
  const raw = arg.trim().startsWith('{') ? arg : fs.readFileSync(arg, 'utf8');
  return JSON.parse(raw);
}

function run(cmd, args, env = {}) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const dryRun = argv.includes('--dry-run');
  const offline = argv.includes('--offline');

  const spec = readSpec(opt('--spec') ?? process.env.LAUNCH_SPEC);
  const errors = specErrors(spec);
  if (errors.length) {
    console.error(`Spec rejected:\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }

  const plan = planLaunch(spec);
  console.log(`Launching ${spec.name} (${spec.slug}, MFL ${spec.mflId}) as ${spec.archetype}`);
  console.log(`  ${plan.routes.length} pages, ${plan.directoryEntries} page-directory entries`);
  for (const f of plan.files) console.log(`  ${dryRun ? 'would write' : 'write'} ${f.path}`);
  if (dryRun) process.exit(0);

  for (const f of plan.files) {
    const abs = path.join(ROOT, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }

  // The theme stylesheet selects every league by its data-league; regenerate it.
  run(process.execPath, ['scripts/generate-league-themes.mjs']);

  if (!offline) {
    const env = { MFL_LEAGUE_ID: String(spec.mflId), MFL_LEAGUE_SLUG: spec.slug };
    run(process.execPath, ['scripts/fetch-mfl-feeds.mjs'], env);
    run(process.execPath, ['scripts/suggest-league-branding.mjs', '--league', spec.slug, '--write']);
    run(process.execPath, ['scripts/compute-free-agents.mjs', '--league', spec.slug]);
  }

  console.log(`\nDone. Still by hand:
  - Replace the placeholder logo (registry \`logo\`, both cuts) with the league's art.
  - Review data/${spec.slug}/${spec.slug}.config.json (team names, colours, divisions).
  - Optional: a custom domain (registry \`domains\`, Vercel, DNS).`);
}
