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
 *
 * `tests/path-guard-map.test.ts` validates the map: every glob matches a real
 * file, every test and rules doc exists, and every `docs/claude/rules/*.md`
 * is routed by at least one domain.
 *
 * Stdin: Claude Code hook JSON. Stdout: hook JSON (additionalContext) on
 * success. Stderr: vitest output on failure. Exit: 0 pass/no-op, 2 fail.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MAP_FILE = process.env.PATH_GUARD_MAP || path.join(REPO_ROOT, '.claude/hooks/path-guard.json');

const WALK_SKIP = new Set(['node_modules', '.git', 'dist', '.astro', '.vercel']);

/** Load and lightly validate the domain map. */
export function loadMap(file = MAP_FILE) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw.domains)) throw new Error(`${file}: "domains" must be an array`);
  return raw;
}

/** Repo-relative, forward-slash path — what the globs in the map are written against. */
export function toRepoRelative(filePath, root = REPO_ROOT) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..')) return null;
  return rel.split(path.sep).join('/');
}

/** Every domain whose `paths` globs match the given repo-relative file. */
export function matchDomains(relPath, map) {
  if (!relPath) return [];
  return map.domains.filter((d) => (d.paths || []).some((glob) => path.matchesGlob(relPath, glob)));
}

/** All repo files (relative, forward-slash). Used by the map validator. */
export function walkRepo(root = REPO_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (WALK_SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out;
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

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return 0;
  }
  const filePath = input?.tool_input?.file_path || input?.tool_response?.filePath;
  if (!filePath) return 0;

  const map = loadMap();
  const relPath = toRepoRelative(filePath);
  const domains = matchDomains(relPath, map);
  if (domains.length === 0) return 0;

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
      return 2;
    }
    testsRun = tests;
  }

  const claudeMd = readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const additionalContext = buildContext({
    relPath,
    domains,
    sessionId: input.session_id,
    claudeMd,
    testsRun,
  });
  if (additionalContext) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }) + '\n',
    );
  }
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
