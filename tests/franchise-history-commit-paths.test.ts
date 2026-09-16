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
 *
 * TWO THINGS THIS GUARD MUST NOT DO, because both were true of its first draft
 * and both reproduce the bug it exists to catch:
 *
 *   - **Skip a workflow it cannot parse.** `backfill-historical-feeds.yml`
 *     passes `add-paths: ${{ steps.paths.outputs.add }}`, and bailing out on any
 *     `${{ }}` silently dropped one of the only TWO workflows that run the
 *     script. So an expression is RESOLVED against the `echo "key=…" >>
 *     "$GITHUB_OUTPUT"` lines in the same file, and each branch of that echo is
 *     checked as its own independent path set.
 *   - **Pass when it parsed nothing.** Empty `paths` made every league's
 *     comparison `continue`, so a reformatted `--files` line would have turned
 *     the guard green while it checked nothing. The last test below asserts the
 *     comparison actually ran.
 */

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/compute-franchise-history.mjs';
const WORKFLOW_DIR = '.github/workflows';

/**
 * What the script actually WRITES into `derived/`, found by walking every
 * `fs.writeFileSync(IDENT, …)` back to IDENT's declaration — not by matching one
 * hard-coded spelling of the path. Both current outputs happen to be written as
 * `dataPath, 'derived/x.json'`, but a third added as `path.join(…, 'derived',
 * 'x.json')` would have been invisible to a literal-shaped regex, and a guard
 * that cannot see an output silently blesses a workflow that skips it.
 * A derived write whose path this cannot read is reported, never dropped.
 */
const { outputs: derivedOutputs, unreadable: unreadableOutputs } = (() => {
  const src = readFileSync(path.join(ROOT, SCRIPT), 'utf8');
  const outputs = new Set<string>();
  const unreadable: string[] = [];

  for (const m of src.matchAll(/\bfs\.writeFileSync\(\s*([A-Za-z_$][\w$]*)\s*,/g)) {
    const id = m[1];
    const decl = src.match(new RegExp(`const\\s+${id}\\s*=([^;]*);`));
    if (!decl || !/derived/.test(decl[1])) continue; // not a derived/ output
    const base = decl[1].match(
      /derived\/([A-Za-z0-9._-]+\.json)|['"]derived['"]\s*,\s*['"]([A-Za-z0-9._-]+\.json)['"]/
    );
    if (base) outputs.add(base[1] ?? base[2]);
    else unreadable.push(id);
  }
  return { outputs: [...outputs].sort(), unreadable };
})();

const workflows = readdirSync(path.join(ROOT, WORKFLOW_DIR))
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ file: `${WORKFLOW_DIR}/${f}`, body: readFileSync(path.join(ROOT, WORKFLOW_DIR, f), 'utf8') }))
  .filter((w) => w.body.includes('compute-franchise-history.mjs'));

const unquote = (raw: string) => raw.trim().replace(/^['"](.*)['"]$/s, '$1');

const splitClean = (raw: string, sep: string | RegExp) =>
  unquote(raw)
    .split(sep)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * A path list this guard cannot evaluate. Both shapes below read as a perfectly
 * ordinary path and would otherwise match nothing, which `covers()` reports as
 * "this workflow does not commit these outputs" — the fail-OPEN direction, and
 * the same silent pass that let the original bug sit on main for 11 days.
 */
const opaque = (paths: string[]) => paths.filter((p) => p.includes('$') || p.includes('*'));

type PathSet = { label: string; paths: string[] };

/**
 * Every INDEPENDENT set of paths a workflow can hand to a commit step. Separate
 * sets, not one union: `backfill-historical-feeds.yml` picks a different path
 * list per league, and unioning them would let the AFL branch's `derived/` vouch
 * for TheLeague's outputs. Each branch has to stand on its own.
 *
 * Both repo idioms are read — `--files "a,b,c"` (scripts/commit-feed-and-push.mjs)
 * and `add-paths:` (.github/actions/commit-push) — and an `add-paths:` holding a
 * `steps.*.outputs.KEY` expression resolves to every `echo "KEY=…"` in the file.
 */
function commitPathSets(body: string): { sets: PathSet[]; unresolved: string[] } {
  const sets: PathSet[] = [];
  const unresolved: string[] = [];

  for (const m of body.matchAll(/--files\s+["']([^"']+)["']/g)) {
    const paths = splitClean(m[1], ',');
    const label = `--files "${m[1].slice(0, 40)}…"`;
    // `--files "$FILES"` is a shell variable, not a path — unreadable, not empty.
    if (opaque(paths).length) unresolved.push(label);
    else sets.push({ label, paths });
  }

  // `echo "add=a b c" >> "$GITHUB_OUTPUT"` — one entry per branch that writes the key.
  const echoed = new Map<string, string[][]>();
  for (const m of body.matchAll(/echo\s+"([A-Za-z_][\w-]*)=([^"]*)"\s*>>\s*"?\$GITHUB_OUTPUT"?/g)) {
    const list = echoed.get(m[1]) ?? [];
    list.push(splitClean(m[2], /\s+/));
    echoed.set(m[1], list);
  }

  for (const m of body.matchAll(/^\s*add-paths:\s*(.+?)\s*$/gm)) {
    const raw = m[1];
    const expr = raw.match(/\$\{\{\s*steps\.[\w-]+\.outputs\.([\w-]+)\s*\}\}/);
    if (!expr) {
      const paths = splitClean(raw, /\s+/);
      if (opaque(paths).length) unresolved.push(`add-paths: ${raw}`);
      else sets.push({ label: `add-paths: ${raw}`, paths });
      continue;
    }
    const branches = echoed.get(expr[1]);
    if (!branches?.length) {
      // An expression pointing at something we cannot see is reported, never skipped.
      unresolved.push(raw);
      continue;
    }
    branches.forEach((paths, i) => {
      const label = `add-paths: ${expr[1]} (branch ${i + 1})`;
      if (opaque(paths).length) unresolved.push(label);
      else sets.push({ label, paths });
    });
  }

  return { sets: sets.filter((s) => s.paths.length > 0), unresolved };
}

/** A file is committed if it is named exactly, or sits under a committed directory prefix. */
const covers = (committed: string[], target: string) =>
  committed.some((c) => c === target || target.startsWith(c.replace(/\/?$/, '/')));

/** Every (workflow, path set, league) triple where the set commits ≥1 of that league's outputs. */
const comparisons = workflows.flatMap(({ file, body }) =>
  commitPathSets(body).sets.flatMap((set) =>
    (ALL_LEAGUES as Array<{ dataPath: string }>).flatMap((league) => {
      const targets = derivedOutputs.map((name) => `${league.dataPath}/derived/${name}`);
      const covered = targets.filter((t) => covers(set.paths, t));
      return covered.length === 0 ? [] : [{ file, set, dataPath: league.dataPath, targets, covered }];
    })
  )
);

describe('compute-franchise-history outputs are committed together', () => {
  it('reads more than one derived output out of the script (the whole premise)', () => {
    expect(derivedOutputs).toContain('franchise-history.json');
    expect(derivedOutputs).toContain('season-ledger.json');
  });

  it('can read the path of every derived file the script writes', () => {
    // An output this guard cannot see is an output no workflow can be held to.
    expect(unreadableOutputs).toEqual([]);
  });

  it('finds the workflows that run the recompute', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it.each(workflows)('$file has no unresolvable add-paths expression', ({ body }) => {
    // A path list this guard cannot resolve is a blind spot, not a pass.
    expect(commitPathSets(body).unresolved).toEqual([]);
  });

  it.each(comparisons)(
    '$file — $set.label commits every $dataPath output, not a subset',
    ({ file, set, dataPath, targets, covered }) => {
      expect(
        covered,
        `${file} (${set.label}) commits ${covered.length} of ${targets.length} outputs of ${SCRIPT} ` +
          `for ${dataPath}. The script writes them from ONE parse and tests/season-ledger.test.ts ` +
          `asserts they agree, so committing a subset ships a stale file that preview builds then ` +
          `read. Missing: ${targets.filter((t) => !covers(set.paths, t)).join(', ')}`
      ).toEqual(targets);
    }
  );

  /**
   * The guard's own smoke test. Every check above is "if this set touches the
   * outputs, it must cover them" — all of which pass vacuously if the parsing
   * silently stops matching. Assert it actually had something to compare, and
   * that it reached BOTH workflows rather than quietly dropping one.
   */
  it('actually exercised its comparison, on every workflow that runs the script', () => {
    expect(comparisons.length).toBeGreaterThan(0);
    expect(new Set(comparisons.map((c) => c.file))).toEqual(new Set(workflows.map((w) => w.file)));
  });
});
