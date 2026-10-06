/**
 * Vercel Cron → GitHub Actions bridge for the pre-kickoff lineup check.
 *
 * The fourth bridge, same shape as `api/cron/schefter-scan.ts`. The workflow
 * (`lineup-reminders.yml`) used to run on its own GitHub `schedule` — Sundays
 * 9:15am PT — and GitHub delivered it at 11:44, 12:44 and 12:34 PT on three
 * straight Sundays, after the 10am kickoffs, so the warning named players
 * whose games had already locked them. A fixed Sunday time was wrong even
 * when it was delivered: a London game kicks off at 6:30am PT and a Thursday
 * game's players lock days earlier.
 *
 * So this route fires on the flat tick and dispatches only ahead of a real
 * kickoff, read from every league's committed full-season NFL schedule
 * (`lineupCheckDecision` in sync-cadence.ts). Most ticks skip; a dispatch
 * commits only when it found a NEW problem, so it is rare and cheap.
 *
 * Required env vars:
 *   CRON_SECRET   – shared secret Vercel sends as Bearer token
 *   GH_PAT        – GitHub personal access token with `actions:write` scope
 *   GH_REPO_OWNER – e.g. "braven112"
 *   GH_REPO_NAME  – e.g. "mfl.football.v2"
 */

import type { APIRoute } from 'astro';
import { dispatchWorkflow } from '../../../utils/workflow-dispatch';
import { lineupCheckDecision } from '../../../utils/sync-cadence';

/**
 * `import.meta.glob`, never a static import — cron-generated files, see the
 * same note in api/cron/schefter-scan.ts. The FULL schedule rather than the
 * current-week one, so a kickoff is visible however long ago MFL's own week
 * pointer last moved.
 */
const scheduleModules = import.meta.glob(
  '../../../../data/*/mfl-feeds/20{2[5-9],[3-9][0-9]}/nflSchedule-full.json',
  { eager: true },
);

/** Every kickoff instant across leagues and weeks, de-duplicated. */
const kickoffs: string[] = [
  ...new Set(
    Object.values(scheduleModules).flatMap((m) => {
      const weeks = (m as any)?.default?.fullNflSchedule?.nflSchedule;
      if (!Array.isArray(weeks)) return [];
      return weeks.flatMap((w: any) => {
        const matchups = Array.isArray(w?.matchup) ? w.matchup : w?.matchup ? [w.matchup] : [];
        return matchups.map((g: any) => g?.kickoff).filter(Boolean);
      });
    }),
  ),
];

export const GET: APIRoute = async ({ request }) => {
  // Fail CLOSED on an unconfigured secret — see api/cron/schefter-scan.ts.
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

  const decision = lineupCheckDecision(new Date(), kickoffs);
  if (!decision.dispatch) {
    return new Response(
      JSON.stringify({ skipped: true, ...decision }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return dispatchWorkflow('lineup-reminders.yml');
};
