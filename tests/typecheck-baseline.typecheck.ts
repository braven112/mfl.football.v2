import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

interface Baseline {
  total: number;
  recordedAt: string;
}

function runAstroCheck(): string {
  try {
    return execFileSync('npx', ['astro', 'check', '--minimumSeverity', 'error'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // The 12k-line rosters.astro OOMs the checker at the default heap.
      // Overridable so a smaller CI runner can cap it below the local default.
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.TYPECHECK_NODE_OPTIONS ?? '--max-old-space-size=12288',
      },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // `astro check` exits non-zero whenever errors remain, which is the normal
    // state here — the count in stdout is what matters, not the exit code.
    const e = err as { stdout?: string; stderr?: string };
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    if (!out) throw err;
    return out;
  }
}

/** Pull the error total out of astro check's `- N errors` summary line. */
function parseErrorTotal(output: string): number {
  // Strip ANSI colour codes before matching.
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  const match = plain.match(/^-\s*(\d+)\s+errors?$/m);
  if (!match) {
    // The commonest cause is the checker running out of heap on rosters.astro,
    // which aborts before printing the summary. Say so, rather than reporting
    // it as an unparseable-output mystery.
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

describe('type-error baseline', () => {
  it('never rises above the recorded baseline', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
    const actual = parseErrorTotal(runAstroCheck());

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
});
