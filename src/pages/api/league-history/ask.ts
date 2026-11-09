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
 * Signed-in owners of that league (canAskLeagueHistory), and the league
 * comes from the URL the owner is on but must match the session, never just
 * the param. Rate-limited per franchise because every question spends model
 * tokens. The model follows the league's plan (utils/ai-plan.mjs): Sonnet for
 * a full custom site, Haiku for the League History tier and for guests; each
 * question's real token cost is recorded per league and model (utils/ai-usage).
 *
 * Signed-out visitors may ask the public demo league (guest-ask.ts): a few
 * questions a day, counted per visitor and per address under a site-wide
 * ceiling, against a dataset whose owner names are masked BEFORE the model
 * sees it (guest-mask.ts). Their answers stay out of the league's own feed. The answer is computed from league-history.json by our own engine
 * (utils/league-history/ask-query.mjs), player questions from
 * league-history-players.json, and trades/drafts/pickups from
 * league-history-moves.json; see ask.ts.
 */
import type { APIRoute } from 'astro';
import { franchiseIdForLeague, getAuthUser } from '../../../utils/auth';
import { getLeagueBySlug } from '../../../config/leagues';
import { checkRateLimit } from '../../../utils/rate-limit';
import { canAskLeagueHistory } from '../../../utils/league-history/access';
import { askHistory, type AskAsker, type AskData } from '../../../utils/league-history/ask';
import { readAnswer, recordAsk, saveAnswer, turnsAfter } from '../../../utils/league-history/ask-store';
import { hasLeagueHistoryProduct, loadLeagueCompetitions, loadLeagueHistoryDataset } from '../../../utils/league-history/datasets';
import {
	GUEST_REFUSALS,
	canGuestAsk,
	guestAllowance,
	guestCookie,
	guestIdFrom,
	isCleanQuestion,
	newGuestId,
	spendGuestQuestion,
	type GuestAllowance,
} from '../../../utils/league-history/guest-ask';
import { guestMasker, maskDataset, maskValue, type NameMasker } from '../../../utils/league-history/guest-mask';
import { recordFunnel } from '../../../utils/history-funnel';
import { aiModelForLeague } from '../../../utils/ai-plan.mjs';
import { recordAiUsage } from '../../../utils/ai-usage';

export const prerender = false;

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 3600;
const MAX_QUESTION = 300;

function json(data: unknown, status = 200, setCookie?: string): Response {
	const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
	if (setCookie) headers['Set-Cookie'] = setCookie;
	return new Response(JSON.stringify(data), { status, headers });
}

/** A guest's dataset: every loaded file masked once per instance (each is the loader's cached object). */
function maskAskData(ds: AskData, mask: NameMasker): AskData {
	const m = <T,>(v: T): T => (v && typeof v === 'object' ? maskDataset(v as object, mask) : v) as T;
	const c = ds.competitions;
	return {
		history: m(ds.history),
		players: m(ds.players),
		moves: m(ds.moves),
		competitions: c
			? { tierCompetition: m(c.tierCompetition), tierHistory: m(c.tierHistory), awards: m(c.awards), weekly: Object.fromEntries(Object.entries(c.weekly ?? {}).map(([k, v]) => [k, m(v)])) }
			: c,
	};
}

/** GET → where a signed-out visitor stands today, for the ask screen's counter. */
export const GET: APIRoute = async ({ request, url }) => {
	const league = getLeagueBySlug(url.searchParams.get('league') ?? '');
	if (!league || !canGuestAsk(league.slug)) return json({ error: 'Unknown league.' }, 404);
	if (getAuthUser(request)) return json({ guest: null });
	const allowance = await guestAllowance(league.slug, guestIdFrom(request)).catch(() => null);
	return json({ guest: allowance });
};

/** A signed-out visitor's question, on the public demo league. */
async function askAsGuest(request: Request, league: NonNullable<ReturnType<typeof getLeagueBySlug>>, question: string, after: string): Promise<Response> {
	if (!isCleanQuestion(question)) return json({ error: 'Keep it clean, and ask it another way.' }, 400);
	const existing = guestIdFrom(request);
	const id = existing ?? newGuestId();
	const cookie = existing ? undefined : guestCookie(id, new URL(request.url).protocol === 'https:');
	const masker = guestMasker(league.slug);
	const mask = masker ? await masker.catch(() => null) : null;
	if (!mask) return json({ error: GUEST_REFUSALS.unavailable }, 503, cookie);

	const spend = await spendGuestQuestion(league.slug, id, request).catch(() => null);
	if (!spend?.ok) {
		const reason = spend?.reason ?? 'unavailable';
		return json({ error: GUEST_REFUSALS[reason], guest: spend?.allowance ?? null, needEmail: reason === 'need-email' }, reason === 'unavailable' ? 503 : 429, cookie);
	}
	const allowance: GuestAllowance = spend.allowance;
	const asker = `guest:${id}`;

	// A guest continues only their own conversation: an owner's turns carry real names.
	const parent = after ? await readAnswer(league.slug, after).catch(() => null) : null;
	const turns = parent?.guest && parent.askedBy.franchiseId === asker ? turnsAfter(parent) : [];

	let result;
	try {
		const [loaded, competitions] = await Promise.all([
			loadLeagueHistoryDataset(league.dataPath),
			loadLeagueCompetitions(league.dataPath, league.configPath),
		]);
		if (!loaded) {
			await spend.refund();
			return json({ error: 'Unknown league.' }, 404, cookie);
		}
		const ds = maskAskData({ ...loaded, competitions }, mask);
		result = maskValue(
			await askHistory(league.slug, ds, question, {
				turns,
				asker: null,
				model: aiModelForLeague(league.slug, { guest: true }),
				onUsage: (u) => void recordAiUsage(`${league.slug}-guest`, u).catch(() => {}),
			}),
			mask,
		);
	} catch (e) {
		await spend.refund();
		console.error('[league-history/ask] guest failed:', e);
		return json({ error: 'Could not work that one out right now. Try again in a minute, or ask it a different way.', guest: { ...allowance, used: allowance.used - 1 } }, 503, cookie);
	}

	let saved = null;
	try {
		saved = await saveAnswer({
			league: league.slug,
			question,
			...result,
			parent: turns.length ? parent!.id : null,
			turns,
			askedBy: { franchiseId: asker, name: null },
			guest: true,
		});
	} catch (e) {
		console.error('[league-history/ask] guest save failed:', e);
	}
	await recordFunnel('ask_demo_question', 'mfl', id).catch(() => false);
	return json({ id: saved?.id ?? null, question, ...result, guest: allowance }, 200, cookie);
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
	if (!league || !hasLeagueHistoryProduct(league.dataPath)) return json({ error: 'Unknown league.' }, 404);

	const user = getAuthUser(request);
	if (question.length < 5) return json({ error: 'Ask a question first.' }, 400);
	if (question.length > MAX_QUESTION) return json({ error: `Keep it under ${MAX_QUESTION} characters.` }, 400);

	if (!user) {
		if (canGuestAsk(league.slug)) return askAsGuest(request, league, question, after);
		return json({ error: 'Sign in to ask the history.' }, 401);
	}
	if (!canAskLeagueHistory(user, league.id)) return json({ error: `Asking is for ${league.name} owners.` }, 403);

	const limit = await checkRateLimit('history-ask', `${league.slug}:${user.franchiseId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
	if (!limit.allowed) return json({ error: 'That is a lot of questions for one hour. Try again later.' }, 429);

	// An expired or unknown parent just starts a fresh conversation.
	const parent = after ? await readAnswer(league.slug, after).catch(() => null) : null;
	const turns = parent ? turnsAfter(parent) : [];

	let result;
	try {
		// Only the league asked about, per request (utils/league-history/datasets).
		const [loaded, competitions] = await Promise.all([
			loadLeagueHistoryDataset(league.dataPath),
			loadLeagueCompetitions(league.dataPath, league.configPath),
		]);
		if (!loaded) return json({ error: 'Unknown league.' }, 404);
		const ds: AskData = { ...loaded, competitions };
		result = await askHistory(league.slug, ds, question, {
			turns,
			asker: askerOf(ds.history, franchiseIdForLeague(user, league.id)),
			onUsage: (u) => void recordAiUsage(league.slug, u).catch(() => {}),
		});
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
