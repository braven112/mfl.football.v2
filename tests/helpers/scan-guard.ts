import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Shared primitives for scan-style guard tests.
 *
 * ~20 suites in tests/ follow the same shape — walk some directories, look for
 * a pattern, fail with `path:line`, and carry a short documented allowlist
 * (league-literal-guard, design-token-guard, marquee-live-guard, …). Each one
 * re-implemented the walk, the line-number bookkeeping and the allowlist
 * scoping, which made the NEXT guard a 150-line job and therefore a job that
 * mostly did not get done: CLAUDE.md says "if a rule can be enforced by a
 * guard test, write the test too", and the honest reason it often was not is
 * cost. These helpers make a new guard ~15 lines. `/guard-test` is the skill
 * that writes them.
 *
 * Three shapes cover nearly every rule in docs/claude/rules/:
 *
 *   scanForbidden  — "never write X in Y"            (literal, host, raw fetch)
 *   scanRequired   — "a file that has X must have Y"  (every article type
 *                     declares relatedLinks; every page has a directory entry)
 *   assertRatchet  — "this count may only go down"    (typecheck errors,
 *                     forked siblings)
 *
 * Every helper reports every hit with `file:line` so the failure is a to-do
 * list, and every allowlist entry must still be USED — a stale exemption is
 * how a guard silently widens. Keep allowlists scoped (by pattern name), keep
 * reasons specific, and prefer fixing the file to listing it.
 */

export const REPO_ROOT = process.cwd();

const DEFAULT_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.vercel', 'coverage']);

export interface WalkOptions {
  /** Directories (repo-relative) to scan. Files are accepted too. */
  roots: string[];
  /** Extensions to include, with the dot (e.g. `['.ts', '.astro']`). Omit for all files. */
  extensions?: string[];
  /** Extra directory NAMES to skip anywhere in the tree. node_modules/.git/dist are always skipped. */
  skipDirs?: string[];
  /** Repo-relative file paths to leave out entirely (the registry itself, generated feeds, …). */
  skipFiles?: string[];
}

/** Every file under `roots`, as repo-relative forward-slash paths, sorted. */
export function walkFiles(opts: WalkOptions): string[] {
  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(opts.skipDirs ?? [])]);
  const skipFiles = new Set(opts.skipFiles ?? []);
  const exts = opts.extensions ? new Set(opts.extensions) : null;
  const out: string[] = [];
  const visit = (abs: string) => {
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (skipDirs.has(path.basename(abs))) return;
      for (const entry of readdirSync(abs)) visit(path.join(abs, entry));
      return;
    }
    if (exts && !exts.has(path.extname(abs))) return;
    if (skipFiles.has(rel)) return;
    out.push(rel);
  };
  for (const root of opts.roots) {
    const abs = path.resolve(REPO_ROOT, root);
    if (existsSync(abs)) visit(abs);
  }
  return out.sort();
}

export interface Hit {
  file: string;
  line: number;
  /** The pattern name that matched. */
  name: string;
  /** The matched text. */
  match: string;
  /** The whole source line, trimmed. */
  text: string;
}

export interface AllowlistEntry {
  /** Repo-relative file path. */
  file: string;
  /** Pattern names this entry exempts. Omit to exempt every pattern in that file — prefer naming them. */
  names?: string[];
  /** Why this file may keep the pattern. Required; a guard with unexplained exemptions is a guard nobody trusts. */
  reason: string;
}

export interface ForbiddenPattern {
  name: string;
  /** Global flag is added if missing. */
  pattern: RegExp;
}

export interface ScanForbiddenOptions extends WalkOptions {
  forbidden: ForbiddenPattern[];
  allowlist?: AllowlistEntry[];
  /**
   * Structural exemption: return true to ignore a match on this line (e.g. a
   * literal inside an import specifier, a comment, a test fixture). Keep it
   * narrow and explain it in the test's header comment.
   */
  exempt?: (ctx: { file: string; line: string; match: string; name: string }) => boolean;
}

export interface ScanResult {
  hits: Hit[];
  /** Allowlist entries that exempted nothing — the file was fixed or renamed. Remove them. */
  unusedAllowlist: AllowlistEntry[];
}

function withGlobal(re: RegExp): RegExp {
  return re.flags.includes('g') ? new RegExp(re.source, re.flags) : new RegExp(re.source, re.flags + 'g');
}

/** Find every occurrence of any forbidden pattern, minus allowlisted and structurally-exempt matches. */
export function scanForbidden(opts: ScanForbiddenOptions): ScanResult {
  const files = walkFiles(opts);
  const allowlist = opts.allowlist ?? [];
  const used = new Set<AllowlistEntry>();
  const hits: Hit[] = [];

  for (const file of files) {
    const lines = readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n');
    for (const { name, pattern } of opts.forbidden) {
      const re = withGlobal(pattern);
      lines.forEach((text, i) => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          if (m[0] === '') {
            re.lastIndex++;
            continue;
          }
          if (opts.exempt?.({ file, line: text, match: m[0], name })) continue;
          const entry = allowlist.find((a) => a.file === file && (!a.names || a.names.includes(name)));
          if (entry) {
            used.add(entry);
            continue;
          }
          hits.push({ file, line: i + 1, name, match: m[0], text: text.trim() });
        }
      });
    }
  }

  return { hits, unusedAllowlist: allowlist.filter((a) => !used.has(a)) };
}

export interface ScanRequiredOptions extends WalkOptions {
  /** Human name for the failure message, e.g. "article types declare relatedLinks". */
  name: string;
  /** Files where this test applies: those matching `when` (or every walked file when omitted). */
  when?: RegExp;
  /** What each such file must contain. */
  require: RegExp;
  allowlist?: AllowlistEntry[];
}

export interface RequiredResult {
  /** Files that matched `when` but not `require`. */
  missing: string[];
  unusedAllowlist: AllowlistEntry[];
}

/** Find every file that has the trigger but lacks the required companion. */
export function scanRequired(opts: ScanRequiredOptions): RequiredResult {
  const allowlist = opts.allowlist ?? [];
  const used = new Set<AllowlistEntry>();
  const missing: string[] = [];
  for (const file of walkFiles(opts)) {
    const src = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    if (opts.when && !opts.when.test(src)) continue;
    if (opts.require.test(src)) continue;
    const entry = allowlist.find((a) => a.file === file && (!a.names || a.names.includes(opts.name)));
    if (entry) {
      used.add(entry);
      continue;
    }
    missing.push(file);
  }
  return { missing, unusedAllowlist: allowlist.filter((a) => !used.has(a)) };
}

/** `path:line  [name]  matched-text` per hit — paste-able into an editor's go-to. */
export function formatHits(hits: Hit[]): string {
  return hits.map((h) => `  ${h.file}:${h.line}  [${h.name}]  ${h.text}`).join('\n');
}

export function formatUnused(entries: AllowlistEntry[]): string {
  return entries.map((a) => `  ${a.file}${a.names ? ` (${a.names.join(', ')})` : ''} — "${a.reason}"`).join('\n');
}

/**
 * Assert a scan came back clean. Fails on any hit AND on any allowlist entry
 * that no longer exempts anything, with a message that is a to-do list.
 */
export function expectClean(result: ScanResult, rule: string): void {
  const problems: string[] = [];
  if (result.hits.length) {
    problems.push(`${rule}\n${result.hits.length} violation(s):\n${formatHits(result.hits)}`);
  }
  if (result.unusedAllowlist.length) {
    problems.push(`Stale allowlist entries (remove them — they exempt nothing now):\n${formatUnused(result.unusedAllowlist)}`);
  }
  if (problems.length) throw new Error(problems.join('\n\n'));
}

export function expectAllPresent(result: RequiredResult, rule: string): void {
  const problems: string[] = [];
  if (result.missing.length) {
    problems.push(`${rule}\n${result.missing.length} file(s) missing it:\n  ${result.missing.join('\n  ')}`);
  }
  if (result.unusedAllowlist.length) {
    problems.push(`Stale allowlist entries (remove them — they exempt nothing now):\n${formatUnused(result.unusedAllowlist)}`);
  }
  if (problems.length) throw new Error(problems.join('\n\n'));
}

export interface RatchetOptions {
  /** Repo-relative JSON file holding `{ "total": number, ... }` (or `items: string[]`). */
  baselineFile: string;
  /** The number measured now. */
  current: number;
  /** What is being counted, for the message. */
  label: string;
  /** Command or edit that retightens the baseline. */
  howToRetighten: string;
}

/**
 * A count that may only go DOWN. Fails if it rose (regression) and if it fell
 * (progress — retighten the baseline so the slack can't hide the next
 * regression). Same idiom as tests/fixtures/typecheck-baseline.json.
 */
export function assertRatchet(opts: RatchetOptions): void {
  const abs = path.join(REPO_ROOT, opts.baselineFile);
  const baseline = JSON.parse(readFileSync(abs, 'utf8')) as { total: number };
  if (typeof baseline.total !== 'number') {
    throw new Error(`${opts.baselineFile}: expected a numeric "total"`);
  }
  if (opts.current > baseline.total) {
    throw new Error(
      `${opts.label}: ${opts.current} > baseline ${baseline.total} — a regression. Fix the new cases; do not raise the baseline.`,
    );
  }
  if (opts.current < baseline.total) {
    throw new Error(
      `${opts.label}: ${opts.current} < baseline ${baseline.total} — progress. Retighten: ${opts.howToRetighten}`,
    );
  }
}
