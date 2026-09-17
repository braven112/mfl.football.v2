/**
 * Vercel Cron → GitHub Actions bridge
 *
 * Triggers the "Roster Sync" workflow via workflow_dispatch so we get
 * RELIABLE scheduling from Vercel while the heavy lifting (MFL fetch,
 * salary update, git commit) stays in GitHub Actions.
 *
 * Reliable is the point, not fast. GitHub drops this repo's `schedule`
 * events in bulk — a five-minute cron delivered 5-8 runs a day, not 288,
 * from 2026-08-27 — and because the committed feeds are baked into the
 * build, a sync that does not run is a site that cannot update. This is now
 * the workflow's ONLY scheduled trigger; its own `schedule:` was removed
 * after the offset fallback collided with a dispatch mid-push and lost a
 * sync to an unmergeable feed conflict.
 *
 * Vercel fires this every 5 minutes and `sync-cadence.ts` decides which ticks
 * become dispatches — see its header for the tiers and why the decision
 * cannot live in the cron expression.
 *
 * Its counterpart is `api/cron/sync-health.ts`: this route makes the sync
 * run, that one notices when it has stopped.
 *
 * (Spelled out rather than written as a cron step on purpose: a step
 * expression contains the two characters that END a block comment, so
 * quoting one here silently terminates this JSDoc and hands the rest of it
 * to the compiler as code. That cost 39 type errors on this very file — and
 * nothing but `astro check` can see it, since no unit test imports a route.)
 *
 * Required env vars:
 *   CRON_SECRET   – shared secret Vercel sends as Bearer token
 *   GH_PAT        – GitHub personal access token with `actions:write` scope
 *   GH_REPO_OWNER – e.g. "braven112"
 *   GH_REPO_NAME  – e.g. "mfl.football.v2"
 */

import type { APIRoute } from 'astro';
import { outboundAllowed } from '../../../utils/deploy-environment';
import { syncCadenceDecision } from '../../../utils/sync-cadence';
import type { MflCalendarEvent } from '../../../utils/waiver-window';

/**
 * Every league's calendar and NFL schedule, so the cadence can see a waiver run
 * or a kickoff in EITHER league (see sync-cadence.ts § "Both leagues").
 *
 * `import.meta.glob`, never a static import: these are cron-generated files, and
 * a static specifier hard-fails the build for every league that does not have
 * one yet (CLAUDE.md / storage-and-build.md). The `*` covers the league
 * directories so no slug is hardcoded, and the year filter keeps twenty seasons
 * of feeds out of the serverless bundle.
 */
const calendarModules = import.meta.glob(
  '../../../../data/*/mfl-feeds/20{2[5-9],[3-9][0-9]}/calendar.json',
  { eager: true },
);
const scheduleModules = import.meta.glob(
  '../../../../data/*/mfl-feeds/20{2[5-9],[3-9][0-9]}/nflSchedule.json',
  { eager: true },
);

const calendars: MflCalendarEvent[][] = Object.values(calendarModules)
  .map((m) => (m as any)?.default)
  .filter((events): events is MflCalendarEvent[] => Array.isArray(events));

/** Flatten every league's matchup list down to the kickoff instants. */
const kickoffs: string[] = Object.values(scheduleModules).flatMap((m) => {
  const matchups = (m as any)?.default?.nflSchedule?.matchup;
  return Array.isArray(matchups)
    ? matchups.map((g: any) => g?.kickoff).filter(Boolean)
    : [];
});

export const GET: APIRoute = async ({ request }) => {
  // Verify the request is from Vercel Cron.
  //
  // Fail CLOSED on an unconfigured secret, exactly as api/cron/push-fanout.ts
  // and api/groupme/sync.ts already do. Comparing straight against
  // `Bearer ${process.env.CRON_SECRET}` reads as a check but is not one when
  // the variable is missing: the template literal becomes the literal string
  // "Bearer undefined", so an environment that merely FORGOT the variable
  // accepts `Authorization: Bearer undefined` from anyone — and this route
  // dispatches a workflow that commits to main with Actions secrets.
  //
  // This is the original of the three bridges; the other two grew the guard
  // later and nobody came back for this one. It matters more now that
  // vercel.json points a cron at it.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'CRON_SECRET not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // NOT EVERY TICK DISPATCHES. Vercel fires this on a flat 5-minute cadence and
  // sync-cadence.ts decides whether this one is a beat: 5 min in a waiver tail,
  // 15 during a game, 60 otherwise. A skipped tick costs one function
  // invocation; a dispatch costs a workflow run and, because a changed sync
  // commits to main, a production build — 91% of the Vercel bill.
  //
  // The decision lives in code rather than in the cron expression because it
  // depends on the real NFL schedule and MFL's real waiver calendar, and a cron
  // expression cannot read either. A day-of-week cron would be the derivation
  // this repo bans: 2026 alone opened on a Wednesday, moved week 12 to
  // Wednesday, and ends week 18 all-Sunday.
  //
  // Checked BEFORE the token and outbound guards deliberately — most ticks skip,
  // and a skip needs no credentials to decide.
  const cadence = syncCadenceDecision(new Date(), { calendars, kickoffs });
  if (!cadence.dispatch) {
    return new Response(
      JSON.stringify({ skipped: true, ...cadence }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const token = process.env.GH_PAT;
  const owner = process.env.GH_REPO_OWNER ?? 'braven112';
  const repo = process.env.GH_REPO_NAME ?? 'mfl.football.v2';

  if (!token) {
    return new Response(
      JSON.stringify({ error: 'GH_PAT not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Same one-hop write as the announce route: this POST is harmless, but the
  // workflow it starts syncs rosters and commits to main with Actions secrets.
  // Staging holds the same GH_PAT.
  if (!outboundAllowed()) {
    return new Response(
      JSON.stringify({
        error: 'Workflow dispatch is disabled on this deployment.',
        detail:
          'Staging and preview share production credentials, so they never dispatch ' +
          'the roster sync — run it from production or the Actions tab.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/roster-sync.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ ref: 'main' }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    return new Response(
      JSON.stringify({ error: 'GitHub API error', status: res.status, body }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, triggered: 'roster-sync.yml' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
