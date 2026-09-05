import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHECK_TIMEOUT_MS,
  decolour,
  parseDiagnostics,
  parseErrorTotal,
  runAstroCheck,
} from '../scripts/lib/ratchet-measures.mjs';

/**
 * Type-error ratchet.
 *
 * Nothing in CI gated type errors before this, which is how the repo
 * accumulated ~2.1k of them. This suite pins the count so it can only go
 * DOWN: a rise fails as a regression, and a drop fails too, so whoever
 * improved it retightens the baseline instead of leaving slack for the next
 * regression to hide in.
 *
 * `astro check` takes ~2.5 minutes and needs a large heap, so this file is
 * excluded from the default `pnpm test:unit` run (see vitest.config.ts) and
 * runs via `pnpm test:types` — the same split the MFL write-integration
 * suite uses.
 */

const BASELINE_PATH = fileURLToPath(new URL('./fixtures/typecheck-baseline.json', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Measurement (running the checker, parsing its output) is shared with
// scripts/ratchet.mjs so a baseline retightened by the tool is the number this
// test will measure. The pinning semantics stay here.
interface Baseline {
  total: number;
  recordedAt: string;
  /** Per-class ceilings for classes deliberately driven to zero. */
  clearedClasses?: Record<string, number>;
}

interface Diagnostic {
  file: string;
  code: number;
  message: string;
}

/**
 * Error classes driven to zero that must stay there.
 *
 * The total alone does not protect them: an improvement anywhere can mask a
 * regression here and still leave the total lower, which the ratchet would
 * read as progress. Each entry below is a class cleared deliberately.
 */
const CLEARED_CLASSES: Array<{
  key: string;
  fix: string;
  match: (d: Diagnostic) => boolean;
}> = [
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

describe('type-error baseline', () => {
  // One `astro check` run feeds both assertions below. It runs in beforeAll
  // rather than in the describe body because code at describe() evaluation is
  // collection-time: neither testTimeout nor hookTimeout applies there, so a
  // stalled checker would hang the run with no timeout to stop it.
  let output: string;
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;

  beforeAll(() => {
    output = runAstroCheck({ cwd: REPO_ROOT });
  }, CHECK_TIMEOUT_MS + 60_000);

  it('never rises above the recorded baseline', () => {
    const actual = parseErrorTotal(output);

    if (actual > baseline.total) {
      throw new Error(
        `Type errors rose from ${baseline.total} to ${actual} (+${actual - baseline.total}).\n`
          + 'Fix the new errors rather than raising the baseline. To see them:\n'
          + '  NODE_OPTIONS=--max-old-space-size=12288 npx astro check --minimumSeverity error',
      );
    }

    if (actual < baseline.total) {
      throw new Error(
        `Type errors dropped from ${baseline.total} to ${actual} (-${baseline.total - actual}). Nice.\n`
          + `Retighten the ratchet: set "total" to ${actual} in tests/fixtures/typecheck-baseline.json.`,
      );
    }

    expect(actual).toBe(baseline.total);
  }, 300_000);

  it('keeps every cleared error class at zero', () => {
    const diagnostics = parseDiagnostics(decolour(output));
    expect(diagnostics.length).toBeGreaterThan(0); // guard against a parser that matches nothing

    const regressions = CLEARED_CLASSES
      .map((c) => ({ ...c, hits: diagnostics.filter(c.match) }))
      .filter((c) => c.hits.length > (baseline.clearedClasses?.[c.key] ?? 0));

    if (regressions.length > 0) {
      throw new Error(
        'Error classes that were cleared to zero have come back:\n'
          + regressions
            .map((r) => {
              const where = r.hits
                .slice(0, 5)
                .map((h) => `      ${h.file}: ${h.message}`)
                .join('\n');
              const more = r.hits.length > 5 ? `\n      …and ${r.hits.length - 5} more` : '';
              return `  ${r.key}: ${r.hits.length}\n    ${r.fix}\n${where}${more}`;
            })
            .join('\n'),
      );
    }
  }, 10_000);
});
