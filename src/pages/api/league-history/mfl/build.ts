/**
 * POST /api/league-history/mfl/build — one build step for an MFL league's
 * free History page. Body: `{ "leagueId": "12345" }` (application/json).
 *
 * The setup page calls this until `status` is 'done'; see `advanceMflHistory`
 * (src/utils/league-history/store.ts) for why a build is steps.
 *
 * Gated by `canViewLeagueHistory` (one seat until launch). Rate limits are
 * per client address: a step every few seconds is a normal build, a burst of
 * new leagues is not. Every MFL request is built from a validated numeric id
 * and MFL's own hosts (mfl-crawl.ts), so nothing a caller sends reaches a url.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../utils/auth';
import { getClientIdentity } from '../../../../utils/client-ip';
import { checkRateLimit } from '../../../../utils/rate-limit';
import { getCurrentLeagueYear } from '../../../../utils/league-year';
import { canViewLeagueHistory } from '../../../../utils/league-history/access';
import { mflExportFetcher } from '../../../../utils/league-history/mfl-crawl';
import { advanceMflHistory, isMflLeagueId, readMflHistory } from '../../../../utils/league-history/store';

export const prerender = false;

const STEPS_PER_HOUR = 240;
const NEW_LEAGUES_PER_HOUR = 10;

export const POST: APIRoute = async ({ request }) => {
	if (!canViewLeagueHistory(getAuthUser(request))) return json({ status: 'forbidden' }, 404);

	let leagueId = '';
	try {
		const body = (await request.json()) as { leagueId?: unknown };
		leagueId = String(body?.leagueId ?? '').trim();
	} catch {
		return json({ status: 'bad-request', message: 'Send JSON: { "leagueId": "12345" }' }, 400);
	}
	if (!isMflLeagueId(leagueId)) {
		return json({ status: 'bad-request', message: 'An MFL league id is 3 to 7 digits.' }, 400);
	}

	const who = getClientIdentity(request).client ?? 'unknown';
	const steps = await checkRateLimit('league-history-step', who, STEPS_PER_HOUR, 3600);
	if (!steps.allowed) return json({ status: 'rate-limited', message: 'Too many requests. Try again later.' }, 429);
	if (!(await readMflHistory(leagueId))) {
		const fresh = await checkRateLimit('league-history-new', who, NEW_LEAGUES_PER_HOUR, 3600);
		if (!fresh.allowed) {
			return json({ status: 'rate-limited', message: 'Too many new leagues this hour. Try again later.' }, 429);
		}
	}

	const result = await advanceMflHistory(leagueId, {
		fetchExport: mflExportFetcher,
		leagueYear: getCurrentLeagueYear(),
	});
	const status = result.status === 'not-found' ? 404 : result.status === 'no-storage' ? 503 : 200;
	return json({ leagueId, ...result }, status);
};

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
