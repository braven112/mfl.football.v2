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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

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
  add(git(['ls-files', '--others', '--exclude-standard']));
  return [...set].filter((f) => f.startsWith('src/')).sort();
}

const LEAGUE_DIRS = ALL_LEAGUES.map((l) => l.slug);
// Component directories are keyed by navSlug in places (afl-fantasy vs afl);
// accept both spellings when looking for a twin.
const COMPONENT_DIRS = [...new Set(ALL_LEAGUES.flatMap((l) => [l.slug, l.navSlug]))].filter((d) =>
  existsSync(path.join(ROOT, 'src/components', d)),
);

function classify(file) {
  const page = file.match(/^src\/pages\/([^/]+)\/(.+)$/);
  if (page && LEAGUE_DIRS.includes(page[1])) return { kind: 'page', league: page[1], rest: page[2], dirs: LEAGUE_DIRS, root: 'src/pages' };
  const comp = file.match(/^src\/components\/([^/]+)\/(.+)$/);
  if (comp && COMPONENT_DIRS.includes(comp[1])) return { kind: 'component', league: comp[1], rest: comp[2], dirs: COMPONENT_DIRS, root: 'src/components' };
  return { kind: 'shared' };
}

let srcFiles = null;
function allSrcFiles() {
  if (srcFiles) return srcFiles;
  srcFiles = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const f = path.join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(astro|ts|tsx|js|mjs)$/.test(e)) srcFiles.push(f);
    }
  };
  walk(path.join(ROOT, 'src'));
  return srcFiles;
}

/** League pages that import `file` (by basename without extension — good enough for a reach count). */
function importersByLeague(file) {
  const stem = path.basename(file).replace(/\.[^.]+$/, '');
  const needle = new RegExp(`from\\s+['"][^'"]*\\/${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.[a-z]+)?['"]`);
  const out = {};
  for (const f of allSrcFiles()) {
    const rel = path.relative(ROOT, f);
    const m = rel.match(/^src\/pages\/([^/]+)\//);
    if (!m || !LEAGUE_DIRS.includes(m[1])) continue;
    if (needle.test(readFileSync(f, 'utf8'))) out[m[1]] = (out[m[1]] ?? 0) + 1;
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
  for (const dir of c.dirs) {
    if (dir === c.league) continue;
    const twin = `${c.root}/${dir}/${c.rest}`;
    const exists = existsSync(path.join(ROOT, twin));
    const status = !exists ? 'MISSING' : changedSet.has(twin) ? 'ALSO CHANGED' : 'UNCHANGED';
    rows.push({ file, kind: c.kind, twin, status });
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
