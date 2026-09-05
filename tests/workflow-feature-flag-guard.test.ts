import { describe, it, expect } from 'vitest';
import { expectClean, scanForbidden, walkFiles } from './helpers/scan-guard';
import { readFileSync } from 'node:fs';

/**
 * Workflow feature-flag guard.
 *
 * CLAUDE.md "Feature flags — code, not GitHub Actions variables": a `vars.*`
 * reference in a workflow as a feature gate splits the source of truth across
 * the repo and a GitHub settings page, and editing a GitHub variable is never
 * easier than editing code here. To disable a scheduled job, comment out its
 * `cron:`; to gate behavior, use a `const` in the script.
 *
 * Two kinds of `vars.*` are legitimate and stay out of this guard:
 *   - per-league CONFIG overrides (`MFL_LEAGUE_ID`, `MFL_HOST`) — they select
 *     a target, they do not switch a feature on or off;
 *   - the three LEGACY Schefter gates that predate the rule, pinned to the two
 *     files that already carry them so they cannot spread.
 *
 * Written with `/guard-test` as the first output of tests/helpers/scan-guard.ts.
 */

const ROOTS = ['.github/workflows'];
const EXTS = ['.yml', '.yaml'];

/** Not gates: they choose WHICH league a job runs against. */
const CONFIG_VARS = new Set(['MFL_LEAGUE_ID', 'MFL_HOST']);

/** Gates that predate the rule. Do not add to this list — move the gate into code instead. */
const LEGACY_GATES: Record<string, string[]> = {
  SCHEFTER_RUMOR_MILL_ENABLED: ['.github/workflows/schefter-scan.yml', '.github/workflows/schefter-rumor-scan.yml'],
  SCHEFTER_TRADE_OFFER_RUMORS_ENABLED: ['.github/workflows/schefter-rumor-scan.yml'],
  SCHEFTER_TRADE_OFFER_RUMORS_DETECTION_ONLY: ['.github/workflows/schefter-rumor-scan.yml'],
};

const VAR_REF = /\bvars\.([A-Za-z_][A-Za-z0-9_]*)/g;

describe('workflow feature-flag guard', () => {
  it('no workflow reads a vars.* feature gate (config overrides and pinned legacy gates excepted)', () => {
    const result = scanForbidden({
      roots: ROOTS,
      extensions: EXTS,
      forbidden: [{ name: 'vars.* feature gate', pattern: VAR_REF }],
      exempt: ({ file, match }) => {
        const name = match.replace(/^vars\./, '');
        if (CONFIG_VARS.has(name)) return true;
        return (LEGACY_GATES[name] ?? []).includes(file);
      },
    });
    expectClean(
      result,
      'Feature gates live in code, not GitHub Actions variables (CLAUDE.md "Feature flags — code, not GitHub Actions variables"). ' +
        'Comment out the cron: line to disable a job, or use a const in the script.',
    );
  });

  it('every pinned legacy gate is still referenced from every file it is pinned to (drop the pin when one is moved into code)', () => {
    const stale: string[] = [];
    for (const [name, files] of Object.entries(LEGACY_GATES)) {
      for (const file of files) {
        if (!readFileSync(file, 'utf8').includes(`vars.${name}`)) stale.push(`${name} in ${file}`);
      }
    }
    expect(stale, `stale LEGACY_GATES pins:\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('scans the workflow directory it claims to', () => {
    // A known file, not a count: consolidating workflows must not fail this.
    expect(walkFiles({ roots: ROOTS, extensions: EXTS })).toContain('.github/workflows/ci.yml');
  });
});
