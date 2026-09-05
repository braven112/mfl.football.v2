/**
 * The two ratchet measurements, shared by the tests that enforce them and by
 * `scripts/ratchet.mjs`, which re-measures and retightens the baselines.
 *
 * One measurement path on purpose: when the test and the retightening tool
 * each carried their own copy of "count the forked routes" or "parse astro
 * check's summary", the two could disagree, and a baseline retightened by one
 * would fail under the other. Everything below is pure or shells out to one
 * command; the pinning semantics (may only go down, cleared classes stay at
 * zero) live in the tests.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Forked sibling pages
// ---------------------------------------------------------------------------

function walkAstro(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walkAstro(full));
    else if (entry.endsWith('.astro')) out.push(full);
  }
  return out;
}

/**
 * route (relative to the league dir) → one `{ league, lines }` per league that
 * has it. Routes present in only one league are dropped — a page is not a fork.
 */
export function collectSiblings(pagesRoot, leagueDirs) {
  const byRoute = new Map();
  for (const league of leagueDirs) {
    const dir = join(pagesRoot, league);
    let files;
    try {
      files = walkAstro(dir);
    } catch {
      continue; // a registry league with no page directory yet
    }
    for (const file of files) {
      const route = relative(dir, file);
      const lines = readFileSync(file, 'utf8').split('\n').length;
      if (!byRoute.has(route)) byRoute.set(route, []);
      byRoute.get(route).push({ league, lines });
    }
  }
  for (const [route, copies] of byRoute) {
    if (copies.length < 2) byRoute.delete(route);
  }
  return byRoute;
}

/** The subset of siblings where some copy exceeds `maxThinLines`. */
export function forkedRoutes(siblings, maxThinLines) {
  const out = new Map();
  for (const [route, copies] of siblings) {
    if (copies.some((c) => c.lines > maxThinLines)) out.set(route, copies);
  }
  return out;
}

export function describeRoute(route, copies) {
  return `${route} [${copies.map((c) => `${c.league}:${c.lines}`).join(' ')}]`;
}

// ---------------------------------------------------------------------------
// ClientRouter init — bundled scripts that only run on DOMContentLoaded
// ---------------------------------------------------------------------------

function walkClient(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walkClient(full));
    else if (/\.(astro|ts|js|mjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Files whose client code initialises on `DOMContentLoaded` and never on
 * `astro:page-load`.
 *
 * Under the ClientRouter a bundled `<script>` is evaluated ONCE per session
 * and the DOM is swapped underneath it, so an init that only runs on
 * DOMContentLoaded leaves the page inert on every in-site navigation after
 * the first (docs/claude/insights/domains/frontend.md "Astro and
 * ClientRouter"; five pages shipped that bug in one week). `is:inline`
 * scripts are skipped — they run per document. Returns sorted repo-relative
 * paths: one per offending file, whatever the number of script blocks.
 */
export function collectClientRouterOffenders(srcRoot) {
  const offenders = new Set();
  for (const file of walkClient(srcRoot)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('DOMContentLoaded')) continue;
    const rel = relative(join(srcRoot, '..'), file).split('\\').join('/');
    if (file.endsWith('.astro')) {
      if (src.includes('astro:page-load')) continue;
      for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/\bis:inline\b/.test(m[1])) continue;
        if (m[2].includes('DOMContentLoaded')) offenders.add(rel);
      }
    } else if (rel.startsWith('src/scripts/')) {
      if (!src.includes('astro:page-load')) offenders.add(rel);
    }
  }
  return [...offenders].sort();
}

// ---------------------------------------------------------------------------
// astro check
// ---------------------------------------------------------------------------

/** Hard ceiling on one `astro check`. Observed runs are 140-230s. */
export const CHECK_TIMEOUT_MS = 420_000;

/**
 * Run `astro check --minimumSeverity error` and return its full output. The
 * checker exits non-zero whenever errors remain — the normal state here — so
 * the exit code is ignored and the summary line in stdout is what matters.
 */
export function runAstroCheck({ cwd = process.cwd(), timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  try {
    return execFileSync('npx', ['astro', 'check', '--minimumSeverity', 'error'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env: {
        ...process.env,
        // The 12k-line rosters.astro OOMs the checker at the default heap.
        NODE_OPTIONS: process.env.TYPECHECK_NODE_OPTIONS ?? '--max-old-space-size=12288',
      },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
      throw new Error(
        `astro check did not finish within ${timeoutMs / 1000}s and was killed. `
          + 'That is a stall, not a type error — re-run, and raise the timeout if the '
          + 'checker has genuinely got slower.',
      );
    }
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (!out) throw err;
    return out;
  }
}

/** Strip ANSI colour codes so the output can be matched line by line. */
export function decolour(output) {
  return output.replace(/\u001b\[[0-9;]*m/g, '');
}

const DIAGNOSTIC_RE = /^(\S.*?):(\d+):(\d+) - error ts\((\d+)\): (.*)$/;

/** Every `path:line:col - error ts(CODE): message` line as `{ file, code, message }`. */
export function parseDiagnostics(plain) {
  const out = [];
  for (const line of plain.split('\n')) {
    const m = DIAGNOSTIC_RE.exec(line);
    if (m) out.push({ file: m[1], code: Number(m[4]), message: m[5] });
  }
  return out;
}

/** Pull the error total out of astro check's `- N errors` summary line. */
export function parseErrorTotal(output) {
  const plain = decolour(output);
  const match = plain.match(/^-\s*(\d+)\s+errors?$/m);
  if (!match) {
    const outOfMemory = /JavaScript heap out of memory|FATAL ERROR:.*Allocation failed/i.test(plain);
    throw new Error(
      (outOfMemory
        ? 'astro check ran out of memory before printing its summary. Raise the heap via '
          + 'TYPECHECK_NODE_OPTIONS (e.g. --max-old-space-size=12288).\n'
        : "Could not find astro check's error summary in its output.\n")
        + `Last 500 chars:\n${plain.slice(-500)}`,
    );
  }
  return Number(match[1]);
}
