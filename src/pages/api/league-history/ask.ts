/**
 * POST /api/league-history/ask — Ask the History.
 * Body: `{ "league": "theleague" | "afl-fantasy", "question": "...", "after"?: "<answer id>", "stream"?: true }`
 * → `{ id, answer, headline, followUps, table, steps }`; `id` opens the
 *   shareable answer page at /<league>/history/ask/<id>.
 *
 * `stream: true` (the live chat) answers as newline-delimited JSON once the
 * question is accepted: `{type:'step',text}` per lookup as it runs,
 * `{type:'answer',text}` with the answer so far as it is written, then ONE
 * `{type:'done', ...the JSON body above}` or `{type:'error', error}`. Anything
 * refused before the work starts (sign-in, rate limit, a bad question) is
 * still a plain JSON error with its status, so the client reads both.
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
import { getLeagueBySlug, leagueHasFeature } from '../../../config/leagues';
import { checkRateLimit } from '../../../utils/rate-limit';
import { canAskLeagueHistory } from '../../../utils/league-history/access';
import { askHistory, type AskAsker, type AskData, type AskEvent } from '../../../utils/league-history/ask';
import { readAnswer, recordAsk, saveAnswer, turnsAfter } from '../../../utils/league-history/ask-store';
import { hasLeagueHistoryProduct, loadLeagueCompetitions, loadLeagueHistoryDataset, loadLeagueSalaries } from '../../../utils/league-history/datasets';
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
import { guestMasker, maskAskData, maskValue, teamNameMasker } from '../../../utils/league-history/guest-mask';
import { recordFunnel } from '../../../utils/history-funnel';
import { aiModelForLeague } from '../../../utils/ai-plan.mjs';
import { recordAiUsage } from '../../../utils/ai-usage';
import { loadLiveLeagueHistory } from '../../../utils/owner-link-live';

export const prerender = false;

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 3600;
const MAX_QUESTION = 300;

function json(data: unknown, status = 200, setCookie?: string): Response {
	const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
	if (setCookie) headers['Set-Cookie'] = setCookie;
	return new Response(JSON.stringify(data), { status, headers });
}

/** The work of one accepted question: the final body and its status, with live events on the way. */
type AskWork = (onEvent?: (event: AskEvent) => void) => Promise<{ status: number; body: Record<string, unknown> }>;

/** Run the work and answer as one JSON body, or as the live NDJSON stream (see the header). */
async function respond(work: AskWork, stream: boolean, setCookie?: string): Promise<Response> {
	if (!stream) {
		const { status, body } = await work();
		return json(body, status, setCookie);
	}
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			let open = true;
			const send = (event: Record<string, unknown>) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					open = false; // the browser left; the answer is still saved
				}
			};
			try {
				const { status, body: final } = await work((event) => send(event));
				send(status < 400 ? { type: 'done', ...final } : { type: 'error', ...final });
			} catch (e) {
				console.error('[league-history/ask] stream failed:', e);
				send({ type: 'error', error: 'Could not work that one out right now. Try again in a minute, or ask it a different way.' });
			}
			if (open) controller.close();
		},
	});
	const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
	if (setCookie) headers['Set-Cookie'] = setCookie;
	return new Response(body, { status: 200, headers });
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
async function askAsGuest(request: Request, league: NonNullable<ReturnType<typeof getLeagueBySlug>>, question: string, after: string, stream: boolean): Promise<Response> {
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

	const work: AskWork = async (onEvent) => {
		let result;
		try {
			const [loaded, competitions, salaries] = await Promise.all([
				loadLeagueHistoryDataset(league.dataPath),
				loadLeagueCompetitions(league.dataPath, league.configPath),
				// A contract league's salaries, for the careers unit (ask-careers.mjs).
				leagueHasFeature(league.slug, 'contracts') ? loadLeagueSalaries(league.dataPath) : Promise.resolve(null),
			]);
			if (!loaded) {
				await spend.refund();
				return { status: 404, body: { error: 'Unknown league.' } };
			}
			const ds = maskAskData({ ...loaded, competitions, salaries }, mask);
			result = maskValue(
				await askHistory(league.slug, ds, question, {
					turns,
					asker: null,
					model: aiModelForLeague(league.slug, { guest: true }),
					onUsage: (u) => void recordAiUsage(`${league.slug}-guest`, u).catch(() => {}),
					// Masked whole on every event, like the final answer, so a live line never shows a real name.
					onEvent: onEvent && ((event) => onEvent(maskValue(event, mask))),
				}),
				mask,
			);
		} catch (e) {
			await spend.refund();
			console.error('[league-history/ask] guest failed:', e);
			return { status: 503, body: { error: 'Could not work that one out right now. Try again in a minute, or ask it a different way.', guest: { ...allowance, used: allowance.used - 1 } } };
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
		return { status: 200, body: { id: saved?.id ?? null, question, ...result, guest: allowance } };
	};
	return respond(work, stream, cookie);
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
	let stream = false;
	try {
		const body = (await request.json()) as { question?: unknown; league?: unknown; after?: unknown; stream?: unknown };
		question = typeof body?.question === 'string' ? body.question.trim() : '';
		slug = typeof body?.league === 'string' ? body.league : '';
		after = typeof body?.after === 'string' ? body.after : '';
		stream = body?.stream === true;
	} catch {
		return json({ error: 'Invalid request body' }, 400);
	}
	const league = getLeagueBySlug(slug);
	if (!league || !hasLeagueHistoryProduct(league.dataPath)) return json({ error: 'Unknown league.' }, 404);

	const user = getAuthUser(request);
	if (question.length < 5) return json({ error: 'Ask a question first.' }, 400);
	if (question.length > MAX_QUESTION) return json({ error: `Keep it under ${MAX_QUESTION} characters.` }, 400);

	if (!user) {
		if (canGuestAsk(league.slug)) return askAsGuest(request, league, question, after, stream);
		return json({ error: 'Sign in to ask the history.' }, 401);
	}
	if (!canAskLeagueHistory(user, league.id)) return json({ error: `Asking is for ${league.name} owners.` }, 403);

	const limit = await checkRateLimit('history-ask', `${league.slug}:${user.franchiseId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
	if (!limit.allowed) return json({ error: 'That is a lot of questions for one hour. Try again later.' }, 429);

	// An expired or unknown parent just starts a fresh conversation.
	const parent = after ? await readAnswer(league.slug, after).catch(() => null) : null;
	const turns = parent ? turnsAfter(parent) : [];

	const work: AskWork = async (onEvent) => {
		let result;
		try {
			// Only the league asked about, per request (utils/league-history/datasets).
			const [loaded, competitions, salaries] = await Promise.all([
				loadLeagueHistoryDataset(league.dataPath),
				loadLeagueCompetitions(league.dataPath, league.configPath),
				// A contract league's salaries, for the careers unit (ask-careers.mjs).
				leagueHasFeature(league.slug, 'contracts') ? loadLeagueSalaries(league.dataPath) : Promise.resolve(null),
			]);
			if (!loaded) return { status: 404, body: { error: 'Unknown league.' } };
			// Owners credited through approved owner links (utils/owner-link-live.ts).
			const history = await loadLiveLeagueHistory(league.slug, loaded.history);
			const ds: AskData = { ...loaded, history, competitions, salaries };
			// Owners read as their team in every answer (Brandon, 2026-11-26), and
			// the prompt alone let a real name through. The data keeps real names
			// so "how has Todd done" still finds him; what goes OUT is swapped,
			// every live event too. A missing owner list leaves the answer as is.
			const mask = await teamNameMasker(league.slug)?.catch(() => null);
			const out = <T,>(v: T): T => (mask ? maskValue(v, mask) : v);
			result = out(
				await askHistory(league.slug, ds, question, {
					turns,
					asker: askerOf(ds.history, franchiseIdForLeague(user, league.id)),
					onUsage: (u) => void recordAiUsage(league.slug, u).catch(() => {}),
					onEvent: onEvent && ((event) => onEvent(out(event))),
				}),
			);
		} catch (e) {
			console.error('[league-history/ask] failed:', e);
			return { status: 503, body: { error: 'Could not work that one out right now. Try again in a minute, or ask it a different way.' } };
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
		return { status: 200, body: { id, question, ...result } };
	};
	return respond(work, stream);
};
