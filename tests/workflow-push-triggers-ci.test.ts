/**
 * A workflow that PUSHES to a branch must push with the deploy key.
 *
 * THE BUG THIS EXISTS TO STOP
 * ---------------------------
 * GitHub will not start a workflow from a push made with the default
 * `GITHUB_TOKEN`. That is deliberate loop-prevention on their side, and it is
 * silent: the push succeeds, the branch moves, and nothing runs.
 *
 * `staging-merge-down.yml` checked out without `ssh-key`, so every commit it
 * put on `staging` arrived under that token. `ci.yml` declares
 * `push: branches: [staging]` and still never fired. Measured on 2026-09-16:
 * zero workflow runs on staging's tip, and zero on the three merge-down commits
 * before it.
 *
 * Two things broke because of it, and neither announced itself:
 *
 *   1. `staging` serves real owners at staging.theleague.us, and it had been
 *      serving code no test had run against.
 *   2. `/promote` step 4 treats "no check runs for this SHA" as blocking — the
 *      right call — and the tip is a merge-down commit on almost every release.
 *      So the release gate would have refused nearly every promotion, for a
 *      reason indistinguishable from a broken check.
 *
 * THE RULE
 * --------
 * If a workflow pushes commits or tags to the repo, its checkout must carry
 * `ssh-key: ${{ secrets.DEPLOY_KEY }}`. That is not about permission — the
 * default token can push fine — it is about whether anything downstream
 * notices.
 *
 * Checked by reading the workflow rather than by trusting a comment: the
 * failure mode is invisible at runtime, so a green pipeline proves nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOW_DIR = resolve(__dirname, '../.github/workflows');

/**
 * Does this workflow actually push?
 *
 * Derived rather than listed, so a new pusher cannot join the repo unnoticed —
 * but derived CAREFULLY, because `git push` appears in workflows that never
 * run it. `roger-date-audit.yml` names it twice, once in a header comment and
 * once in an `echo` telling a human what to run locally after a failure; it
 * pushes nothing. A guard that fails on prose trains people to add exemptions,
 * which is how it stops meaning anything.
 *
 * So: comment lines and `echo` lines are stripped before looking, and the
 * shared commit-push action counts as a push wherever it appears.
 */
function pushes(body: string): boolean {
  if (/uses:\s*\.\/\.github\/actions\/commit-push/.test(body)) return true;
  return body
    .split('\n')
    .filter((line) => !/^\s*#/.test(line) && !/\becho\b/.test(line))
    .some((line) => /(^|[;&|]|\s)git\s+push\b/.test(line));
}

function pushingWorkflows(): { file: string; body: string }[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ file: f, body: readFileSync(resolve(WORKFLOW_DIR, f), 'utf-8') }))
    .filter(({ body }) => pushes(body));
}

describe('a workflow that pushes must push with the deploy key', () => {
  it('finds the pushing workflows at all (a zero here would pass vacuously)', () => {
    expect(pushingWorkflows().length).toBeGreaterThan(0);
  });

  it.each(pushingWorkflows().map((w) => w.file))(
    '%s checks out with ssh-key: secrets.DEPLOY_KEY',
    (file) => {
      const body = readFileSync(resolve(WORKFLOW_DIR, file), 'utf-8');
      expect(
        body,
        `${file} pushes to the repo but checks out without the deploy key, so it will push ` +
          `with the default GITHUB_TOKEN — and GitHub starts NO workflow from such a push. ` +
          `Whatever is meant to run on that branch (CI, a downstream job) will silently not ` +
          `run. Add "ssh-key: \${{ secrets.DEPLOY_KEY }}" to its checkout.`,
      ).toMatch(/ssh-key:\s*\$\{\{\s*secrets\.DEPLOY_KEY\s*\}\}/);
    },
  );
});

describe('staging-merge-down specifically', () => {
  // Called out on its own because this is the one whose breakage reached
  // owners: it is the only workflow that moves the branch the staging hosts
  // serve, and /promote's step 4 reads that branch's tip.
  const body = readFileSync(resolve(WORKFLOW_DIR, 'staging-merge-down.yml'), 'utf-8');

  it('pushes with the deploy key so ci.yml actually fires on staging', () => {
    expect(body).toMatch(/ssh-key:\s*\$\{\{\s*secrets\.DEPLOY_KEY\s*\}\}/);
  });

  it('still fetches full history, which the merge base needs', () => {
    // The deploy key goes next to fetch-depth, and dropping the latter while
    // adding the former would trade a silent no-CI bug for a silent no-merge
    // one.
    expect(body).toMatch(/fetch-depth:\s*0/);
  });

  it('ci.yml really does want to run on staging pushes', () => {
    // If this ever stopped being true the deploy key would be pointless here,
    // and the guard above would be enforcing a rule with no consequence.
    const ci = readFileSync(resolve(WORKFLOW_DIR, 'ci.yml'), 'utf-8');
    expect(ci).toMatch(/push:\s*\n\s*branches:\s*\[staging\]/);
  });
});
