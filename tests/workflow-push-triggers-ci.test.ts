/**
 * A JOB that pushes must check out with the deploy key.
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
 *   1. `staging` serves real owners at staging.theleague.us and writes to
 *      production's database, and it had been serving code no test had run
 *      against.
 *   2. `/promote` step 4 treats "no check runs for this SHA" as blocking — the
 *      right call — and the tip is a merge-down commit on almost every release.
 *      So the release gate would have refused nearly every promotion, for a
 *      reason indistinguishable from a broken check.
 *
 * THE RULE
 * --------
 * If a job pushes commits or tags, ITS checkout must carry
 * `ssh-key: ${{ secrets.DEPLOY_KEY }}`. Not about permission — the default
 * token can push fine — but about whether anything downstream notices.
 * Recorded in docs/claude/rules/storage-and-build.md.
 *
 * WHY THIS PARSES YAML PER JOB RATHER THAN GREPPING THE FILE
 * ---------------------------------------------------------
 * Three ways a text scan gets this wrong, all of them real here:
 *
 *   - A file can hold TWO checkouts (`mfl-integration-test.yml` does). Matching
 *     the whole body passes when the key sits on an unrelated checkout while
 *     the job that actually pushes still uses the default token.
 *   - `git push` appears in workflows that never run it —
 *     `roger-date-audit.yml` names it in a header comment and in an `echo`
 *     telling a human what to run locally. A guard that fails on prose earns an
 *     allowlist and then stops meaning anything.
 *   - Dropping every line containing `echo` to dodge that would discard a real
 *     `echo starting && git push origin main`.
 *
 * So: parse the document, take each job's own steps, and ask whether THAT job
 * pushes and whether THAT job's checkout carries the key.
 *
 * PUSHING IS THREE MECHANISMS, NOT ONE
 * ------------------------------------
 * `git push` in a run step, the shared `actions/commit-push`, and
 * `scripts/commit-feed-and-push.mjs` — a concurrent-safe commit+push helper
 * that ten workflows invoke. Missing the helper is not theoretical: those ten
 * were absent from the scan entirely, so they passed by never being looked at,
 * and dropping the key from any of them would have gone unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { walkFiles, REPO_ROOT } from './helpers/scan-guard';
// One implementation of "does this step push?", shared with
// tests/vercel-cron-targets.test.ts — see that helper's header for why a second
// copy was the wrong answer. The self-tests below still exercise it here.
import {
  stepPushes,
  commandText,
  PUSH_HELPER,
  COMMIT_PUSH_ACTION,
  type WorkflowStep as Step,
} from './helpers/workflow-push';

const WORKFLOWS = path.join(REPO_ROOT, '.github/workflows');

// `.yml` only, matching both this repo's actual convention (every workflow is
// .yml) and the path-guard glob that runs this suite. Discovering an extension
// the hook does not route would mean CI catches a pusher that the edit-time
// guard silently skips.
const EXTS = ['.yml'];

// Matched against the VALUE of `with.ssh-key` once YAML has parsed it, which
// is the expression alone — the key name is not part of it. Getting that wrong
// is why the first run of this suite flagged all 24 pushers as missing a key
// they plainly had.
const DEPLOY_KEY_VALUE = /\$\{\{\s*secrets\.DEPLOY_KEY\s*\}\}/;
// The same expression as it appears in raw workflow TEXT, for the file-level
// assertions further down.
const DEPLOY_KEY_TEXT = /ssh-key:\s*\$\{\{\s*secrets\.DEPLOY_KEY\s*\}\}/;
type PushingJob = { file: string; job: string; hasKey: boolean };

function stepIsCheckoutWithKey(step: Step): boolean {
  const uses = typeof step?.uses === 'string' ? step.uses : '';
  if (!uses.startsWith('actions/checkout')) return false;
  const raw = step?.with?.['ssh-key'];
  return typeof raw === 'string' && DEPLOY_KEY_VALUE.test(raw);
}

function pushingJobs(): PushingJob[] {
  return walkFiles({ roots: [WORKFLOWS], extensions: EXTS }).flatMap((file) => {
    let doc: { jobs?: Record<string, { steps?: Step[] }> };
    try {
      doc = parseYaml(readFileSync(file, 'utf-8'));
    } catch {
      // Unparseable workflows are already the business of
      // tests/workflow-install-guard.test.ts, which fails on them by name.
      return [];
    }
    return Object.entries(doc?.jobs ?? {}).flatMap(([job, def]) => {
      const steps = Array.isArray(def?.steps) ? def.steps : [];
      if (!steps.some(stepPushes)) return [];
      return [
        {
          file: path.relative(REPO_ROOT, file),
          job,
          hasKey: steps.some(stepIsCheckoutWithKey),
        },
      ];
    });
  });
}

describe('a job that pushes must check out with the deploy key', () => {
  const jobs = pushingJobs();

  it('finds pushing jobs at all (a zero here would pass vacuously)', () => {
    // The whole suite is only worth anything if the scan actually resolves
    // jobs. This repo has well over a dozen pushers.
    expect(jobs.length).toBeGreaterThan(10);
  });

  it('sees all three push mechanisms, not just the obvious one', () => {
    // Pinned because the helper was the one this guard originally missed, and
    // a refactor that quietly drops a mechanism would otherwise look green.
    const files = new Set(jobs.map((j) => j.file));
    expect(files).toContain('.github/workflows/staging-merge-down.yml'); // git push
    expect(files).toContain('.github/workflows/weekly-changelog-rollup.yml'); // commit-push action
    expect(files).toContain('.github/workflows/schefter-announce.yml'); // commit-feed-and-push.mjs
  });

  it('every pushing job carries the key on its own checkout', () => {
    const missing = jobs.filter((j) => !j.hasKey).map((j) => `${j.file} (job: ${j.job})`);
    expect(
      missing,
      `these jobs push but check out without the deploy key, so they push with the default ` +
        `GITHUB_TOKEN — and GitHub starts NO workflow from such a push. Whatever is meant to ` +
        `run on that branch (CI, a downstream job) silently will not. Add ` +
        `"ssh-key: \${{ secrets.DEPLOY_KEY }}" to the checkout in that job.`,
    ).toEqual([]);
  });
});

describe('the detector itself', () => {
  it('does not mistake prose for a push', () => {
    // roger-date-audit.yml names `git push` twice — a header comment and an
    // echo telling a human what to run locally — and pushes nothing.
    const files = new Set(pushingJobs().map((j) => j.file));
    expect(files).not.toContain('.github/workflows/roger-date-audit.yml');
  });

  it('still sees a real push that shares a line with an echo', () => {
    expect(stepPushes({ run: 'echo "then run: git push" && git push origin main' })).toBe(true);
    expect(stepPushes({ run: 'echo "then run: git push"' })).toBe(false);
    expect(stepPushes({ run: '# git push origin main' })).toBe(false);
  });

  it('matches a push per job rather than per file', () => {
    // mfl-integration-test.yml has two checkouts. A file-level match would let
    // a key on the non-pushing one vouch for the pushing one.
    const body = readFileSync(path.join(WORKFLOWS, 'mfl-integration-test.yml'), 'utf-8');
    expect((body.match(/uses: actions\/checkout/g) ?? []).length).toBeGreaterThan(1);
    const jobs = pushingJobs().filter((j) => j.file.endsWith('mfl-integration-test.yml'));
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) expect(j.hasKey).toBe(true);
  });
});

describe('staging-merge-down specifically', () => {
  // Called out on its own because this is the one whose breakage reached
  // owners: it moves the branch the staging hosts serve, and /promote step 4
  // reads that branch's tip.
  const body = readFileSync(path.join(WORKFLOWS, 'staging-merge-down.yml'), 'utf-8');

  it('pushes with the deploy key so ci.yml actually fires on staging', () => {
    expect(DEPLOY_KEY_TEXT.test(body)).toBe(true);
  });

  it('still fetches full history, which the merge base needs', () => {
    // The key goes next to fetch-depth; dropping the latter while adding the
    // former trades a silent no-CI bug for a silent no-merge-base one.
    expect(body).toMatch(/fetch-depth:\s*0/);
  });

  it('ci.yml really does want to run on staging pushes', () => {
    // If this stopped being true, the key would be pointless here and this
    // guard would enforce a rule with no consequence — re-read it rather than
    // keep it.
    const ci = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf-8');
    expect(ci).toMatch(/push:\s*\n\s*branches:\s*\[staging\]/);
  });
});
