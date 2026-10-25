/**
 * The Record Book share card for one board —
 * /api/og/league-history/record.png?league=<slug>&cat=&board=[&scope=][&era=]
 *
 * Draws only a board the Record Book itself computes, from the league's own
 * dataset, so the endpoint cannot be used to draw arbitrary text. Gated like
 * the pages (one seat until launch), which also means chat apps cannot unfurl
 * it yet: the page's "Save as image" link downloads it for posting instead.
 */
import type { APIRoute } from 'astro';
import theleagueHistory from '../../../../../data/theleague/derived/league-history.json';
import aflHistory from '../../../../../data/afl-fantasy/derived/league-history.json';
import { getLeagueBySlug } from '../../../../config/leagues';
import { getAuthUser } from '../../../../utils/auth';
import { canViewLeagueHistory } from '../../../../utils/league-history/access';
import { CATEGORIES, SCOPES, historyEras, recordBook } from '../../../../utils/league-history/records.mjs';
import { logoDataUri, renderRecordCardPng, type RecordCardRow } from '../../../../utils/league-history/record-card';

export const prerender = false;

/** The leagues with a Record Book, by registry slug (the routes import the same files). */
const DATASETS: Record<string, unknown> = {
	theleague: theleagueHistory,
	'afl-fantasy': aflHistory,
};

const SCOPE_LABEL: Record<string, string> = { regular: 'Regular season', playoffs: 'Playoffs' };

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ url, request }) => {
	if (!canViewLeagueHistory(getAuthUser(request))) return notFound();
	const q = url.searchParams;
	const slug = q.get('league') ?? '';
	const data = DATASETS[slug];
	const league = data ? getLeagueBySlug(slug) : undefined;
	if (!data || !league) return notFound();

	const category = CATEGORIES.find((c) => c.id === q.get('cat'));
	if (!category) return notFound();
	const scope = category.scoped && SCOPES.includes(q.get('scope') ?? '') ? q.get('scope')! : 'all';
	const eras = historyEras(data, league.historyEras ?? []);
	const era = eras.find((e) => e.id === q.get('era')) ?? eras[0];
	const boards = recordBook(data, { from: era.from }).category(category.id, scope) as Array<{
		id: string;
		title: string;
		asc: boolean;
		rows: Array<RecordCardRow & { unit?: string }>;
	}>;
	const board = boards.find((b) => b.id === q.get('board'));
	if (!board?.rows.length) return notFound();

	const qualifier = [SCOPE_LABEL[scope], era.from == null ? null : era.label].filter(Boolean).join(' · ') || null;
	try {
		const png = await renderRecordCardPng({
			leagueName: league.name,
			title: board.title,
			qualifier,
			unit: board.rows[0].unit ?? null,
			asc: board.asc,
			logo: await logoDataUri(board.rows[0].icon, url.origin),
			rows: board.rows.slice(0, 5).map((r) => ({
				rank: r.rank,
				name: r.name,
				value: r.value,
				display: r.display,
				context: r.context,
				owner: r.owner,
				icon: r.icon,
			})),
		});
		return new Response(new Uint8Array(png), {
			headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' },
		});
	} catch (err) {
		console.error(`[league-history] record card failed for ${slug}/${board.id}:`, err);
		return new Response('Render failed', { status: 500, headers: { 'Cache-Control': 'no-store' } });
	}
};
