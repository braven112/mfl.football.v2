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
const SCHEDULED_BRIDGES = ['src/pages/api/cron/roster-sync.ts'];

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

describe('roster-sync.yml has no schedule of its own', () => {
  const workflow = read('.github/workflows/roster-sync.yml');

  it('carries NO `schedule:` trigger at all', () => {
    // A fallback schedule was tried for one night and removed. It cannot be
    // offset out of the primary's way, because the premise of this whole
    // mechanism is that GitHub delivers whenever it likes: the `7,37` chosen to
    // interleave with the Vercel cron was delivered at :16 and collided anyway.
    // On 2026-09-17T15:16Z it cancelled a dispatch that had already pushed and
    // then failed its own rebase against six single-line feed JSONs git cannot
    // merge — one sync lost, for a trigger giving two unpredictable runs a day
    // and no freshness the primary did not already provide.
    const cronLines = [...workflow.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    expect(
      cronLines,
      'roster-sync.yml has a `schedule:` again. The Vercel cron in vercel.json ' +
        'is the only scheduled trigger; a second one cannot be offset clear of ' +
        'it and collides with a job that pushes. Absence is covered by ' +
        'scripts/check-sync-freshness.mjs, not by a fallback schedule.',
    ).toEqual([]);
  });

  it('queues concurrent runs instead of cancelling them', () => {
    // `cancel-in-progress: true` killed a run AFTER its push had landed, which
    // is not something a cancel can undo — it just left the survivor rebasing
    // onto a main that had moved under it.
    expect(
      /cancel-in-progress:\s*false/.test(workflow),
      'roster-sync.yml must set `cancel-in-progress: false`. These steps push, ' +
        'and a cancel cannot un-push; cancelling mid-flight is what lost a sync ' +
        'to an unmergeable feed conflict on 2026-09-17.',
    ).toBe(true);
  });
});

describe('the Vercel tick and the cadence module agree', () => {
  it('fires at exactly TICK_MINUTES', () => {
    // sync-cadence.ts decides which ticks dispatch by taking the minute modulo
    // the tier interval. If the cron fires less often than TICK_MINUTES, the
    // waiver tier silently cannot hit its 5-minute cadence; if it fires more
    // often, every tier dispatches more than it claims to — and each extra
    // dispatch is a production build.
    const roster = crons.find((c) => c.path === '/api/cron/roster-sync');
    expect(roster, 'no Vercel cron for the roster sync').toBeTruthy();
    const minutes = minuteSet(roster!.schedule);
    const expected = new Set<number>();
    for (let m = 0; m < 60; m += TICK_MINUTES) expected.add(m);
    expect(
      [...minutes].sort((a, b) => a - b),
      `vercel.json fires the roster sync on "${roster!.schedule}", which does ` +
        `not match TICK_MINUTES=${TICK_MINUTES} in src/utils/sync-cadence.ts. ` +
        `Change both together or the tiers stop meaning what they say.`,
    ).toEqual([...expected].sort((a, b) => a - b));
  });

  it('keeps every tier interval a multiple of the tick', () => {
    for (const [tier, minutes] of Object.entries(TIER_INTERVAL_MINUTES)) {
      expect(minutes % TICK_MINUTES, `${tier}`).toBe(0);
    }
  });
});
