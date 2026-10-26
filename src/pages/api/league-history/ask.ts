/**
 * POST /api/league-history/ask — Ask the History.
 * Body: `{ "league": "theleague" | "afl-fantasy", "question": "..." }`
 * → `{ id, answer, table, steps }`; `id` opens the shareable answer page at
 *   /<league>/history/ask/<id>.
 *
 * Signed-in owners of that league only (canAskLeagueHistory), and the league
 * comes from the URL the owner is on but must match the session, never just
 * the param. Rate-limited per franchise because every question spends Sonnet
 * tokens. The answer is computed from league-history.json by our own engine
 * (utils/league-history/ask-query.mjs), player questions from
 * league-history-players.json, and trades/drafts/pickups from
 * league-history-moves.json; see ask.ts.
 */
import type { APIRoute } from 'astro';
import theleagueHistory from '../../../../data/theleague/derived/league-history.json';
import aflHistory from '../../../../data/afl-fantasy/derived/league-history.json';
import theleaguePlayers from '../../../../data/theleague/derived/league-history-players.json';
import aflPlayers from '../../../../data/afl-fantasy/derived/league-history-players.json';
import theleagueMoves from '../../../../data/theleague/derived/league-history-moves.json';
import aflMoves from '../../../../data/afl-fantasy/derived/league-history-moves.json';
import { getAuthUser } from '../../../utils/auth';
import { getLeagueBySlug } from '../../../config/leagues';
import { checkRateLimit } from '../../../utils/rate-limit';
import { canAskLeagueHistory } from '../../../utils/league-history/access';
import { askHistory, type AskData } from '../../../utils/league-history/ask';
import { saveAnswer } from '../../../utils/league-history/ask-store';

export const prerender = false;

const DATASETS: Record<string, AskData> = {
	theleague: { history: theleagueHistory, players: theleaguePlayers, moves: theleagueMoves },
	'afl-fantasy': { history: aflHistory, players: aflPlayers, moves: aflMoves },
};

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 3600;
const MAX_QUESTION = 300;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}

export const POST: APIRoute = async ({ request }) => {
	let question = '';
	let slug = '';
	try {
		const body = (await request.json()) as { question?: unknown; league?: unknown };
		question = typeof body?.question === 'string' ? body.question.trim() : '';
		slug = typeof body?.league === 'string' ? body.league : '';
	} catch {
		return json({ error: 'Invalid request body' }, 400);
	}
	const league = getLeagueBySlug(slug);
	const ds = league ? DATASETS[league.slug] : null;
	if (!league || !ds) return json({ error: 'Unknown league.' }, 404);

	const user = getAuthUser(request);
	if (!user) return json({ error: 'Sign in to ask the history.' }, 401);
	if (!canAskLeagueHistory(user, league.id)) return json({ error: `Asking is for ${league.name} owners.` }, 403);

	if (question.length < 5) return json({ error: 'Ask a question first.' }, 400);
	if (question.length > MAX_QUESTION) return json({ error: `Keep it under ${MAX_QUESTION} characters.` }, 400);

	const limit = await checkRateLimit('history-ask', `${league.slug}:${user.franchiseId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
	if (!limit.allowed) return json({ error: 'That is a lot of questions for one hour. Try again later.' }, 429);

	let result;
	try {
		result = await askHistory(league.slug, ds, question);
	} catch (e) {
		console.error('[league-history/ask] failed:', e);
		return json({ error: 'Could not work that one out right now. Try again in a minute, or ask it a different way.' }, 503);
	}

	let id: string | null = null;
	try {
		const saved = await saveAnswer({
			league: league.slug,
			question,
			...result,
			askedBy: { franchiseId: user.franchiseId, name: user.name || null },
		});
		id = saved?.id ?? null;
	} catch (e) {
		// The answer still stands; it just has no share link.
		console.error('[league-history/ask] save failed:', e);
	}
	return json({ id, question, ...result });
};
