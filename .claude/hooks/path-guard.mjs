#!/usr/bin/env node
/**
 * PostToolUse hook: path-scoped guard tests + rules-doc routing.
 *
 * Generalizes the old `roger-reminder-test.sh` (one hardcoded path list, one
 * test file) into a data-driven map: `.claude/hooks/path-guard.json` pairs
 * each domain's file globs with the guard suites that pin its rules and the
 * rules doc that explains them. On every Write/Edit/MultiEdit the hook:
 *
 *   1. resolves the edited file against every domain's `paths` globs;
 *   2. runs the union of the matched domains' `tests` (one vitest process);
 *   3. on failure exits 2 with the vitest output on stderr — Claude sees the
 *      failing assertion immediately, before the next edit builds on it;
 *   4. on success injects `additionalContext` naming the governing rules doc
 *      and its one-line trap (pulled from the CLAUDE.md "Read before you
 *      touch" table so the two never drift), ONCE per domain per session.
 *
 * Why a hook and not prose: CLAUDE.md says "read the rules doc BEFORE editing
 * in that territory" and "if a rule can be enforced by a guard test, write the
 * test" — but both only work if someone remembers. This makes the router and
 * the guard suites fire mechanically, keyed on the path being edited.
 *
 * Silent no-op if: the edited path matches no domain, `node_modules/.bin/vitest`
 * is missing (CI clone before install), or the hook input can't be parsed.
 * Anything else that stops the guard running (a malformed map, Node < 22.5
 * without path.matchesGlob) exits 2 with one line, so it is seen, not skipped.
 *
 * `tests/path-guard-map.test.ts` validates the map: every glob matches a real
 * file, every test and rules doc exists, and every `docs/claude/rules/*.md`
 * is routed by at least one domain.
 *
 * Stdin: Claude Code hook JSON. Stdout: hook JSON (additionalContext) on
 * success. Stderr: vitest output on failure. Exit: 0 pass/no-op, 2 fail.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from '../../scripts/lib/walk.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MAP_FILE = process.env.PATH_GUARD_MAP || path.join(REPO_ROOT, '.claude/hooks/path-guard.json');

/** Load and lightly validate the domain map. */
export function loadMap(file = MAP_FILE) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw.domains)) throw new Error(`${file}: "domains" must be an array`);
  return raw;
}

/**
 * Repo-relative, forward-slash path — what the globs in the map are written
 * against. REPO_ROOT comes from import.meta.url, which Node realpaths; the
 * path Claude hands us is not, so under a symlinked checkout (macOS /tmp,
 * a linked worktree) the two would disagree and every edit would resolve to
 * `..`. Realpath the file (or its nearest existing ancestor, for a Write
 * that has not landed yet) before comparing.
 */
export function toRepoRelative(filePath, root = REPO_ROOT) {
  let abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  abs = realpathNearest(abs);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..')) return null;
  return rel.split(path.sep).join('/');
}

function realpathNearest(abs) {
  let probe = abs;
  const tail = [];
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return abs;
    tail.unshift(path.basename(probe));
    probe = parent;
  }
  try {
    return path.join(realpathSync(probe), ...tail);
  } catch {
    return abs;
  }
}

/** Every domain whose `paths` globs match the given repo-relative file. */
export function matchDomains(relPath, map) {
  if (!relPath) return [];
  return map.domains.filter((d) => (d.paths || []).some((glob) => path.matchesGlob(relPath, glob)));
}

/**
 * All repo files (relative, forward-slash). Used by the map validator.
 * @param {string} [root]
 * @param {{ skipPaths?: string[] }} [opts]
 */
export function walkRepo(root = REPO_ROOT, { skipPaths = [] } = {}) {
  return walkFiles(root, { skipPaths, relativeTo: root });
}

/**
 * The trap line for a rules doc, read from the CLAUDE.md "Read before you
 * touch" table: the row whose "Read first" cell names the doc. Returns null
 * when the doc has no row (cross-cutting rules live in CLAUDE.md prose).
 */
export function trapLineFor(rulesDoc, claudeMd) {
  for (const line of claudeMd.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (!cells[1].includes(rulesDoc)) continue;
    return cells[2].replace(/`/g, '');
  }
  return null;
}

/** One marker directory per session so rules context is injected once per domain. */
function seenFile(sessionId, domainName) {
  const dir = path.join(tmpdir(), `claude-path-guard-${sessionId || 'nosession'}`);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, domainName.replace(/[^a-z0-9_-]/gi, '_'));
}

/**
 * New-page checks for a route under src/pages/<league>/: is it registered in
 * page-directory.json, and does every other league that has a page directory
 * carry the same route? Pure — takes the registry slugs and the directory
 * entries so the validator can exercise it without touching disk.
 *
 * Both are CLAUDE.md rules with no other edit-time signal: an unregistered
 * page is invisible to site search, and a route present in one league only
 * is either a deliberate league-specific feature or a twin that was
 * forgotten — the hook cannot tell which, so it says so and moves on.
 */
export function newPageWarnings(relPath, { leagues, directory, exists, defaultLeague }) {
  const m = relPath.match(/^src\/pages\/([^/]+)\/(.+)\.astro$/);
  if (!m || !leagues.some((l) => l.slug === m[1])) return [];
  const [, league, route] = m;
  if (route.includes('[') || route === 'index') return []; // dynamic and index routes are not directory entries
  const warnings = [];
  // A bare path ("/lineup") belongs to the DEFAULT league only — search
  // filters entries with pathBelongsToLeague (src/config/footer-config.ts),
  // which sends every unprefixed path to it. Every other league's page is
  // registered only by its prefixed path ("/afl-fantasy/lineup"); today no
  // AFL page is registered by a bare entry alone, and this keeps it that way.
  const bare = `/${route.replace(/\/index$/, '')}`;
  const prefixed = `/${league}${bare}`;
  const registered = directory.some((e) => e.path === prefixed || (league === defaultLeague && e.path === bare));
  if (!registered) {
    const wanted = league === defaultLeague ? `"${bare}" (or "${prefixed}")` : `"${prefixed}"`;
    warnings.push(
      `[path-guard] ${relPath} has no entry with path ${wanted} in src/data/page-directory.json — add one (10+ tags) or ${league}'s site search cannot find it (CLAUDE.md "Page directory registry — required for every new page").`,
    );
  }
  // Best-ball leagues are draft-only with opt-in nav (docs/claude/rules/best-ball.md);
  // a missing twin there is the norm, so they are skipped via the registry flag.
  const twinsMissing = leagues
    .filter((l) => l.slug !== league && !l.bestBall && exists(`src/pages/${l.slug}`) && !exists(`src/pages/${l.slug}/${route}.astro`))
    .map((l) => l.slug);
  if (twinsMissing.length) {
    warnings.push(
      `[path-guard] ${relPath} has no twin under ${twinsMissing.map((s) => `src/pages/${s}/`).join(', ')} — if the feature applies there too, build it as a shared component with a thin route per league (/new-page), not a copy.`,
    );
  }
  return warnings;
}

export function buildContext({ relPath, domains, sessionId, claudeMd, testsRun }) {
  const lines = [];
  for (const d of domains) {
    const marker = seenFile(sessionId, d.name);
    if (existsSync(marker)) continue;
    writeFileSync(marker, new Date().toISOString());
    const docs = [].concat(d.rules || []);
    const parts = [`[path-guard] ${relPath} is in the "${d.name}" domain.`];
    for (const doc of docs) {
      const trap = trapLineFor(doc, claudeMd);
      parts.push(`Read ${doc} before continuing.${trap ? ` Trap: ${trap}` : ''}`);
    }
    if (d.note) parts.push(d.note);
    lines.push(parts.join(' '));
  }
  if (testsRun.length) {
    lines.push(
      `[path-guard] ${testsRun.length} guard suite(s) passed for ${relPath} (${domains.map((d) => d.name).join(', ')}).`,
    );
  }
  return lines.join('\n');
}

async function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return 0;
  }
  const filePath = input?.tool_input?.file_path || input?.tool_response?.filePath;
  if (!filePath) return 0;
  const relPath = toRepoRelative(filePath);
  if (!relPath) return 0;

  if (typeof path.matchesGlob !== 'function') {
    throw new Error(`Node ${process.version} lacks path.matchesGlob — path-guard needs Node >= 22.5 on PATH (settings.json runs plain \`node\`).`);
  }

  // New-page checks run BEFORE the domain match so a nested route no glob
  // reaches still gets them. Once per file per session — but the marker is
  // written only when the warnings are actually shown (see pageShown), so a
  // failing guard suite on the same edit does not swallow them for the session.
  let pageWarnings = [];
  let pageMarker = null;
  if (/^src\/pages\//.test(relPath)) {
    pageMarker = seenFile(input.session_id, `newpage__${relPath}`);
    if (!existsSync(pageMarker)) {
      const { ALL_LEAGUES, DEFAULT_LEAGUE_SLUG } = await import(path.join(REPO_ROOT, 'src/config/leagues-data.mjs'));
      const directory = JSON.parse(readFileSync(path.join(REPO_ROOT, 'src/data/page-directory.json'), 'utf8'));
      pageWarnings = newPageWarnings(relPath, {
        leagues: ALL_LEAGUES.map((l) => ({ slug: l.slug, bestBall: Boolean(l.bestBall) })),
        directory,
        exists: (p) => existsSync(path.join(REPO_ROOT, p)),
        defaultLeague: DEFAULT_LEAGUE_SLUG,
      });
    } else {
      pageMarker = null;
    }
  }
  const pageShown = () => pageMarker && writeFileSync(pageMarker, new Date().toISOString());

  const map = loadMap();
  const domains = matchDomains(relPath, map);
  if (domains.length === 0) {
    if (pageWarnings.length) {
      emit(pageWarnings.join('\n'));
      pageShown();
    }
    return 0;
  }

  const tests = [...new Set(domains.flatMap((d) => d.tests || []))].filter((t) =>
    existsSync(path.join(REPO_ROOT, t)),
  );

  const vitest = path.join(REPO_ROOT, 'node_modules/.bin/vitest');
  let testsRun = [];
  if (tests.length && !existsSync(vitest)) {
    process.stderr.write('⚠️  vitest not found — path-guard tests skipped. Run pnpm install first.\n');
  } else if (tests.length) {
    const res = spawnSync(vitest, ['run', ...tests], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    if (res.status !== 0) {
      process.stderr.write(
        `[path-guard] ${relPath} matched domain(s) ${domains.map((d) => d.name).join(', ')}; guard tests FAILED:\n`,
      );
      process.stderr.write((res.stdout || '') + (res.stderr || ''));
      if (pageWarnings.length) {
        process.stderr.write(pageWarnings.join('\n') + '\n');
        pageShown();
      }
      return 2;
    }
    testsRun = tests;
  }

  const claudeMd = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const additionalContext = [
    buildContext({ relPath, domains, sessionId: input.session_id, claudeMd, testsRun }),
    ...pageWarnings,
  ]
    .filter(Boolean)
    .join('\n');
  if (additionalContext) emit(additionalContext);
  pageShown();
  return 0;
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }) + '\n',
  );
}

// Basename match rather than a resolved-path compare: Node realpaths
// import.meta.url but not argv[1], so under a symlinked checkout (macOS /tmp,
// a worktree in a linked dir) the two differ and the hook would silently skip.
const invokedDirectly = process.argv[1] && /path-guard\.mjs$/.test(process.argv[1]);
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      // A guard that cannot run must not fail open: exit 2 puts this one line
      // in front of Claude on the edit, instead of silently skipping every
      // suite for the rest of the session. The documented no-ops (unparseable
      // stdin, no file_path, vitest missing) still exit 0 inside main().
      process.stderr.write(`[path-guard] cannot run: ${err?.message ?? err}\n`);
      process.exit(2);
    });
}
