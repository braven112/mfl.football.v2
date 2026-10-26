/**
 * POST /api/league-history/ask — Ask the History.
 * Body: `{ "league": "theleague" | "afl-fantasy", "question": "...", "after"?: "<answer id>" }`
 * → `{ id, answer, headline, followUps, table, steps }`; `id` opens the
 *   shareable answer page at /<league>/history/ask/<id>.
 *
 * `after` makes it a follow-up: the earlier answers in that conversation are
 * read back from the store (never from the request), so "what about in the
 * playoffs?" knows what it is about.
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
import { franchiseIdForLeague, getAuthUser } from '../../../utils/auth';
import { getLeagueBySlug } from '../../../config/leagues';
import { checkRateLimit } from '../../../utils/rate-limit';
import { canAskLeagueHistory } from '../../../utils/league-history/access';
import { askHistory, type AskAsker, type AskData } from '../../../utils/league-history/ask';
import { readAnswer, recordAsk, saveAnswer, turnsAfter } from '../../../utils/league-history/ask-store';

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

/** The asker's team in the latest season, so "my team" means something. */
function askerOf(history: any, franchiseId: string | null): AskAsker | null {
	const team = franchiseId ? history?.seasons?.at(-1)?.teams?.[franchiseId] : null;
	if (!team) return null;
	const owner = String(team.h ?? '')
		.split('+')
		.map((id: string) => history.owners?.[id]?.name)
		.filter(Boolean)
		.join(' & ');
	return { team: team.n ?? null, owner: owner || null };
}

export const POST: APIRoute = async ({ request }) => {
	let question = '';
	let slug = '';
	let after = '';
	try {
		const body = (await request.json()) as { question?: unknown; league?: unknown; after?: unknown };
		question = typeof body?.question === 'string' ? body.question.trim() : '';
		slug = typeof body?.league === 'string' ? body.league : '';
		after = typeof body?.after === 'string' ? body.after : '';
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

	// An expired or unknown parent just starts a fresh conversation.
	const parent = after ? await readAnswer(league.slug, after).catch(() => null) : null;
	const turns = parent ? turnsAfter(parent) : [];

	let result;
	try {
		result = await askHistory(league.slug, ds, question, { turns, asker: askerOf(ds.history, franchiseIdForLeague(user, league.id)) });
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
			parent: parent?.id ?? null,
			turns,
			askedBy: { franchiseId: user.franchiseId, name: user.name || null },
		});
		id = saved?.id ?? null;
		if (saved) await recordAsk(saved).catch((e) => console.error('[league-history/ask] count failed:', e));
	} catch (e) {
		// The answer still stands; it just has no share link.
		console.error('[league-history/ask] save failed:', e);
	}
	return json({ id, question, ...result });
};
