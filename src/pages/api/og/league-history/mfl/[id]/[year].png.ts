/**
 * The champion card for one season of a League History page —
 * /api/og/league-history/mfl/<leagueId>/<year>.png
 *
 * Renders only a season the store already holds with a champion (an admin
 * fix included), so the endpoint cannot be used to draw arbitrary text.
 * Gated like the pages: one seat until launch, which also means chat apps
 * cannot unfurl it yet (they fetch without a session).
 *
 * Cached briefly rather than forever: an admin fix can change a season's
 * champion, and the CDN would otherwise keep the old card.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../../../../utils/auth';
import { canViewLeagueHistory } from '../../../../../../utils/league-history/access';
import { renderChampionCardPng } from '../../../../../../utils/league-history/champion-card';
import {
	effectiveSeasons,
	isMflLeagueId,
	readMflHistory,
	readOverrides,
	trophyCase,
} from '../../../../../../utils/league-history/store';

export const prerender = false;

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ params, request }) => {
	if (!canViewLeagueHistory(getAuthUser(request))) return notFound();
	const leagueId = params.id ?? '';
	const year = Number(params.year);
	if (!isMflLeagueId(leagueId) || !Number.isInteger(year)) return notFound();

	const record = await readMflHistory(leagueId);
	if (!record) return notFound();
	const seasons = effectiveSeasons(record, await readOverrides(leagueId));
	const season = seasons.find((s) => s.year === year);
	if (!season?.champion) return notFound();

	const titles = trophyCase(record, seasons).find((t) => t.franchiseId === season.champion!.id)?.titles ?? [];
	const titleNumber = titles.filter((y) => y <= year).length;
	const viaStandings = season.method === 'standings' || season.crawled?.method === 'standings';

	try {
		const png = await renderChampionCardPng({
			leagueName: record.name,
			year,
			champion: season.champion.name,
			runnerUp: season.runnerUp?.name ?? null,
			titleNumber: Math.max(titleNumber, 1),
			decidedBy: viaStandings ? 'standings' : 'final',
		});
		return new Response(new Uint8Array(png), {
			headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' },
		});
	} catch (err) {
		console.error(`[league-history] card failed for ${leagueId}/${year}:`, err);
		return new Response('Render failed', { status: 500, headers: { 'Cache-Control': 'no-store' } });
	}
};
