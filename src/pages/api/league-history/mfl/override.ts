/**
 * POST /api/league-history/mfl/override — an admin's fix for one season's
 * champion. Body (application/json):
 *   { leagueId, year, championId, runnerUpId }   set (ids from that season)
 *   { leagueId, year, clear: true }              remove the fix
 * `championId: null` records "no champion that season".
 *
 * Admin only (`canFixLeagueHistory`), before and after launch, until the
 * commissioner claim flow exists. Ids must be franchises MFL listed for that
 * season, so a fix cannot invent a team.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../utils/auth';
import { canFixLeagueHistory } from '../../../../utils/league-history/access';
import { isMflLeagueId, readMflHistory, writeOverride } from '../../../../utils/league-history/store';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	if (!canFixLeagueHistory(getAuthUser(request))) return json({ ok: false }, 404);

	let body: { leagueId?: unknown; year?: unknown; championId?: unknown; runnerUpId?: unknown; clear?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, message: 'Send JSON.' }, 400);
	}
	const leagueId = String(body.leagueId ?? '');
	const year = Number(body.year);
	if (!isMflLeagueId(leagueId) || !Number.isInteger(year)) return json({ ok: false, message: 'Bad league or year.' }, 400);

	const record = await readMflHistory(leagueId);
	const season = record?.seasons[String(year)];
	if (!record || !record.chain.some((s) => s.year === year)) return json({ ok: false, message: 'Unknown season.' }, 404);

	if (body.clear === true) {
		await writeOverride(leagueId, year, null);
		return json({ ok: true }, 200);
	}

	const known = new Set((season?.franchises ?? []).map((f) => f.id));
	const pick = (v: unknown): string | null | undefined => {
		if (v === null || v === '') return null;
		const id = String(v ?? '');
		return known.has(id) ? id : undefined;
	};
	const championId = pick(body.championId);
	const runnerUpId = pick(body.runnerUpId);
	if (championId === undefined || runnerUpId === undefined) {
		return json({ ok: false, message: 'Pick franchises from that season.' }, 400);
	}
	if (championId && championId === runnerUpId) {
		return json({ ok: false, message: 'Champion and runner-up must differ.' }, 400);
	}
	const ok = await writeOverride(leagueId, year, { championId, runnerUpId });
	return json({ ok }, ok ? 200 : 503);
};

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
