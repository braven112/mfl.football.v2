/**
 * Does a workflow step PUSH? One implementation, two guards.
 *
 * Pushing is three mechanisms in this repo, not one — a `git push` in a `run:`
 * step, the shared `./.github/actions/commit-push`, and
 * `scripts/commit-feed-and-push.mjs` (the concurrent-safe helper ten workflows
 * invoke). A detector that knows only the first passes the other two by never
 * looking at them, which is the gap
 * `tests/workflow-push-triggers-ci.test.ts` was originally written to close.
 *
 * It also has to tell CODE from PROSE. `roger-date-audit.yml` names `git push`
 * twice — once in a header comment and once in an `echo` telling a human what
 * to run locally — and pushes nothing. A scanner that fires on either is a
 * scanner that gets muted.
 *
 * This lives in `tests/helpers/` because a SECOND guard now needs the same
 * question answered: `tests/vercel-cron-targets.test.ts` decides whether a
 * Vercel-cron bridge must be cadence-gated by asking whether the workflow it
 * dispatches commits, and its first cut recognised only the two named helpers.
 * Four workflows here push with a bare `git push`, so a bridged workflow
 * written that way would have skipped both the cadence-gate and the
 * `cancel-in-progress: false` assertions silently — a guard passing by not
 * looking, one layer up from the bug it was written to prevent.
 */

export const PUSH_HELPER = 'commit-feed-and-push';
export const COMMIT_PUSH_ACTION = './.github/actions/commit-push';

export type WorkflowStep = { uses?: unknown; run?: unknown; with?: Record<string, unknown> };

/** Strip comments and the text an `echo` prints, keeping the rest of the line. */
export function commandText(run: string): string {
  return run
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    // Remove the echo and its argument up to a command separator, so
    // `echo "run: git push" && git push origin main` keeps the real push and
    // drops the quoted one.
    .map((line) => line.replace(/\becho\b\s+(?:"[^"]*"|'[^']*'|[^;&|\n]*)/g, ''))
    .join('\n');
}

/** True when this step pushes commits, by any of the three mechanisms. */
export function stepPushes(step: WorkflowStep): boolean {
  const uses = typeof step?.uses === 'string' ? step.uses.trim() : '';
  if (uses === COMMIT_PUSH_ACTION) return true;
  const run = typeof step?.run === 'string' ? step.run : '';
  if (!run) return false;
  const cmd = commandText(run);
  if (cmd.includes(PUSH_HELPER)) return true;
  return /(^|[;&|(]|\s)git\s+(?:-C\s+\S+\s+)?push\b/.test(cmd);
}

/**
 * True when any step of any job in this parsed workflow pushes.
 *
 * Takes the PARSED document rather than raw text on purpose: `run:` blocks are
 * where the prose lives, and asking the question of a text blob is how a
 * header comment becomes a finding.
 */
export function workflowPushes(doc: unknown): boolean {
  const jobs = (doc as { jobs?: Record<string, { steps?: WorkflowStep[] }> })?.jobs ?? {};
  return Object.values(jobs).some((def) => {
    const steps = Array.isArray(def?.steps) ? def.steps : [];
    return steps.some(stepPushes);
  });
}
