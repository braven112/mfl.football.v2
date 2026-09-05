#!/usr/bin/env node
/**
 * Sibling drift report: for every file changed on this branch, where is its
 * twin in the other league, and did the change reach it?
 *
 * TheLeague and the AFL have near-identical pairs (both players pages, both
 * lineup pages, both draft predictors, …). A fix applied to one side and not
 * the other is a recurring bug class here (`.claude/commands/hotfix.md`,
 * `/live` step 5b), and it is INVISIBLE in a diff that touches only one
 * side — a reviewer handed the patch cannot know the twin exists. This
 * enumerates the twins mechanically so the judgment step ("does this change
 * apply there too?") starts from a complete list instead of memory.
 *
 *   node scripts/sibling-drift.mjs                 # branch vs origin/main + working tree
 *   node scripts/sibling-drift.mjs --base main
 *   node scripts/sibling-drift.mjs --json          # machine-readable
 *
 * Rows:
 *   page      src/pages/<league>/<route>  → the same route under every other league dir
 *   component src/components/<league>/X  → src/components/<other league>/X
 *   shared    anything else under src/   → which league pages import it (reach), no twin
 *
 * Sibling status: MISSING (no twin file), ALSO CHANGED (twin is in the diff
 * too), UNCHANGED (twin exists and the diff did not touch it — the row to
 * look at). Exit code is always 0; the report is the output.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { walkFiles } from './lib/walk.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const json = args.includes('--json');

const git = (a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

function changedFiles() {
  const set = new Set();
  const add = (out) => out.split('\n').filter(Boolean).forEach((f) => set.add(f));
  try {
    add(git(['diff', '--name-only', `${base}...HEAD`]));
  } catch {
    add(git(['diff', '--name-only', base]));
  }
  add(git(['diff', '--name-only']));
  add(git(['diff', '--name-only', '--cached'])); // staged, not yet committed — the /live pre-commit case
  add(git(['ls-files', '--others', '--exclude-standard']));
  return [...set].filter((f) => f.startsWith('src/')).sort();
}

const LEAGUE_DIRS = ALL_LEAGUES.map((l) => l.slug);
// Component directories are keyed by slug OR navSlug (src/components/afl and
// src/components/afl-fantasy are BOTH the AFL). Twins are looked up per
// LEAGUE, so two directories of one league never read as each other's twin.
const COMPONENT_DIRS_BY_LEAGUE = new Map(
  ALL_LEAGUES.map((l) => [
    l.slug,
    [...new Set([l.slug, l.navSlug])].filter((d) => existsSync(path.join(ROOT, 'src/components', d))),
  ]),
);
const componentDirLeague = (dir) => [...COMPONENT_DIRS_BY_LEAGUE].find(([, dirs]) => dirs.includes(dir))?.[0];

/** Twin candidates per other league: `[{ league, paths: [...] }]` — a twin exists if ANY path does. */
function classify(file) {
  const page = file.match(/^src\/pages\/([^/]+)\/(.+)$/);
  if (page && LEAGUE_DIRS.includes(page[1])) {
    return {
      kind: 'page',
      league: page[1],
      twins: LEAGUE_DIRS.filter((l) => l !== page[1]).map((l) => ({ league: l, paths: [`src/pages/${l}/${page[2]}`] })),
    };
  }
  const comp = file.match(/^src\/components\/([^/]+)\/(.+)$/);
  const compLeague = comp && componentDirLeague(comp[1]);
  if (compLeague) {
    return {
      kind: 'component',
      league: compLeague,
      twins: [...COMPONENT_DIRS_BY_LEAGUE]
        .filter(([l, dirs]) => l !== compLeague && dirs.length)
        .map(([l, dirs]) => ({ league: l, paths: dirs.map((d) => `src/components/${d}/${comp[2]}`) })),
    };
  }
  return { kind: 'shared' };
}

/** Every league page's source, read ONCE — a branch touching 30 shared files must not read rosters.astro 30 times. */
let leaguePages = null;
function allLeaguePages() {
  if (leaguePages) return leaguePages;
  leaguePages = [];
  for (const rel of walkFiles(path.join(ROOT, 'src/pages'), { extensions: ['.astro', '.ts', '.tsx', '.js', '.mjs'], relativeTo: ROOT })) {
    const m = rel.match(/^src\/pages\/([^/]+)\//);
    if (m && LEAGUE_DIRS.includes(m[1])) leaguePages.push({ league: m[1], src: readFileSync(path.join(ROOT, rel), 'utf8') });
  }
  return leaguePages;
}

/** League pages that import `file` (by basename without extension — good enough for a reach count). */
function importersByLeague(file) {
  const stem = path.basename(file).replace(/\.[^.]+$/, '');
  const needle = new RegExp(`from\\s+['"][^'"]*\\/${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.[a-z]+)?['"]`);
  const out = {};
  for (const page of allLeaguePages()) {
    if (needle.test(page.src)) out[page.league] = (out[page.league] ?? 0) + 1;
  }
  return out;
}

const changed = changedFiles();
const changedSet = new Set(changed);
const rows = [];
for (const file of changed) {
  const c = classify(file);
  if (c.kind === 'shared') {
    rows.push({ file, kind: 'shared', twin: null, status: 'n/a', reach: importersByLeague(file) });
    continue;
  }
  for (const { league, paths } of c.twins) {
    const twin = paths.find((p) => existsSync(path.join(ROOT, p)));
    const status = !twin ? 'MISSING' : changedSet.has(twin) ? 'ALSO CHANGED' : 'UNCHANGED';
    rows.push({ file, kind: c.kind, twin: twin ?? `${paths[0]} (${league})`, status });
  }
}

if (json) {
  console.log(JSON.stringify({ base, changed, rows }, null, 2));
} else {
  console.log(`sibling drift vs ${base}: ${changed.length} changed src file(s)\n`);
  console.log('| changed file | kind | twin | status |');
  console.log('|---|---|---|---|');
  for (const r of rows) {
    const twin = r.twin ?? (Object.entries(r.reach ?? {}).map(([l, n]) => `${l}: ${n} page(s) import`).join(', ') || '—');
    console.log(`| ${r.file} | ${r.kind} | ${twin} | ${r.status} |`);
  }
  const look = rows.filter((r) => r.status === 'UNCHANGED');
  console.log(`\n${look.length} twin(s) exist and were NOT changed — decide for each whether the change applies there.`);
}
