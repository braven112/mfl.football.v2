/**
 * The ratchet measurements, shared by the tests that enforce them and by
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
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { walkFiles } from './walk.mjs';

// ---------------------------------------------------------------------------
// Forked sibling pages
// ---------------------------------------------------------------------------

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
      files = walkFiles(dir, { extensions: ['.astro'] });
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

/**
 * Sibling routes whose LARGEST copy sits inside the baseline's empty band —
 * above the biggest known thin route and below the smallest known fork. The
 * 80-line threshold is only defensible while nothing lands there, so a route
 * that does is a judgment call to re-argue in review, not a count to
 * retighten. Shared with the test so the script cannot say "at baseline"
 * while the test fails.
 */
export function inBandRoutes(siblings, { largestThinRoute, smallestForkedRoute }) {
  const out = [];
  for (const [route, copies] of siblings) {
    const largest = Math.max(...copies.map((c) => c.lines));
    if (largest > largestThinRoute && largest < smallestForkedRoute) out.push(`${route} (largest copy: ${largest} lines)`);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// ClientRouter init — bundled scripts that only run on DOMContentLoaded
// ---------------------------------------------------------------------------

/**
 * Files whose client code initialises on `DOMContentLoaded` and never on
 * `astro:page-load`.
 *
 * Under the ClientRouter a bundled `<script>` is evaluated ONCE per session
 * and the DOM is swapped underneath it, so an init that only runs on
 * DOMContentLoaded leaves the page inert on every in-site navigation after
 * the first (docs/claude/insights/domains/frontend.md "Astro and
 * ClientRouter"; five pages shipped that bug in one week). `is:inline`
 * scripts are skipped — they run per document. Judged per script block in
 * .astro files and per module elsewhere under src/. Returns sorted
 * repo-relative paths, one per offending file.
 */
export function collectClientRouterOffenders(srcRoot) {
  const offenders = new Set();
  const files = walkFiles(srcRoot, { extensions: ['.astro', '.ts', '.tsx', '.js', '.jsx', '.mjs'] }).filter((f) => !f.endsWith('.d.ts'));
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('DOMContentLoaded')) continue;
    const rel = relative(join(srcRoot, '..'), file).split('\\').join('/');
    if (file.endsWith('.astro')) {
      // Judged per <script> BLOCK: a file whose first block re-inits on
      // astro:page-load can still carry a second block that only ever ran on
      // DOMContentLoaded, and that block is just as dead after a swap.
      for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
        if (/\bis:inline\b/.test(m[1])) continue;
        if (m[2].includes('DOMContentLoaded') && !m[2].includes('astro:page-load')) offenders.add(rel);
      }
    } else if (!src.includes('astro:page-load')) {
      // Any module under src/ can be imported by a page <script> and run once
      // per session; server-only utils never mention DOMContentLoaded, so the
      // string test above is the filter.
      offenders.add(rel);
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

/**
 * Error classes driven to zero that must stay there. The total alone does
 * not protect them: an improvement anywhere can mask a regression here and
 * still leave the total lower, which a ratchet reads as progress. Shared by
 * the test and scripts/ratchet.mjs so neither can retighten a tree the other
 * rejects.
 */
export const CLEARED_CLASSES = [
  {
    key: 'domElementCluster',
    fix: "`Property 'x' does not exist on type 'Element'` — type the query, e.g. querySelectorAll<HTMLElement>(...)",
    match: (d) => /does not exist on type 'Element'/.test(d.message),
  },
  {
    key: 'tsExtensionImports',
    fix: 'ts(5097) — an import path ending in .ts/.tsx',
    match: (d) => d.code === 5097,
  },
  {
    key: 'importNameCollisions',
    fix: "ts(2440) — an import colliding with the .astro file's own name; alias it as <Name>Island",
    match: (d) => d.code === 2440,
  },
  {
    key: 'staleOptionShapes',
    fix: "ts(2353) — a call passing a property the declared type omits. Usually the "
      + 'declaration has drifted from what the function really accepts, so widen it '
      + 'rather than deleting the argument — unless the option is genuinely dead.',
    match: (d) => d.code === 2353,
  },
  {
    key: 'nullSafetyOutsideRosters',
    fix: 'possibly-null/undefined in src/ outside rosters.astro — fix at the guard by re-binding to a non-null const',
    match: (d) =>
      [18046, 18047, 18048, 2531, 2532].includes(d.code)
      && d.file.startsWith('src/')
      && !d.file.includes('pages/theleague/rosters.astro'),
  },
];

/** Cleared classes that have come back above their baseline ceiling (default 0), with their hits. */
export function clearedClassRegressions(diagnostics, baselineCleared = {}) {
  return CLEARED_CLASSES
    .map((c) => ({ ...c, hits: diagnostics.filter(c.match) }))
    .filter((c) => c.hits.length > (baselineCleared?.[c.key] ?? 0));
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
