/**
 * GET /api/nfl-week-recap?season=<yyyy>&week=<n> — the NFL week recap's facts
 * for /live/weekly-recap: the top PPR scorer at each position, the bust of the
 * week and one odd stat (src/utils/season-video/nfl-week.ts).
 *
 * OURS ONLY (Brandon, 2026-11-08): gated exactly like `/live/analytics`
 * (`canViewSiteInsights`). Never called by the public video maker.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { canViewSiteInsights } from '../../utils/site-insights';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { REGULAR_SEASON_WEEKS } from '../../utils/nfl-week-starts.mjs';
import { loadNflWeek, recapWeekFor } from '../../utils/season-video/nfl-week-source';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
	});

export const GET: APIRoute = async ({ request, url }) => {
	if (!canViewSiteInsights(getAuthUser(request))) return json({ error: 'Not allowed.' }, 403);
	const current = getCurrentSeasonYear();
	const season = Number(url.searchParams.get('season') ?? current);
	const week = Number(url.searchParams.get('week') ?? recapWeekFor(season, new Date()));
	if (!Number.isInteger(season) || season < 2017 || season > current) return json({ error: 'Bad season.' }, 400);
	if (!Number.isInteger(week) || week < 1 || week > REGULAR_SEASON_WEEKS) return json({ error: 'Bad week.' }, 400);
	const facts = await loadNflWeek(season, week).catch(() => null);
	if (!facts) return json({ error: `No PPR stats for week ${week} yet.` }, 404);
	return json({ facts });
};
