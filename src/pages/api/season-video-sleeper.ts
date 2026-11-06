/**
 * GET /api/season-video-sleeper — a Sleeper season for the video maker
 * (/champion-video). No sign-in: Sleeper's API is public and read-only, and
 * the free tier asks as little as possible of an owner.
 *
 *   ?username=<sleeper username>                 → that user's leagues
 *   ?league=<league id>[&user=<id>][&roster=<n>] → one team's season
 *
 * Every Sleeper path is built here from validated parts (a username pattern,
 * digits-only ids), so nothing a visitor types reaches the URL raw. Public
 * and unauthenticated, so it is rate-limited per client: a season read fans
 * out to ~25 Sleeper requests. Starter names come from the shared, cached
 * Sleeper player map (src/utils/sleeper/players.ts), never a fresh /players/nfl.
 */
import type { APIRoute } from 'astro';
import { fetchSleeperUser, normalizeSleeperUsername, sleeperGet } from '../../utils/sleeper/client';
import { allowSeasonVideoCall } from '../../utils/season-video/abuse-limits';
import { fetchLogoAsDataUrl } from '../../utils/season-video/fetch-logo';
import { listSleeperLeagues, loadSleeperSeason } from '../../utils/season-video/sleeper-source';
import { loadSleeperPlayerMap } from '../../utils/sleeper/players';
import { getCurrentLeagueYear } from '../../utils/league-year';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
	});

export const GET: APIRoute = async ({ request, url }) => {
	if (!(await allowSeasonVideoCall(request, 'season-video-sleeper'))) return json({ ok: false, error: 'rate-limited', message: 'Too many tries. Wait a bit and try again.' }, 429);

	const get = (path: string) => sleeperGet(path);
	const league = url.searchParams.get('league');
	if (league) {
		const userParam = url.searchParams.get('user');
		const roster = Number(url.searchParams.get('roster'));
		const out = await loadSleeperSeason({
			leagueId: league,
			userId: userParam && /^\d{1,25}$/.test(userParam) ? userParam : null,
			rosterId: Number.isInteger(roster) && roster > 0 && roster < 100 ? roster : null,
			get,
			fetchLogo: fetchLogoAsDataUrl,
			// The year every other Sleeper reader uses, so they share one cached map.
			players: () => loadSleeperPlayerMap(getCurrentLeagueYear()),
		});
		return json(out, out.ok ? 200 : out.error === 'sleeper-unavailable' ? 503 : 404);
	}

	const username = normalizeSleeperUsername(url.searchParams.get('username'));
	if (!username) return json({ ok: false, error: 'bad-username', message: 'That doesn’t look like a Sleeper username.' }, 400);
	const found = await fetchSleeperUser(username);
	if (!found.ok) return json({ ok: false, error: 'sleeper-unavailable', message: 'Sleeper isn’t answering right now.' }, 503);
	if (!found.user) return json({ ok: false, error: 'no-user', message: `Sleeper has no user named ${username}.` }, 404);
	const leagues = await listSleeperLeagues(found.user.user_id, new Date(), get);
	return json({ ok: true, userId: found.user.user_id, displayName: found.user.display_name, leagues });
};
