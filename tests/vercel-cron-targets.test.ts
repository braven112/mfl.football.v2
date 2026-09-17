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
 * minute — because the fallback schedule is deliberately an OFFSET LIST
 * (`7,37`) rather than a step, and a checker that understood only the step
 * form would skip it silently and enforce nothing.
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

const firingsPerHour = (expr: string) => minuteSet(expr).size;

/** `/api/cron/roster-sync` → `src/pages/api/cron/roster-sync.ts` */
function routeFileFor(cronPath: string): string {
  const clean = cronPath.split('?')[0].replace(/^\/+|\/+$/g, '');
  return `src/pages/${clean}.ts`;
}

describe('vercel.json crons ↔ API routes', () => {
  it('declares at least one cron (the roster sync is not optional)', () => {
    expect(
      crons.length,
      'vercel.json has no `crons`. The Vercel cron is the PRIMARY trigger for ' +
        'the roster sync — GitHub Actions `schedule` is a fallback that this ' +
        'repo has measured at a 2-5 hour median. Removing this table is how ' +
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

describe('roster-sync.yml schedule is a fallback, not the primary trigger', () => {
  const workflow = read('.github/workflows/roster-sync.yml');

  it('does not ask GitHub for a high-frequency schedule', () => {
    const cronLines = [...workflow.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    expect(cronLines.length).toBeGreaterThan(0);
    for (const expr of cronLines) {
      expect(
        firingsPerHour(expr),
        `roster-sync.yml asks GitHub for "${expr}", which fires ` +
          `${firingsPerHour(expr)}× an hour. GitHub does not deliver a ` +
          `high-frequency schedule on this repo (measured: 5-8 runs a day ` +
          `against the 288 that */5 requested), the Vercel cron is the ` +
          `primary trigger now, and every extra run is a production build.`,
      ).toBeLessThanOrEqual(2);
    }
  });

  it('offsets the fallback off the Vercel cron\'s own slots', () => {
    const primary = crons.find((c) => c.path === '/api/cron/roster-sync');
    expect(primary, 'no Vercel cron for the roster sync to offset against').toBeTruthy();
    const primaryMinutes = minuteSet(primary!.schedule);

    const cronLines = [...workflow.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    for (const expr of cronLines) {
      const overlap = [...minuteSet(expr)].filter((m) => primaryMinutes.has(m));
      expect(
        overlap,
        `roster-sync.yml's fallback "${expr}" fires at minute(s) ` +
          `${overlap.join(', ')}, which the Vercel cron "${primary!.schedule}" ` +
          `already covers. A fallback landing on the primary's own slots adds ` +
          `no coverage at any minute not already covered, and collides: every ` +
          `trigger shares \`concurrency: roster-sync\` with ` +
          `\`cancel-in-progress: true\`, so a delivered scheduled event kills ` +
          `the Vercel-dispatched run mid-flight — and the push-alert steps ` +
          `send their fan-out BEFORE writing the Redis snapshot of what was ` +
          `sent, so a cancel in that gap re-sends injury pushes to owners' ` +
          `devices. Offset it (e.g. "7,37 * * * *").`,
      ).toEqual([]);
    }
  });
});
