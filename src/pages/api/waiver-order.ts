/**
 * /api/waiver-order — the LIVE waiver priority for the caller's league.
 *
 * GET → { success, asOf, order: [{ franchiseId, sortOrder }] }
 *
 * WHY LIVE, AND NOT THE SYNCED `league.json` FEED. Priority is rolling: MFL
 * mutates `waiverSortOrder` every time a claim is awarded, so the cron-synced
 * feed is stale exactly when an owner cares — the morning after waivers ran.
 * The export is small (~12 KB), public (no owner cookie), and cached in-process
 * here, so this costs MFL one read per warm instance per minute no matter how
 * many owners open the modal.
 *
 * WHY IT IS AUTH-GATED AT ALL, given the data is public: the product decision
 * is that an owner sees THEIR conference's order, and "their conference" only
 * exists once there is a session. A signed-out caller gets `needsLogin` so the
 * modal can offer the on-site sign-in instead of a blank list.
 *
 * The route deliberately does NOT rank or filter. Ranking is per-conference
 * (see src/utils/waiver-order.ts for why the raw 1-24 number is a lie about
 * an owner's odds) and the page already knows, at SSR time, which franchises
 * share the viewer's conference. Sending raw entries keeps ONE ranking
 * implementation, shared by the modal and its tests, instead of a second copy
 * here that could disagree.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getLeagueById, DEFAULT_LEAGUE_ID } from '../../config/leagues';
import { getCurrentLeagueYear, getRolloverLeagueYear } from '../../utils/league-year';
import { buildMflExportUrl } from '../../utils/mfl-url';
import { fetchWithTimeout } from '../../utils/fetch-with-timeout';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../utils/api-response';
import { readWaiverSortOrder, type WaiverOrderEntry } from '../../utils/waiver-order';

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ success: false, message, ...extra }), { status, headers: JSON_HEADERS });

/**
 * One MFL read per warm instance per minute, per league-year. Failures are
 * cached briefly too, so an MFL outage doesn't put a 6s timeout in front of
 * every modal open — and the last good order keeps serving through a blip,
 * because a minute-old order is a far better answer than an error box.
 */
const OK_TTL_MS = 60_000;
const ERROR_TTL_MS = 15_000;
const cache = new Map<string, { at: number; ok: boolean; order: WaiverOrderEntry[]; asOf: string }>();

async function readLiveOrder(leagueId: string, year: number) {
  const key = `${leagueId}:${year}`;
  const prior = cache.get(key);
  const now = Date.now();
  if (prior && now - prior.at < (prior.ok ? OK_TTL_MS : ERROR_TTL_MS)) return prior;

  try {
    const res = await fetchWithTimeout(
      buildMflExportUrl({ type: 'league', leagueId, year }),
      { timeoutMs: 6000 },
    );
    if (!res.ok) throw new Error(`MFL league HTTP ${res.status}`);
    const order = readWaiverSortOrder(await res.json());
    // An empty parse is not a valid order — it means MFL answered with an
    // error body or a shape we don't recognise. Treat it as a failure so the
    // last known-good order keeps serving, rather than caching "nobody has
    // priority" for a minute.
    if (order.length === 0) throw new Error('MFL league payload carried no waiverSortOrder');
    const fresh = { at: now, ok: true, order, asOf: new Date(now).toISOString() };
    cache.set(key, fresh);
    return fresh;
  } catch (err) {
    console.warn('[waiver-order] MFL league fetch failed:', err);
    // Keep the last good payload (and its original asOf, so the modal can say
    // honestly how old the number is) through the outage.
    const degraded = {
      at: now,
      ok: false,
      order: prior?.order ?? [],
      asOf: prior?.asOf ?? new Date(now).toISOString(),
    };
    cache.set(key, degraded);
    return degraded;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) {
    return fail('Sign in to see your conference’s waiver priority.', 401, { needsLogin: true });
  }

  const league = getLeagueById(user.leagueId || DEFAULT_LEAGUE_ID);
  if (!league) return fail('Unrecognized league on session. Please sign in again.', 400);

  const year = league.leagueYearRollover
    ? getRolloverLeagueYear(league.leagueYearRollover)
    : getCurrentLeagueYear();

  const { order, asOf, ok } = await readLiveOrder(league.id, year);
  if (order.length === 0) {
    return fail('MyFantasyLeague did not answer with a waiver order. Try again in a moment.', 502);
  }

  return new Response(
    JSON.stringify({
      success: true,
      year,
      asOf,
      // False when MFL just failed and this is the last known-good order, so
      // the modal can say so instead of presenting stale numbers as live.
      live: ok,
      franchiseId: user.franchiseId,
      order,
    }),
    { status: 200, headers: JSON_HEADERS },
  );
};
