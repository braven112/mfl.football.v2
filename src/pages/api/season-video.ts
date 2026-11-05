/**
 * GET /api/season-video?league=<MFL id>[&year=<season>][&franchise=<0001>]
 *
 * The facts for a season video (/champion-video), read from MFL with the
 * signed-in owner's own cookie. Only a league the owner's account lists:
 * `requireOwnerLeague` checks that, so the id in the URL can narrow what the
 * session sees but never widen it. Team-level data only (free tier).
 *
 * `franchise` lets the owner make a video for another team in the same
 * league (a league-mate's last-place season, say). It is checked against
 * that season's franchise list; the season's data is visible to every
 * member of the league anyway.
 */
import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../utils/live/owner-league';
import { mflFetch } from '../../utils/mfl-fetch';
import { validatePublicUrl } from '../../utils/url-guard';
import { exportPath, loadMflSeason, MAX_LOGO_BYTES, type FetchLogo, type FetchMflExport } from '../../utils/season-video/mfl-source';

export const prerender = false;

const LOGO_TIMEOUT_MS = 4000;

const fetchLogo: FetchLogo = async (url) => {
	if (await validatePublicUrl(url)) return null;
	const res = await fetch(url, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS), redirect: 'follow' });
	if (!res.ok) return null;
	const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.test(type)) return null;
	const declared = Number(res.headers.get('content-length') ?? 0);
	if (declared > MAX_LOGO_BYTES) return null;
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength > MAX_LOGO_BYTES) return null;
	return `data:${type};base64,${buf.toString('base64')}`;
};

export const GET: APIRoute = async ({ request, url }) => {
	const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
	if (gate instanceof Response) return gate;
	const { user, league } = gate;

	const fetchExport: FetchMflExport = async (req) => {
		const res = await mflFetch({ url: exportPath(req), method: 'GET', mflUserCookie: user.id, timeoutMs: 8000 });
		const text = await res.text();
		try {
			return JSON.parse(text);
		} catch {
			// MFL's throttled page is HTML under a 200: not an answer.
			throw new Error('MFL returned a non-JSON page');
		}
	};

	const yearParam = Number(url.searchParams.get('year'));
	try {
		const out = await loadMflSeason({
			league,
			year: Number.isInteger(yearParam) && yearParam > 1998 ? yearParam : null,
			franchiseId: url.searchParams.get('franchise'),
			fetchExport,
			fetchLogo,
		});
		return appJson(out, out.ok ? 200 : 404);
	} catch {
		return appJson({ ok: false, error: 'mfl-unavailable', message: 'MFL isn’t answering right now. Try again in a minute.' }, 503);
	}
};
