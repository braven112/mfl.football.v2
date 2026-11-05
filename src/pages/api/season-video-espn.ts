/**
 * /api/season-video-espn — an ESPN season for the video maker (/champion-video).
 *
 *   GET  ?league=<id>&season=<year>[&team=<n>]  → a PUBLIC league, read here
 *   POST { league, text, team? }                → a PRIVATE league, pasted by
 *        the owner from the one link the page gives them (espnVideoUrl)
 *
 * No sign-in, and we never take an ESPN login or cookie: a private league is
 * read by the owner's own browser and pasted back (src/utils/espn-history.ts
 * documents why). Every ESPN URL is built here from a digits-only id and a
 * year, so nothing a visitor types reaches a URL raw.
 *
 * Every season read is also SAVED, raw, into the ESPN history store
 * (`storeEspnUpload`) — the video is League History's on-ramp (Brandon,
 * 2026-11-05), so a later Full History build starts from what the owner
 * already gave us instead of asking again. Saving is best-effort and capped
 * (per league, per caller and site-wide per day, and by size), so a bot cannot
 * fill Redis through it; a refused or failed save never costs the owner their video.
 */
import type { APIRoute } from 'astro';
import { allowEspnSave, allowSeasonVideoCall } from '../../utils/season-video/abuse-limits';
import { storeEspnUpload } from '../../utils/espn-history';
import { fetchLogoAsDataUrl } from '../../utils/season-video/fetch-logo';
import {
	ESPN_LEAGUE_ID,
	MAX_ESPN_PASTE_CHARS,
	buildEspnVideo,
	loadEspnSeason,
	readEspnSeason,
	type EspnGet,
} from '../../utils/season-video/espn-source';

export const prerender = false;

const ESPN_TIMEOUT_MS = 8000;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
	});

const espnGet: EspnGet = async (url) => {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(ESPN_TIMEOUT_MS), headers: { Accept: 'application/json' } });
		return { status: res.status, text: res.status === 200 ? await res.text() : '' };
	} catch {
		return null;
	}
};

const teamParam = (v: unknown): number | null => {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
};

/** Keep what we read for League History, inside the Redis caps (abuse-limits.ts). Never throws. */
async function save(request: Request, leagueId: string, text: string): Promise<void> {
	try {
		if (!(await allowEspnSave(request, leagueId, text.length))) return;
		await storeEspnUpload(leagueId, text);
	} catch {
		/* storage down: the owner still gets their video */
	}
}

async function limited(request: Request): Promise<Response | null> {
	return (await allowSeasonVideoCall(request, 'season-video-espn')) ? null : json({ ok: false, error: 'rate-limited', message: 'Too many tries. Wait a bit and try again.' }, 429);
}

export const GET: APIRoute = async ({ request, url }) => {
	const blocked = await limited(request);
	if (blocked) return blocked;
	const leagueId = url.searchParams.get('league') ?? '';
	const season = Number(url.searchParams.get('season'));
	let fetched: string | null = null;
	const out = await loadEspnSeason({
		leagueId,
		season,
		teamId: teamParam(url.searchParams.get('team')),
		get: async (u) => {
			const res = await espnGet(u);
			if (res?.status === 200) fetched = res.text;
			return res;
		},
		fetchLogo: fetchLogoAsDataUrl,
	});
	if (out.ok && fetched) await save(request, leagueId, fetched);
	const status = out.ok ? 200 : out.error === 'espn-unavailable' ? 503 : out.error === 'private' ? 403 : 404;
	return json(out, status);
};

export const POST: APIRoute = async ({ request }) => {
	const blocked = await limited(request);
	if (blocked) return blocked;
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > MAX_ESPN_PASTE_CHARS + 1000) return json({ ok: false, error: 'not-json', message: 'That’s too big to be one ESPN league.' }, 413);
	let body: { league?: unknown; text?: unknown; team?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'not-json', message: 'Paste what the ESPN link shows.' }, 400);
	}
	const leagueId = typeof body.league === 'string' && ESPN_LEAGUE_ID.test(body.league) ? body.league : null;
	if (!leagueId) return json({ ok: false, error: 'no-league', message: 'Enter your ESPN league ID first.' }, 400);
	const text = typeof body.text === 'string' ? body.text : '';
	const read = readEspnSeason(text, leagueId);
	if (!read.ok) return json(read, 400);
	const teamId = teamParam(body.team);
	// Save once, on the first read of a paste; a team change re-sends the same text.
	if (teamId === null) await save(request, leagueId, text);
	return json(await buildEspnVideo(read.raw, teamId, fetchLogoAsDataUrl));
};
