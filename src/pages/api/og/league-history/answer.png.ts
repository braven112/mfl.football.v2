/**
 * The Ask the History share card for one saved answer —
 * /api/og/league-history/answer.png?league=<slug>&id=<answer id>
 *
 * Portrait (answer-card.ts). It is the shared answer page's og:image, and the
 * page's Share button hands the same PNG to the phone's share sheet, so the
 * picture lands in GroupMe with the link under it.
 *
 * Open like the answer page itself: anyone with the link may read a saved
 * answer. It draws only an answer that was saved (ask-store.ts), never text
 * from the query string, and never the asker's name. A saved answer does not
 * change, so the image is cached hard.
 */
import type { APIRoute } from 'astro';
import { getLeagueBySlug, leagueUrl } from '../../../../config/leagues';
import { readAnswer } from '../../../../utils/league-history/ask-store';
import { answerTeam } from '../../../../utils/league-history/ask-render';
import { askAtLabel, renderAnswerCardPng, teamIcon } from '../../../../utils/league-history/answer-card';
import { logoDataUri } from '../../../../utils/league-history/record-card';
import { hasLeagueHistoryProduct, loadLeagueHistory } from '../../../../utils/league-history/datasets';

export const prerender = false;

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ url }) => {
	const q = url.searchParams;
	const slug = q.get('league') ?? '';
	const league = getLeagueBySlug(slug);
	if (!league || league.slug !== slug || !hasLeagueHistoryProduct(league.dataPath)) return notFound();
	const saved = await readAnswer(league.slug, q.get('id') ?? '').catch(() => null);
	if (!saved) return notFound();

	const first = saved.table?.rows?.[0];
	const icon = first ? teamIcon(await loadLeagueHistory(league.dataPath).catch(() => null), answerTeam(saved.table), first.year) : null;
	try {
		const png = await renderAnswerCardPng({
			leagueName: league.name,
			question: saved.question,
			headline: saved.headline ?? null,
			answer: saved.answer,
			logo: await logoDataUri(icon, url.origin),
			askAt: askAtLabel(leagueUrl(league, `/${league.slug}/history/ask`)),
		});
		return new Response(new Uint8Array(png), {
			headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=604800' },
		});
	} catch (err) {
		console.error(`[league-history] answer card failed for ${slug}/${saved.id}:`, err);
		return new Response('Render failed', { status: 500, headers: { 'Cache-Control': 'no-store' } });
	}
};
