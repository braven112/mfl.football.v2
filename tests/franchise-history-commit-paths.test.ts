import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * compute-franchise-history.mjs writes TWO derived files from ONE parse —
 * franchise-history.json and season-ledger.json. tests/season-ledger.test.ts
 * proves they agree field-for-field, and its header explains why they are
 * emitted together: "Deriving it in a second script would duplicate that
 * parsing and guarantee future drift."
 *
 * That invariant holds in the SCRIPT and was broken by a WORKFLOW. The daily
 * Schefter cron ran the recompute and then committed only franchise-history.json
 * — so the ledger on main stayed frozen at whatever the last human PR had
 * regenerated. It drifted 11 days; every 2026 ledger row still read 0-0-0 /
 * regSeasonRank null while the history file beside it carried live records, and
 * season-ledger.test.ts failed on main for anyone who ran the full suite.
 *
 * It was a data bug, not just a red test: preview builds and `pnpm dev` read the
 * COMMITTED ledger rather than recomputing it (compute:franchise-history is
 * previewSkip in scripts/prebuild.mjs), and compute-division-strength.mjs and
 * compute-owner-tenures.mjs both read that file — so both were built from the
 * stale copy.
 *
 * The guard: any workflow that runs the script and commits ONE of its derived
 * outputs must commit ALL of them. The output set is read out of the script
 * itself, so adding a third output makes this fail until it is committed too.
 */

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/compute-franchise-history.mjs';
const WORKFLOW_DIR = '.github/workflows';

/** Output basenames, derived from the script's own `dataPath, 'derived/...'` literals. */
const derivedOutputs = (() => {
  const src = readFileSync(path.join(ROOT, SCRIPT), 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/dataPath,\s*'derived\/([A-Za-z0-9._-]+\.json)'/g)) found.add(m[1]);
  return [...found].sort();
})();

const workflows = readdirSync(path.join(ROOT, WORKFLOW_DIR))
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ file: `${WORKFLOW_DIR}/${f}`, body: readFileSync(path.join(ROOT, WORKFLOW_DIR, f), 'utf8') }))
  .filter((w) => w.body.includes('compute-franchise-history.mjs'));

/**
 * Every path a workflow hands to a commit step, from either idiom in this repo:
 * `--files "a,b,c"` (scripts/commit-feed-and-push.mjs) and `add-paths:`
 * (.github/actions/commit-push). A `${{ }}` expression is unreadable from here
 * and is treated as covering everything — the workflows that use one commit a
 * whole `derived/` directory anyway.
 */
function committedPaths(body: string): { paths: string[]; dynamic: boolean } {
  const paths: string[] = [];
  let dynamic = false;
  for (const m of body.matchAll(/--files\s+"([^"]+)"/g)) paths.push(...m[1].split(','));
  for (const m of body.matchAll(/add-paths:\s*(.+)/g)) {
    if (m[1].includes('${{')) dynamic = true;
    else paths.push(...m[1].trim().split(/\s+/));
  }
  return { paths: paths.map((p) => p.trim()).filter(Boolean), dynamic };
}

/** A file is committed if it is named exactly, or sits under a committed directory prefix. */
const covers = (committed: string[], target: string) =>
  committed.some((c) => c === target || target.startsWith(c.replace(/\/?$/, '/')));

describe('compute-franchise-history outputs are committed together', () => {
  it('reads more than one derived output out of the script (the whole premise)', () => {
    expect(derivedOutputs).toContain('franchise-history.json');
    expect(derivedOutputs).toContain('season-ledger.json');
  });

  it('finds the workflows that run the recompute', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it.each(workflows)('$file commits every derived output, or none of them', ({ file, body }) => {
    const { paths, dynamic } = committedPaths(body);
    if (dynamic) return; // expression-valued add-paths — see committedPaths

    for (const league of ALL_LEAGUES as Array<{ dataPath: string }>) {
      const targets = derivedOutputs.map((name) => `${league.dataPath}/derived/${name}`);
      const covered = targets.filter((t) => covers(paths, t));
      if (covered.length === 0) continue; // this workflow does not commit this league's outputs

      expect(
        covered,
        `${file} commits ${covered.length} of ${targets.length} outputs of ${SCRIPT} for ${league.dataPath}. ` +
          `The script writes them from ONE parse and tests/season-ledger.test.ts asserts they agree, so ` +
          `committing a subset ships a stale file that preview builds then read. Missing: ` +
          `${targets.filter((t) => !covers(paths, t)).join(', ')}`,
      ).toEqual(targets);
    }
  });
});
