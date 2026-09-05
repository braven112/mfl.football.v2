import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHECK_TIMEOUT_MS,
  clearedClassRegressions,
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

    // Same classifier scripts/ratchet.mjs uses, so --write can never retighten a tree this rejects.
    const regressions = clearedClassRegressions(diagnostics, baseline.clearedClasses);

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
