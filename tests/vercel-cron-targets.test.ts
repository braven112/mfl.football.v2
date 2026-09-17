/**
 * The Vercel cron table and the routes it fires must agree — in BOTH directions.
 *
 * ## The bug this exists for
 *
 * `src/pages/api/cron/roster-sync.ts` is a bridge: Vercel cron → GitHub
 * `workflow_dispatch` → the Roster Sync workflow, which fetches MFL and commits
 * to main. It was added on 2026-03-21 with a matching `crons` entry in
 * vercel.json, and the entry was removed ELEVEN HOURS LATER ("unreliable on
 * Hobby plan", 4179e14) while the route was left behind.
 *
 * Nothing failed. The route answered 401 to the world and nobody called it, so
 * for six months it read like working infrastructure and was in fact dead code
 * — `api/cron/push-fanout.ts` and `api/admin/schefter-announce.ts` both cite it
 * in their own comments as the bridge shape to copy.
 *
 * The cost landed on 2026-09-16: GitHub's `schedule` delivery for this repo had
 * collapsed to a 2-5 hour median (see the comment in roster-sync.yml), so the
 * site sat a full hour past the Wed 19:00 PT waiver run still serving
 * pre-waiver rosters. The one mechanism built to make the cadence reliable was
 * sitting right there, unwired, and no test could tell.
 *
 * The workflow's own `schedule:` is gone now, so this cron is the only thing
 * that makes the sync run at all — which is why the checks below are two-way
 * and why the tick has to stay in step with `src/utils/sync-cadence.ts`.
 *
 * ## Why both directions
 *
 * An ORPHANED ROUTE is silent, as above — dead code wearing the costume of a
 * live path. A DANGLING CRON is worse and just as quiet: Vercel logs a 404 on a
 * schedule nobody reads, so the sync stops and the only symptom is a site that
 * gradually goes stale, which is indistinguishable from the GitHub throttling
 * this was meant to route around.
 *
 * And an UNGATED target is the security half. These routes start workflows that
 * commit to main with Actions secrets; the CRON_SECRET bearer check is the only
 * thing between that and anyone who can guess a URL, because a Vercel cron path
 * is a perfectly ordinary public route.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { TICK_MINUTES, TIER_INTERVAL_MINUTES } from '../src/utils/sync-cadence';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

interface VercelCron {
  path: string;
  schedule: string;
}

const vercelConfig = JSON.parse(read('vercel.json')) as { crons?: VercelCron[] };
const crons = vercelConfig.crons ?? [];

/**
 * Routes that are cron BRIDGES — they exist to be fired on a schedule, so an
 * entry here with no cron pointing at it is the orphan above.
 *
 * `api/cron/push-fanout.ts` is deliberately NOT in this list: it shares the
 * directory and the CRON_SECRET gate, but it is a POST transport called by the
 * Actions scripts themselves (scripts/lib/push-fanout.mjs), never scheduled.
 */
const SCHEDULED_BRIDGES = [
  'src/pages/api/cron/roster-sync.ts',
  'src/pages/api/cron/schefter-scan.ts',
  'src/pages/api/cron/groupme-sync.ts',
];

/**
 * Strip comments before scanning for CODE shapes.
 *
 * Without this the guard reads prose as an offence: the fix for the very bug
 * this pins carries a comment QUOTING the broken form to explain why it is
 * broken, and the scan flagged it. Same trap
 * `tests/workflow-push-triggers-ci.test.ts` documents for `git push` in a
 * header comment — a scanner that cannot tell code from commentary fails the
 * file that is doing it right.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The minutes of the hour a 5-field cron's MINUTE field fires on.
 *
 * Handles the three forms in play here — a step, a comma list, and a bare
 * minute. The list form matters because a schedule that is not a plain step is
 * exactly what a checker written for steps alone skips silently, enforcing
 * nothing; the removed `7,37` fallback was that shape.
 */
function minuteSet(expr: string): Set<number> {
  const minute = expr.trim().split(/\s+/)[0];
  const out = new Set<number>();
  for (const part of minute.split(',')) {
    const step = /^\*\/(\d+)$/.exec(part);
    if (step) {
      for (let m = 0; m < 60; m += Number(step[1])) out.add(m);
    } else if (part === '*') {
      for (let m = 0; m < 60; m += 1) out.add(m);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part));
    }
  }
  return out;
}

/** `/api/cron/roster-sync` → `src/pages/api/cron/roster-sync.ts` */
function routeFileFor(cronPath: string): string {
  const clean = cronPath.split('?')[0].replace(/^\/+|\/+$/g, '');
  return `src/pages/${clean}.ts`;
}

describe('vercel.json crons ↔ API routes', () => {
  it('declares at least one cron (the roster sync is not optional)', () => {
    expect(
      crons.length,
      'vercel.json has no `crons`. This is the roster sync\'s ONLY scheduled ' +
        'trigger — the workflow has no `schedule:` of its own, because GitHub ' +
        'delivers this repo\'s at a 2-5 hour median. Removing this table is how ' +
        'the site went an hour stale through a waiver run.',
    ).toBeGreaterThan(0);
  });

  it('points every cron at a route that exists', () => {
    for (const cron of crons) {
      const file = routeFileFor(cron.path);
      expect(
        existsSync(resolve(root, file)),
        `vercel.json crons "${cron.path}" has no route at ${file}. Vercel ` +
          `answers a dangling cron with a silent 404 on a schedule nobody reads.`,
      ).toBe(true);
    }
  });

  it('gates every cron target behind CRON_SECRET', () => {
    for (const cron of crons) {
      // codeOnly, not the raw source: a route that merely NAMES CRON_SECRET in
      // a comment while checking nothing would otherwise satisfy this — the
      // same prose-for-code confusion `codeOnly` exists to stop, and it would
      // be incoherent to strip comments in the check below but not this one.
      const src = codeOnly(read(routeFileFor(cron.path)));
      expect(
        src.includes('CRON_SECRET'),
        `${routeFileFor(cron.path)} is fired by a Vercel cron but never checks ` +
          `CRON_SECRET. A cron path is an ordinary public route, and these ` +
          `routes start workflows that commit to main with Actions secrets.`,
      ).toBe(true);
    }
  });

  it('fails CLOSED on an unconfigured CRON_SECRET', () => {
    for (const cron of crons) {
      const file = routeFileFor(cron.path);
      const src = codeOnly(read(file));
      // Comparing straight against `Bearer ${process.env.CRON_SECRET}` reads
      // as a check and is not one when the variable is missing: the template
      // literal becomes the literal "Bearer undefined", which anyone can send.
      expect(
        /Bearer \$\{\s*process\.env\.CRON_SECRET\s*\}/.test(src),
        `${file} compares the bearer token against ` +
          '`Bearer ${process.env.CRON_SECRET}` directly. With the variable ' +
          'unset that string is "Bearer undefined" and the gate opens to ' +
          'anyone. Read it into a local and bail when it is falsy first — ' +
          'api/cron/push-fanout.ts is the shape.',
      ).toBe(false);
      // Any *secret*-ish local, not the literal identifier `secret` — a future
      // bridge naming it `cronSecret` is writing correct code and must not
      // fail the build for it.
      expect(
        /if\s*\(\s*!\s*\w*[sS]ecret\w*\s*\)/.test(src),
        `${file} never bails on a missing CRON_SECRET. These routes dispatch ` +
          'workflows that commit to main with Actions secrets, so an ' +
          'environment that merely forgot the variable must refuse, not open.',
      ).toBe(true);
    }
  });

  it('keeps every scheduled bridge wired to a cron', () => {
    const targets = new Set(crons.map((c) => routeFileFor(c.path)));
    for (const bridge of SCHEDULED_BRIDGES) {
      expect(
        targets.has(bridge),
        `${bridge} is a Vercel-cron bridge with no cron pointing at it — it ` +
          `cannot fire, and it reads like live infrastructure while it sits ` +
          `dead. Either add it to vercel.json crons or delete the route.`,
      ).toBe(true);
    }
  });

  it('uses a valid 5-field cron expression', () => {
    for (const cron of crons) {
      const fields = cron.schedule.trim().split(/\s+/);
      expect(
        fields.length,
        `vercel.json crons "${cron.path}" schedule "${cron.schedule}" is not ` +
          `5 fields. Vercel cron expressions are minute hour dom month dow, UTC.`,
      ).toBe(5);
    }
  });
});

/**
 * `dispatchWorkflow('roster-sync.yml')` → `roster-sync.yml`.
 *
 * Read out of the route rather than listed here so the pairing cannot drift:
 * a bridge pointed at a renamed workflow answers 404 from GitHub on a schedule
 * nobody reads, which is the same silent failure as a dangling cron.
 */
function dispatchedWorkflowFor(routeFile: string): string | null {
  const m = /dispatchWorkflow\(\s*['"]([\w.-]+\.yml)['"]/.exec(codeOnly(read(routeFile)));
  return m ? m[1] : null;
}

/** Does this workflow push commits? Both mechanisms, ignoring prose. */
function workflowCommits(workflowSource: string): boolean {
  const code = workflowSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  return /commit-feed-and-push\.mjs|actions\/commit-push/.test(code);
}

describe('every bridged workflow', () => {
  const bridged = crons
    .map((c) => ({ cron: c, route: routeFileFor(c.path) }))
    .map((e) => ({ ...e, workflow: dispatchedWorkflowFor(e.route) }));

  it('is named by the route that fires it', () => {
    for (const { route, workflow } of bridged) {
      expect(
        workflow,
        `${route} is a Vercel cron target but dispatches no workflow this test ` +
          `can see. Keep the dispatchWorkflow('<file>.yml') call literal — a ` +
          `workflow name built from a variable cannot be checked against disk.`,
      ).toBeTruthy();
    }
  });

  it('exists on disk', () => {
    for (const { route, workflow } of bridged) {
      expect(
        existsSync(resolve(root, `.github/workflows/${workflow}`)),
        `${route} dispatches ${workflow}, which is not in .github/workflows. ` +
          `GitHub answers a dispatch for a missing workflow with a 404 that ` +
          `surfaces only in this route's own logs.`,
      ).toBe(true);
    }
  });

  it('carries NO `schedule:` trigger at all', () => {
    // A fallback schedule was tried for one night on roster-sync.yml and
    // removed. It cannot be offset out of the primary's way, because the
    // premise of this whole mechanism is that GitHub delivers whenever it
    // likes: the `7,37` chosen to interleave with the Vercel cron was
    // delivered at :16 and collided anyway. On 2026-09-17T15:16Z it cancelled
    // a dispatch that had already pushed and then failed its own rebase
    // against six single-line feed JSONs git cannot merge — one sync lost, for
    // a trigger giving two unpredictable runs a day and no freshness the
    // primary did not already provide.
    for (const { workflow } of bridged) {
      const source = read(`.github/workflows/${workflow}`);
      const cronLines = [...source.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map(
        (m) => m[1],
      );
      expect(
        cronLines,
        `${workflow} has a \`schedule:\` again. The Vercel cron in vercel.json ` +
          `is its only scheduled trigger; a second one cannot be offset clear ` +
          `of it, and GitHub drops this repo's scheduled events in bulk anyway.`,
      ).toEqual([]);
    }
  });

  it('queues concurrent runs instead of cancelling them, if it pushes', () => {
    // `cancel-in-progress: true` killed a roster-sync run AFTER its push had
    // landed, which is not something a cancel can undo — it just left the
    // survivor rebasing onto a main that had moved under it. schefter-scan is
    // worse: it posts to GroupMe and pushes to real devices BEFORE it commits
    // the watermark recording that it did, so a cancel in between re-sends.
    for (const { workflow } of bridged) {
      const source = read(`.github/workflows/${workflow}`);
      if (!workflowCommits(source)) continue;
      expect(
        /cancel-in-progress:\s*false/.test(source),
        `${workflow} pushes commits but may be cancelled in flight. A cancel ` +
          `cannot un-push, un-post or un-send.`,
      ).toBe(true);
    }
  });

  it('is cadence-gated when a dispatch costs a production build', () => {
    // Every commit to `main` redeploys production, and builds are 91% of the
    // Vercel bill. A bridge whose workflow commits must therefore decide which
    // ticks are worth it — that decision is src/utils/sync-cadence.ts, and a
    // route without it dispatches on every tick of the hour.
    for (const { route, workflow } of bridged) {
      if (!workflowCommits(read(`.github/workflows/${workflow}`))) continue;
      expect(
        /sync-cadence/.test(codeOnly(read(route))),
        `${route} fires ${workflow}, which commits to main — so every ` +
          `dispatch is a production build. Gate it on syncCadenceDecision ` +
          `(src/utils/sync-cadence.ts) rather than dispatching on every tick.`,
      ).toBe(true);
    }
  });
});

describe('the Vercel tick and the cadence module agree', () => {
  it('fires at exactly TICK_MINUTES', () => {
    // sync-cadence.ts decides which ticks dispatch by taking the minute modulo
    // the tier interval. If the cron fires less often than TICK_MINUTES, the
    // waiver tier silently cannot hit its 5-minute cadence; if it fires more
    // often, every tier dispatches more than it claims to — and each extra
    // dispatch is a production build.
    // Every cron whose ROUTE consults the cadence module, found from the
    // route's own imports rather than listed here — a new tiered bridge is
    // covered the day it is written.
    const tiered = crons.filter((c) => /sync-cadence/.test(codeOnly(read(routeFileFor(c.path)))));
    expect(tiered.length, 'no Vercel cron reads sync-cadence.ts').toBeGreaterThan(0);
    const expected = new Set<number>();
    for (let m = 0; m < 60; m += TICK_MINUTES) expected.add(m);
    for (const cron of tiered) {
      expect(
        [...minuteSet(cron.schedule)].sort((a, b) => a - b),
        `vercel.json fires "${cron.path}" on "${cron.schedule}", which does ` +
          `not match TICK_MINUTES=${TICK_MINUTES} in src/utils/sync-cadence.ts. ` +
          `Change both together or the tiers stop meaning what they say.`,
      ).toEqual([...expected].sort((a, b) => a - b));
    }
  });

  it('keeps every tier interval a multiple of the tick', () => {
    for (const [tier, minutes] of Object.entries(TIER_INTERVAL_MINUTES)) {
      expect(minutes % TICK_MINUTES, `${tier}`).toBe(0);
    }
  });
});
